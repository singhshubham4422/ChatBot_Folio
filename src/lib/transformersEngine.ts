import type { Chunk } from '../types';

const MODEL_ID = 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA';
type Backend = 'webgpu' | 'wasm';
type Generator = (prompt: string, options: Record<string, unknown>) => Promise<unknown>;

let generatorPromise: Promise<{ generate: Generator; backend: Backend }> | undefined;

function idbCache() {
  const database = 'folio-transformers-cache';
  const store = 'responses';
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const read = async (key: string) => {
    const db = await open();
    return new Promise<ArrayBuffer | undefined>((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as ArrayBuffer | undefined);
      request.onerror = () => reject(request.error);
    });
  };
  const write = async (key: string, value: ArrayBuffer) => {
    const db = await open();
    return new Promise<void>((resolve, reject) => {
      const request = db.transaction(store, 'readwrite').objectStore(store).put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  };
  return {
    match: async (request: string) => {
      const value = await read(request);
      return value ? new Response(value) : undefined;
    },
    put: async (request: string, response: Response, progress?: (data: { progress: number; loaded: number; total: number }) => void) => {
      const value = await response.arrayBuffer();
      await write(request, value);
      progress?.({ progress: 1, loaded: value.byteLength, total: value.byteLength });
    },
    delete: async (request: string) => {
      const db = await open();
      return new Promise<boolean>((resolve, reject) => {
        const transaction = db.transaction(store, 'readwrite');
        const req = transaction.objectStore(store).delete(request);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },
  };
}

function promptFor(question: string, evidence: Chunk[]) {
  const context = evidence.map(chunk => `[${chunk.fileName ?? 'PDF'}, page ${chunk.page}] ${chunk.text}`).join('\n');
  return `You are Quick Bot. Answer only from the provided PDF passages. Be concise: 1 to 4 short sentences. If the passages do not support the answer, say you could not find it. Do not invent facts.\n\nPassages:\n${context}\n\nQuestion: ${question}\nAnswer:`;
}

function normalizeOutput(value: unknown) {
  const item = Array.isArray(value) ? value[0] : value;
  const generated = (item as { generated_text?: unknown } | undefined)?.generated_text;
  if (typeof generated === 'string') return generated;
  if (Array.isArray(generated)) {
    const last = generated.at(-1) as { content?: unknown } | undefined;
    if (typeof last?.content === 'string') return last.content;
  }
  return '';
}

function removePromptEcho(answer: string, prompt: string) {
  const trimmed = answer.trim();
  if (trimmed.startsWith(prompt)) return trimmed.slice(prompt.length).trim();
  const marker = trimmed.lastIndexOf('Answer:');
  return marker >= 0 ? trimmed.slice(marker + 'Answer:'.length).trim() : trimmed;
}

async function createGenerator(backend: Backend) {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.useCustomCache = true;
  env.customCache = idbCache();
  env.useBrowserCache = false;
  env.useWasmCache = true;
  env.logLevel = 40;
  const device = backend === 'webgpu' ? 'webgpu' : 'wasm';
  const dtype = backend === 'webgpu' ? 'q4' : 'q8';
  const generate = await pipeline('text-generation', MODEL_ID, { device, dtype }) as unknown as Generator;
  return { generate, backend };
}

async function getGenerator() {
  if (!generatorPromise) {
    generatorPromise = (async () => {
      if ('gpu' in navigator) {
        try { return await createGenerator('webgpu'); } catch { /* WASM is the compatibility path. */ }
      }
      return createGenerator('wasm');
    })().catch(error => { generatorPromise = undefined; throw error; });
  }
  return generatorPromise;
}

export async function askWithTransformers(question: string, evidence: Chunk[]) {
  const prompt = promptFor(question, evidence);
  const { generate, backend } = await getGenerator();
  const result = await generate(prompt, { max_new_tokens: 120, do_sample: false, return_full_text: false });
  const text = removePromptEcho(normalizeOutput(result), prompt);
  if (!text) throw new Error('The browser model returned an empty answer.');
  return { text, backend };
}

export function transformersModelId() { return MODEL_ID; }
