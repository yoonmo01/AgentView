import { expect, it } from 'vitest';
import { compareGroups, compareModels, groupOf } from './ModelPicker.tsx';

it('groups models by family with GPT, Claude, Gemini first', () => {
  const ids = ['deepseek-v4-pro', 'google/gemma-4-31B-it', 'claude-opus-5-5', 'glm-5.3', 'gemini-3.5-flash', 'gpt-6-luna', 'qwen3-max'];
  expect([...new Set(ids.map(groupOf))].sort(compareGroups)).toEqual(['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Gemma', 'GLM', 'Qwen']);
});

it('puts the newest version first inside a family', () => {
  expect(['gpt-5.1', 'gpt-6-luna', 'gpt-5.4-mini', 'gpt-5.6-sol', 'gpt-5.4'].sort(compareModels))
    .toEqual(['gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.1']);
  expect(['claude-haiku-4-5-20251001', 'claude-opus-5', 'claude-fable-5-1', 'claude-opus-5-5'].sort(compareModels))
    .toEqual(['claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-5', 'claude-haiku-4-5-20251001']);
});
