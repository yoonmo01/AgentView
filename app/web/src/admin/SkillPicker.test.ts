import { expect, it } from 'vitest';
import type { SkillInfo } from '../api.ts';
import { missingTools } from './SkillPicker.tsx';

const skill = (allowedTools: string[]) => ({ id: 's', name: 's', description: '', allowedTools, source: 'local', files: [] }) as SkillInfo;

it('names the tools a skill needs that the agent lacks, mapping Claude Code names', () => {
  expect(missingTools(skill([]), [])).toEqual(['sandbox_read_file']); // reading SKILL.md itself
  expect(missingTools(skill(['Read', 'Bash(git:*)', 'Grep']), ['sandbox_read_file', 'sandbox_run'])).toEqual(['sandbox_search']);
  expect(missingTools(skill(['sandbox_edit_file', 'SomethingElse']), ['sandbox_read_file'])).toEqual(['sandbox_edit_file']);
});
