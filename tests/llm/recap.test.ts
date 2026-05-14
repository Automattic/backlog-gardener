import { describe, expect, it } from 'vitest';

import { validateRecap } from '../../src/gardener/llm/recap.js';

const baseRecap = {
  decision: 'surface',
  sourceType: 'github_issue',
  shortTitle: 'Apple Pay disappears after cart update',
  summary: 'Apple Pay disappears after cart update.',
  novelty: 'recurring',
  bestSolution: 'Investigate checkout fragment rendering.',
  risks: [],
  confidence: 'medium',
  evidence: [
    {
      label: 'Repro',
      detail: 'Reporter provided details.',
      sourceUrl: 'https://github.com/example-org/example-product/issues/8421',
      quote: 'Apple Pay disappears',
    },
  ],
  relatedLinks: [],
  reason: 'Concrete reproduction details.',
};

describe('Recap validation', () => {
  it('accepts schema-valid recaps', () => {
    expect(validateRecap(baseRecap).decision).toBe('surface');
  });

  it('rejects model-owned attention and gate fields', () => {
    expect(() => validateRecap({ ...baseRecap, attention_signal: 'protected_label' })).toThrow();
    expect(() => validateRecap({ ...baseRecap, protected_label: true })).toThrow();
    expect(() => validateRecap({ ...baseRecap, linked_open_pr: true })).toThrow();
  });

  it('enforces hard Recap rules', () => {
    expect(() => validateRecap({ ...baseRecap, confidence: 'low' })).toThrow(/surface requires/);
    expect(() => validateRecap({ ...baseRecap, decision: 'dedupe', relatedLinks: [] })).toThrow(/dedupe requires/);
  });

  it('rejects shortTitles that are missing, too long, or end with a period', () => {
    expect(() => validateRecap({ ...baseRecap, shortTitle: '' })).toThrow();
    expect(() => validateRecap({ ...baseRecap, shortTitle: 'x'.repeat(81) })).toThrow();
    expect(() => validateRecap({ ...baseRecap, shortTitle: 'Apple Pay vanishes after cart update.' })).toThrow(
      /must not end with a period/,
    );
  });
});
