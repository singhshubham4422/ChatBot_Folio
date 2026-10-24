export const MODELS = [
  { id: 'SmolLM2-135M-Instruct-q0f16-MLC', label: 'SmolLM2 135M q0f16', size: '~360 MB runtime', download: '~170 MB', needsF16: true },
  { id: 'SmolLM2-135M-Instruct-q0f32-MLC', label: 'SmolLM2 135M q0f32', size: '~280 MB runtime', download: '~170 MB', needsF16: false },
  { id: 'SmolLM2-360M-Instruct-q4f16_1-MLC', label: 'SmolLM2 360M q4f16', size: '~376 MB runtime', download: '~230 MB', needsF16: true },
  { id: 'SmolLM2-360M-Instruct-q4f32_1-MLC', label: 'SmolLM2 360M q4f32', size: '~580 MB runtime', download: '~230 MB', needsF16: false },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B q4f16', size: '~879 MB runtime', download: '~700 MB', needsF16: false },
] as const;

export type ModelId = typeof MODELS[number]['id'];
