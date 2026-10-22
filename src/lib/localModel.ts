import type { MLCEngine } from '@mlc-ai/web-llm';
import type { Chunk } from '../types';

export const MODELS = [
  { id: 'SmolLM2-135M-Instruct-q0f16-MLC', label: 'SmolLM2 · 135M · q0f16', size: '~360 MB VRAM', needsF16: true },
  { id: 'SmolLM2-135M-Instruct-q0f32-MLC', label: 'SmolLM2 · 135M · q0f32', size: '~719 MB VRAM', needsF16: false },
  { id: 'SmolLM2-360M-Instruct-q4f16_1-MLC', label: 'SmolLM2 · 360M · q4f16', size: '~376 MB VRAM', needsF16: true },
  { id: 'SmolLM2-360M-Instruct-q4f32_1-MLC', label: 'SmolLM2 · 360M · q4f32', size: '~580 MB VRAM', needsF16: false },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 · 1B · q4f16', size: '~879 MB VRAM', needsF16: false },
] as const;
export type ModelId = typeof MODELS[number]['id'];
export class LocalModel {
  private engine?: MLCEngine;
  private loadedId?: ModelId;
  private loading?: { modelId: ModelId; promise: Promise<void> };
  private progressListeners = new Set<(text: string, value: number) => void>();
  private loadToken = 0;

  isReady(modelId?: ModelId): boolean {
    return Boolean(this.engine && (!modelId || this.loadedId === modelId));
  }

  getLoadedModelId(): ModelId | undefined {
    return this.loadedId;
  }

  async load(modelId: ModelId, progress: (text: string, value: number) => void): Promise<void> {
    if (this.engine && this.loadedId === modelId) {
      progress('Model is ready in this tab', 1);
      return;
    }

    this.progressListeners.add(progress);

    if (this.loading) {
      if (this.loading.modelId === modelId) {
        try {
          await this.loading.promise;
          return;
        } finally {
          this.progressListeners.delete(progress);
        }
      }
      await this.loading.promise.catch(() => undefined);
      this.progressListeners.delete(progress);
      return this.load(modelId, progress);
    }

    const currentToken = ++this.loadToken;
    const notify = (text: string, value: number) => {
      for (const listener of this.progressListeners) {
        listener(text, value);
      }
    };

    const promise = this.loadOnce(modelId, notify, currentToken);
    this.loading = { modelId, promise };
    try {
      await promise;
    } finally {
      this.progressListeners.delete(progress);
      if (this.loading?.promise === promise) this.loading = undefined;
    }
  }

