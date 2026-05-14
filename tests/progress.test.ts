import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderProgressEvent } from '../src/gardener/progress.js';

describe('progress rendering', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('renders colorful human-readable progress lines', () => {
    expect(renderProgressEvent({ type: 'run-started', runId: 'run_1', mode: 'sweep' })).toContain('🌱');
    expect(
      renderProgressEvent({ type: 'finding-decided', title: 'Apple Pay vanishes', decision: 'surface' }),
    ).toContain('surface');
  });

  it('honors NO_COLOR', () => {
    vi.stubEnv('NO_COLOR', '1');

    expect(renderProgressEvent({ type: 'run-finished', runId: 'run_1', status: 'completed' })).toBe(
      '✅ Run completed run_1',
    );
  });
});
