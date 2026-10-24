import type { MLCEngine } from '@mlc-ai/web-llm';
import { MODELS, type ModelId } from './modelCatalog';
export { MODELS, type ModelId } from './modelCatalog';

export function modelInfo(modelId: ModelId) {
  return MODELS.find(model => model.id === modelId) ?? MODELS[1];
}

export function selectLocalModel(): ModelId {
  if (typeof navigator === 'undefined') return MODELS[1].id;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 0;
  const isAndroid = /Android/i.test(navigator.userAgent ?? '');
  const hasWebGPU = 'gpu' in navigator && Boolean(navigator.gpu);
  const capableDesktop = hasWebGPU && !isAndroid && (deviceMemory ?? 0) >= 8 && cores >= 8;
  return capableDesktop ? MODELS[3].id : MODELS[1].id;
}

let sessionFailed = false;
type LocalEvidence = { text: string; sourceFile?: string; fileName?: string; pageStart?: number; page?: number; tables?: Array<{ heading: string; columns: string[]; rows: string[][] }> };
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
      throw new Error('WebGPU is unavailable in this browser. Use a current Chrome or Edge build with WebGPU enabled, or use the grounded document-only fallback.');
    }
    const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
    const record = prebuiltAppConfig.model_list.find(item => item.model_id === modelId);
    if (!record) throw new Error(`The installed WebLLM package does not support ${modelId}. It was not replaced with another model.`);
    if (this.engine && this.loadedId === modelId) { progress('Using the already loaded model', 1); return; }
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: ReadonlySet<string> } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    if (!adapter) throw new Error('This browser could not create a WebGPU adapter. Check browser and graphics driver support, or use the grounded document-only fallback.');
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

    const isAndroid = /Android/i.test(navigator.userAgent ?? '');
    // WebLLM 0.2.82 uses this flag (newer releases renamed the option while
    // also introducing the disposal regression). Keep Android on IndexedDB.
    appConfig = { ...appConfig, useIndexedDBCache: isAndroid };

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
      if (/failed to execute ['"]?add['"]? on ['"]?cache|cache storage|quota|storage/i.test(detail)) {
        throw new Error(`Android could not store the local model files. Use a normal Chrome tab (not private browsing), allow site storage, then clear this site's data and retry. Details: ${detail}`);
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
  resetSessionFailure() { sessionFailed = false; }
  async stop() { await this.engine?.interruptGenerate(); }
  async ask(question: string, evidence: LocalEvidence[], context: string[] = [], onToken?: (value: string) => void, options: { maxTokens?: number; systemInstruction?: string } = {}) {
    if (!this.engine) throw new Error('Load a local model first.');
    if (sessionFailed) throw new Error('Local generation was disabled after a resource failure. Deliberately retry model preparation to try again.');
    const contextEvidence = evidence.map((c, index) => `[${index + 1}] ${c.fileName ?? c.sourceFile ?? 'Document'}, page ${c.pageStart ?? c.page ?? '?'}: ${c.text}`).join('\n\n');
    try {
      const result = await this.engine.chat.completions.create({
        messages: [
          { role: 'system', content: 'Answer the exact question directly using only the supplied PDF excerpts. Preserve dates, amounts, percentages, eligibility conditions and academic-year qualifiers. Cite every substantive claim with the evidence number, such as [1] or [2]. If the excerpts are insufficient or contradictory, say so clearly. Do not invent facts, citations or admission guarantees. Use concise prose or short bullets; do not copy table headings or unrelated passages.\n' + (options.systemInstruction ? `\n${options.systemInstruction}\n` : '') + '\nRecent conversation is only for resolving references:\n' + context.slice(-6).map(item => item.slice(0, 500)).join('\n') + '\n\nPDF excerpts:\n' + contextEvidence },
          { role: 'user', content: question },
        ], temperature: 0.1, max_tokens: options.maxTokens ?? 320, stream: Boolean(onToken),
      });
      if (onToken && Symbol.asyncIterator in Object(result)) {
        let answer = '';
        for await (const part of result as AsyncIterable<{ choices?: { delta?: { content?: string } }[] }>) {
          const token = part.choices?.[0]?.delta?.content ?? ''; answer += token; if (token) onToken(token);
        }
        return answer;
      }
      return (result as { choices: { message?: { content?: string } }[] }).choices[0]?.message?.content ?? 'I could not generate an answer.';
    } catch (error) {
      sessionFailed = true;
      throw error;
    }
  }
}
