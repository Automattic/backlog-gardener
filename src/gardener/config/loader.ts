import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { type ZodError } from 'zod';

import { TriageProfileSchema, type TriageProfile } from './models.js';

export class ConfigValidationError extends Error {
  readonly issues: string[];

  constructor(path: string, error: ZodError) {
    const issues = error.issues.map((issue) => {
      const issuePath = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${issuePath}: ${issue.message}`;
    });
    super(`Invalid triage profile ${path}:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

export function parseTriageProfile(value: unknown, path = '<inline>'): TriageProfile {
  const result = TriageProfileSchema.safeParse(value);
  if (!result.success) {
    throw new ConfigValidationError(path, result.error);
  }
  return result.data;
}

export async function loadTriageProfile(path: string): Promise<TriageProfile> {
  const raw = await readFile(path, 'utf8');
  return parseTriageProfile(parseYaml(raw), path);
}
