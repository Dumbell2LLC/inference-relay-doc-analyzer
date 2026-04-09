/** Model pricing per million tokens: [input, output] */
export const MODEL_PRICING: Record<string, [number, number]> = {
  // Anthropic
  'claude-opus-4-6': [15, 75],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [0.8, 4],
  // OpenAI
  'gpt-4.1': [2, 8],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1-nano': [0.1, 0.4],
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'o4-mini': [1.1, 4.4],
  'o3': [0.4, 1.6],
  'o3-mini': [1.1, 4.4],
  'o1': [15, 60],
  // Ollama (local — zero cost)
  'llama3.1': [0, 0],
  'mistral': [0, 0],
  'mistral-nemo': [0, 0],
  'llava': [0, 0],
  'qwen2:0.5b': [0, 0],
};

export type ProviderType = 'anthropic-api' | 'openai-api' | 'ollama';

export interface ModelGroup {
  provider: ProviderType;
  label: string;
  models: string[];
}

/** All models grouped by provider — drives dropdown rendering */
export const MODEL_GROUPS: ModelGroup[] = [
  {
    provider: 'anthropic-api',
    label: 'Anthropic',
    models: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'],
  },
  {
    provider: 'openai-api',
    label: 'OpenAI',
    models: ['gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o', 'o3', 'o3-mini', 'o4-mini'],
  },
  {
    provider: 'ollama',
    label: 'Ollama (local)',
    models: ['mistral', 'llama3.1', 'mistral-nemo', 'qwen2:0.5b'],
  },
];

/** Flat list for backward compatibility */
export const PHASE1_MODELS = MODEL_GROUPS.flatMap(g => g.models);
export const PHASE2_MODELS = MODEL_GROUPS.flatMap(g => g.models);

export function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] || [3, 15];
  return (inputTokens * pricing[0] + outputTokens * pricing[1]) / 1_000_000;
}

export function estimateCost(model: string, docLengthChars: number): number {
  const estimatedTokens = Math.ceil(docLengthChars / 4);
  const pricing = MODEL_PRICING[model] || [3, 15];
  return (estimatedTokens * pricing[0] + 2000 * pricing[1]) / 1_000_000;
}
