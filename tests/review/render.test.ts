import { describe, expect, it } from 'vitest';

import { renderReviewPage } from '../../src/gardener/review/render.js';

describe('review rendering', () => {
  it('renders an empty local review page', () => {
    const html = renderReviewPage({ statePath: 'state.db', runs: [], findings: [] });

    expect(html).toContain('Backlog Gardener Review');
    expect(html).toContain('No findings yet');
  });
});
