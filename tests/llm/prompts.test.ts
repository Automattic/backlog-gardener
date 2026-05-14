import { describe, expect, it } from 'vitest';

import { loadPromptTemplate, parsePromptMarkdown } from '../../src/gardener/llm/prompts.js';

describe('prompt templates', () => {
  it('parses system and user sections', () => {
    expect(parsePromptMarkdown('## SYSTEM\nA\n## USER\nB')).toEqual({ system: 'A', user: 'B' });
  });

  it('resolves persona includes at load time', async () => {
    const prompt = await loadPromptTemplate('analyze', 'v1');

    expect(prompt.system).toContain('Signal Gardener');
    expect(prompt.system).not.toContain('{{persona:triage}}');
  });
});
