import { describe, expect, it } from 'vitest';

import { configRefForPayload } from '../../src/gardener/app/server.js';

describe('configRefForPayload', () => {
  it('does not read PR head config by default', () => {
    expect(configRefForPayload({ pull_request: { number: 1, head: { sha: 'abc123' } } }, {})).toBeUndefined();
  });

  it('can opt into PR head config for branch-only testing', () => {
    expect(
      configRefForPayload(
        { pull_request: { number: 1, head: { sha: 'abc123' } } },
        { GARDENER_ALLOW_PR_HEAD_CONFIG: 'true' },
      ),
    ).toBe('abc123');
  });

  it('can force a config ref for non-PR webhook testing', () => {
    expect(configRefForPayload({ issue: { number: 2 } }, { GARDENER_CONFIG_REF: 'test-config' })).toBe('test-config');
  });
});
