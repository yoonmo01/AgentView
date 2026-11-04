import { expect, it } from 'vitest';
import { groupOf } from './ModelPicker.tsx';

it('groups gateway models by provider', () => {
  expect(['claude-opus-5-5', 'gpt-6-luna', 'gemini-3.5-flash', 'google/gemma-4-31B-it', 'deepseek-v4-pro', 'glm-5.3', 'mystery'].map(groupOf))
    .toEqual(['Claude', 'GPT', 'Gemini · Gemma', 'Gemini · Gemma', 'DeepSeek', 'GLM', '기타']);
});
