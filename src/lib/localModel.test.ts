import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  create: vi.fn(),
  config: { model_list: [
    { model_id: 'SmolLM2-360M-Instruct-q4f16_1-MLC', required_features: ['shader-f16'] },
    { model_id: 'SmolLM2-360M-Instruct-q4f32_1-MLC', required_features: [] },
    { model_id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', required_features: [] },
  ] },
}));
vi.mock('@mlc-ai/web-llm', () => ({ prebuiltAppConfig: runtime.config, CreateMLCEngine: runtime.create }));

import { LocalModel, MODELS } from './localModel';

const readyEngine = { unload: vi.fn(), interruptGenerate: vi.fn(), chat: { completions: { create: vi.fn() } } };
function setGpu(features = new Set<string>()) {
  vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue({ features }) } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  runtime.create.mockReset();
  readyEngine.chat.completions.create.mockResolvedValue({ choices: [{ message: { content: 'Ready answer.' } }] });
  vi.stubGlobal('navigator', {});
});

describe('local model readiness and initialization', () => {
  it('blocks inference until a model is ready', async () => {
    const model = new LocalModel();
    await expect(model.ask('question', [])).rejects.toThrow(/load a local model first/i);
  });
  it('reports unavailable WebGPU and never substitutes an unlisted model', async () => {
    const model = new LocalModel();
    await expect(model.load(MODELS[1].id, vi.fn())).rejects.toThrow(/WebGPU is unavailable/i);
    setGpu();
    await expect(model.load('unsupported' as never, vi.fn())).rejects.toThrow(/does not support unsupported/i);
  });
  it('reports WebGPU adapter creation failures', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue(null) } });
    await expect(new LocalModel().load(MODELS[1].id, vi.fn())).rejects.toThrow(/could not create a WebGPU adapter/i);
  });
  it('checks shader-f16 support for the selected exact model', async () => {
    setGpu();
    const model = new LocalModel();
    await expect(model.load(MODELS[0].id, vi.fn())).rejects.toThrow(/shader-f16/i);
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it('shares concurrent initialization and becomes ready only after it succeeds', async () => {
    setGpu();
    let complete!: (engine: typeof readyEngine) => void;
    runtime.create.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const model = new LocalModel();
    const report = vi.fn();
    const first = model.load(MODELS[1].id, report);
    const duplicate = model.load(MODELS[1].id, report);
    await vi.waitFor(() => expect(runtime.create).toHaveBeenCalledTimes(1));
    complete(readyEngine);
    await Promise.all([first, duplicate]);
    await expect(model.ask('question', [])).resolves.toBeDefined();
  });
  it('surfaces initialization errors and leaves inference blocked', async () => {
    setGpu();
    runtime.create.mockRejectedValue(new Error('GPU buffer allocation failed'));
    const model = new LocalModel();
    await expect(model.load(MODELS[1].id, vi.fn())).rejects.toThrow(/not have enough available GPU memory/i);
    await expect(model.ask('question', [])).rejects.toThrow(/load a local model first/i);
  });
  it('distinguishes failed model download from WebGPU memory and device errors', async () => {
    setGpu();
    runtime.create.mockRejectedValue(new TypeError('Failed to fetch'));
    const model = new LocalModel();
    let caught: Error | undefined;
    try {
      await model.load(MODELS[1].id, vi.fn());
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toMatch(/Failed to download model files for SmolLM2/i);
    expect(caught?.message).toMatch(/network request failed/i);
    expect(caught?.message).not.toMatch(/GPU memory/i);
    expect(caught?.message).not.toMatch(/WebGPU compatibility/i);
  });
  it('notifies all concurrent callers of progress and updates readiness getters', async () => {
    setGpu();
    let initCallback: ((report: { text: string; progress: number }) => void) | undefined;
    let completeCreate!: (engine: typeof readyEngine) => void;
    runtime.create.mockImplementation((_id: string, opts: { initProgressCallback?: (r: { text: string; progress: number }) => void }) => {
      initCallback = opts.initProgressCallback;
      return new Promise(resolve => { completeCreate = resolve; });
    });
    const model = new LocalModel();
    expect(model.isReady()).toBe(false);
    expect(model.getLoadedModelId()).toBeUndefined();
    const progressA = vi.fn();
    const progressB = vi.fn();
    const loadA = model.load(MODELS[1].id, progressA);
    const loadB = model.load(MODELS[1].id, progressB);
    await vi.waitFor(() => expect(runtime.create).toHaveBeenCalledTimes(1));
    initCallback?.({ text: 'Compiling shaders', progress: 0.5 });
    completeCreate(readyEngine);
    await Promise.all([loadA, loadB]);
    expect(progressA).toHaveBeenCalledWith('Compiling shaders', 0.5);
    expect(progressB).toHaveBeenCalledWith('Compiling shaders', 0.5);
    expect(model.isReady()).toBe(true);
    expect(model.isReady(MODELS[1].id)).toBe(true);
    expect(model.isReady(MODELS[0].id)).toBe(false);
    expect(model.getLoadedModelId()).toBe(MODELS[1].id);
    await model.unload();
    expect(model.isReady()).toBe(false);
    expect(model.getLoadedModelId()).toBeUndefined();
  });
  it('permits retry after an initialization failure and succeeds when runtime recovers', async () => {
    setGpu();
    runtime.create.mockRejectedValueOnce(new Error('Transient device lost')).mockResolvedValueOnce(readyEngine);
    const model = new LocalModel();
    await expect(model.load(MODELS[1].id, vi.fn())).rejects.toThrow(/Transient device lost/i);
    expect(model.isReady()).toBe(false);
    await expect(model.load(MODELS[1].id, vi.fn())).resolves.toBeUndefined();
    expect(model.isReady()).toBe(true);
    await expect(model.ask('question', [])).resolves.toBeDefined();
  });
  it('cancels engine assignment if unload was called while loading', async () => {
    setGpu();
    let resolveCreate!: (engine: typeof readyEngine) => void;
    runtime.create.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve; }));
    const model = new LocalModel();
    const loadPromise = model.load(MODELS[1].id, vi.fn());
    await vi.waitFor(() => expect(runtime.create).toHaveBeenCalledTimes(1));
    await model.unload();
    resolveCreate(readyEngine);
    await loadPromise;
    expect(model.isReady()).toBe(false);
    expect(readyEngine.unload).toHaveBeenCalled();
  });
});
