import { describe, expect, it } from 'vitest';

import {
  renderInvestigationArtifact,
  renderInvestigationArtifactExplanation,
  renderInvestigationArtifactList,
} from '../../src/gardener/app/investigation-artifacts.js';
import type { AppInvestigationArtifactRecord } from '../../src/gardener/app/types.js';

const artifact: AppInvestigationArtifactRecord = {
  id: 'app_inv_1',
  jobId: 'app_job_1',
  runId: 'app_run_1',
  deliveryId: 'delivery-1',
  repo: 'o/r',
  subjectType: 'issue',
  subjectNumber: 7,
  status: 'suppressed',
  suppressionReason: 'maintainer_activity_active',
  publicationStatus: 'skipped',
  generatedBody: null,
  details: { evaluation: { action: 'defer_because_already_active' } },
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:01.000Z',
};

describe('investigation artifact rendering', () => {
  it('renders compact artifact lists', () => {
    expect(renderInvestigationArtifactList([artifact])).toContain(
      'app_inv_1 o/r #7 status=suppressed publication=skipped suppression=maintainer_activity_active',
    );
  });

  it('renders detailed artifact output', () => {
    const output = renderInvestigationArtifact(artifact);

    expect(output).toContain('Investigation: app_inv_1');
    expect(output).toContain('Suppression reason: maintainer_activity_active');
    expect(output).toContain('defer_because_already_active');
  });

  it('renders concise thread explanations', () => {
    const output = renderInvestigationArtifactExplanation(artifact);

    expect(output).toContain('Backlog Gardener explanation');
    expect(output).toContain('Latest artifact: `app_inv_1`');
    expect(output).toContain('Suppression reason: `maintainer_activity_active`');
    expect(output).toContain('Action: `defer_because_already_active`');
  });

  it('renders an explanation when no artifact exists', () => {
    expect(renderInvestigationArtifactExplanation(null)).toContain('do not have a persisted investigation artifact');
  });
});