  private async loadOnce(modelId: ModelId, progress: (text: string, value: number) => void, token: number) {
    if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
      throw new Error('WebGPU is unavailable in this browser. Use a current Chrome or Edge build with WebGPU enabled, or choose online mode with consent.');
    }
    const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
    const record = prebuiltAppConfig.model_list.find(item => item.model_id === modelId);
    if (!record) throw new Error(`The installed WebLLM package does not support ${modelId}. It was not replaced with another model.`);
    if (this.engine && this.loadedId === modelId) { progress('Using the already loaded model', 1); return; }
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: ReadonlySet<string> } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    if (!adapter) throw new Error('This browser could not create a WebGPU adapter. Check browser and graphics driver support, or use online mode with consent.');
    if (record.required_features?.includes('shader-f16') && !adapter.features.has('shader-f16')) throw new Error('This model requires WebGPU shader-f16 support. Choose the listed q4f32 model or another supported option.');
    if (this.engine) { await this.engine.unload(); this.engine = undefined; this.loadedId = undefined; }
    const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
    progress('Initializing model runtime', 0);

    let appConfig = prebuiltAppConfig;
    if (typeof window !== 'undefined' && typeof record.model === 'string' && record.model.startsWith('https://huggingface.co')) {
      let directWorks = false;
      try {
        const probeTarget = new URL('mlc-chat-config.json', record.model.endsWith('/') ? record.model : `${record.model}/resolve/main/`).href;
        const probe = await fetch(probeTarget, { method: 'HEAD', signal: AbortSignal.timeout(1500) });
        if (probe.ok || probe.status === 302 || probe.status === 307) {
          directWorks = true;
        }
      } catch {
        directWorks = false;
      }

      if (!directWorks) {
        const cleanRemote = record.model.replace(/^https?:\/\/[^/]+\/?/, '');
        const localProxyModel = `${window.location.origin}/api/hf-proxy/${cleanRemote}`;
        appConfig = {
          ...prebuiltAppConfig,
          model_list: prebuiltAppConfig.model_list.map(item => {
            if (item.model_id === modelId) {
              return {
                ...item,
                model: localProxyModel,
              };
            }
            return item;
          }),
        };
      }
    }

    try {
      const engine = await CreateMLCEngine(modelId, {
        appConfig,
        initProgressCallback: report => progress(report.text, report.progress),
      });
      if (this.loadToken !== token) {
        await engine.unload();
        return;
      }
      this.engine = engine;
      this.loadedId = modelId;
      progress('Model is ready in this tab', 1);
    } catch (error) {
      this.engine = undefined; this.loadedId = undefined;
      const detail = error instanceof Error ? error.message : String(error);
      if ((error instanceof TypeError && /failed to fetch/i.test(detail)) || /network|fetch|net::/i.test(detail)) {
        throw new Error(`Failed to download model files for ${modelId}. The network request failed (${detail}). Verify network connectivity to the model repository and retry.`);
      }
      if (/shader-f16/i.test(detail)) {
        throw new Error(`This model requires WebGPU shader-f16 support. Choose the listed q4f32 model or another supported option.`);
      }
      if (/memory|alloc|buffer/i.test(detail)) {
        throw new Error(`Could not initialize ${modelId}. Check WebGPU compatibility and available GPU memory. The device may not have enough available GPU memory; close GPU-heavy tabs or choose a smaller listed model. Details: ${detail}`);
      }
      if (/webgpu|adapter|device/i.test(detail)) {
        throw new Error(`Could not initialize ${modelId}. Check WebGPU compatibility and graphics drivers. Details: ${detail}`);
      }
      throw new Error(`Could not initialize ${modelId}. Details: ${detail}`);
    }
  }

  async unload() {
    this.loadToken++;
    if (this.engine) await this.engine.unload();
    this.engine = undefined;
    this.loadedId = undefined;
  }
  async stop() { await this.engine?.interruptGenerate(); }
  async ask(question: string, evidence: Chunk[], context: string[] = [], onToken?: (value: string) => void) {
    if (!this.engine) throw new Error('Load a local model first.');
    const contextEvidence = evidence.map(c => `[${c.fileName ?? 'Document'}, page ${c.page}] ${c.text}`).join('\n\n');
    const result = await this.engine.chat.completions.create({
      messages: [
        { role: 'system', content: 'Use the recent conversation only to resolve references. Answer only from the supplied PDF excerpts. If the excerpts do not contain the answer, say you could not find it in the selected documents. Cite every substantive claim as [filename, p. 2]. Do not invent facts; the PDF evidence overrides the summary.\n\nConversation context:\n' + context.slice(-6).map(item => item.slice(0, 500)).join('\n') + '\n\nPDF excerpts:\n' + contextEvidence },
        { role: 'user', content: question },
      ], temperature: 0.15, max_tokens: 500, stream: Boolean(onToken),
    });
    if (onToken && Symbol.asyncIterator in Object(result)) {
      let answer = '';
      for await (const part of result as AsyncIterable<{ choices?: { delta?: { content?: string } }[] }>) {
        const token = part.choices?.[0]?.delta?.content ?? ''; answer += token; if (token) onToken(token);
      }
      return answer;
    }
    return (result as { choices: { message?: { content?: string } }[] }).choices[0]?.message?.content ?? 'I could not generate an answer.';
  }
}
