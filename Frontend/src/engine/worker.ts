import { pipeline, env } from '@huggingface/transformers';
import { CONFIG } from './config.ts';

// In browser environments, disable local model checks
env.allowLocalModels = false;

// Ensure default device is WASM
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

let extractor: any = null;

async function initPipeline() {
  try {
    self.postMessage({ type: 'status', message: 'Downloading & caching embedding model...' });

    extractor = await pipeline('feature-extraction', CONFIG.MODEL_NAME, {
      dtype: 'q8',
      progress_callback: (progressInfo: any) => {
        self.postMessage({
          type: 'download_progress',
          data: progressInfo,
        });
      },
    });

    self.postMessage({ type: 'ready' });
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      error: err?.message || String(err),
    });
  }
}

self.addEventListener('message', async (event: MessageEvent) => {
  const { type, id, text } = event.data || {};

  if (type === 'init') {
    if (!extractor) {
      await initPipeline();
    } else {
      self.postMessage({ type: 'ready' });
    }
    return;
  }

  if (type === 'embed') {
    if (!extractor) {
      self.postMessage({
        type: 'embed_error',
        id,
        error: 'Pipeline is not ready yet',
      });
      return;
    }

    try {
      const output = await extractor(text, {
        pooling: 'mean',
        normalize: true,
      });

      const vector = Float32Array.from(output.data as Float32Array);

      // Post back vector with zero-copy transfer of its buffer
      (self as any).postMessage(
        {
          type: 'embed_result',
          id,
          vector,
        },
        [vector.buffer]
      );
    } catch (err: any) {
      self.postMessage({
        type: 'embed_error',
        id,
        error: err?.message || String(err),
      });
    }
    return;
  }

  if (type === 'embed_batch') {
    const { texts } = event.data || {};
    if (!extractor) {
      self.postMessage({
        type: 'embed_batch_error',
        id,
        error: 'Pipeline is not ready yet',
      });
      return;
    }

    try {
      const list = (texts as string[]) || [];
      if (list.length === 0) {
        (self as any).postMessage({
          type: 'embed_batch_result',
          id,
          vector: new Float32Array(0),
          count: 0,
        });
        return;
      }

      const output = await extractor(list, {
        pooling: 'mean',
        normalize: true,
      });

      const vector = Float32Array.from(output.data as Float32Array);

      (self as any).postMessage(
        {
          type: 'embed_batch_result',
          id,
          vector,
          count: list.length,
        },
        [vector.buffer]
      );
    } catch (err: any) {
      self.postMessage({
        type: 'embed_batch_error',
        id,
        error: err?.message || String(err),
      });
    }
  }
});
