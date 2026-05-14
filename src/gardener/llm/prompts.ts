import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'prompts');

export interface PromptTemplate {
  promptId: string;
  promptVersion: string;
  system: string | null;
  user: string;
  raw: string;
}

async function resolvePromptIncludes(raw: string): Promise<string> {
  return raw.replace(/{{\s*persona:([a-zA-Z0-9_-]+)\s*}}/g, (_match, persona: string) => {
    return `__PERSONA_INCLUDE__${persona}__`;
  });
}

async function loadPersonaIncludes(raw: string): Promise<string> {
  let resolved = await resolvePromptIncludes(raw);
  const includes = [...resolved.matchAll(/__PERSONA_INCLUDE__([a-zA-Z0-9_-]+)__/g)];
  for (const include of includes) {
    const persona = include[1];
    const text = await readFile(join(root, 'personas', `${persona}.md`), 'utf8');
    resolved = resolved.replaceAll(include[0], text.trim());
  }
  return resolved;
}

export function parsePromptMarkdown(raw: string): { system: string | null; user: string } {
  const system = /^## SYSTEM\s*$/m.exec(raw);
  const user = /^## USER\s*$/m.exec(raw);
  if (!system && !user) return { system: null, user: raw.trim() };
  const systemText = system ? raw.slice(system.index + system[0].length, user?.index ?? raw.length).trim() : null;
  const userText = user ? raw.slice(user.index + user[0].length).trim() : raw.trim();
  return { system: systemText, user: userText };
}

export async function loadPromptTemplate(promptId: string, promptVersion: string): Promise<PromptTemplate> {
  const raw = await readFile(join(root, promptId, `${promptVersion}.md`), 'utf8');
  const resolved = await loadPersonaIncludes(raw);
  const parsed = parsePromptMarkdown(resolved);
  return { promptId, promptVersion, raw: resolved, ...parsed };
}

export async function loadPromptSchema(promptId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, promptId, 'schema.json'), 'utf8')) as Record<string, unknown>;
}
