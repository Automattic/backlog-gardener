import OpenAI from 'openai';

import type { CompletionProvider, CompletionResult, ThinkingEffort } from './provider.js';
import { loadPromptTemplate } from './prompts.js';

export interface OpenAICompletionProviderArgs {
  apiKey?: string;
  model: string;
  client?: OpenAI;
  thinkingEffort?: ThinkingEffort;
}

function renderTemplate(template: string, inputs: Record<string, unknown>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) => {
    const value = inputs[key];
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  });
}

function schemaName(promptId: string): string {
  return `${promptId.replace(/[^a-zA-Z0-9_-]/g, '_')}_schema`;
}

function parseStructuredOutput<T>(text: string, context: { promptId: string; model: string }): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const preview = text.length > 800 ? `${text.slice(0, 800)}…` : text;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OpenAI structured output was not valid JSON for ${context.promptId} on ${context.model}: ${reason}. ` +
        `This often means the response was truncated; try a higher max_output_tokens or lower thinking effort. Preview: ${preview}`,
    );
  }
}

export class OpenAICompletionProvider implements CompletionProvider {
  readonly name = 'openai';
  readonly model: string;
  readonly thinkingEffort: ThinkingEffort | undefined;
  private readonly client: OpenAI;

  constructor(args: OpenAICompletionProviderArgs) {
    this.model = args.model;
    this.thinkingEffort = args.thinkingEffort;
    this.client = args.client ?? new OpenAI({ apiKey: args.apiKey ?? process.env.OPENAI_API_KEY });
  }

  async complete<T>(args: {
    promptId: string;
    promptVersion: string;
    inputs: Record<string, unknown>;
    schema: Record<string, unknown>;
    maxTokens: number;
    timeoutMs: number;
  }): Promise<CompletionResult<T>> {
    const prompt = await loadPromptTemplate(args.promptId, args.promptVersion);
    const input = [prompt.system, renderTemplate(prompt.user, args.inputs)].filter(Boolean).join('\n\n');
    const request = {
      model: this.model,
      input,
      max_output_tokens: args.maxTokens,
      text: {
        format: {
          type: 'json_schema' as const,
          name: schemaName(args.promptId),
          strict: true,
          schema: args.schema,
        },
      },
      ...(this.thinkingEffort ? { reasoning: { effort: this.thinkingEffort } } : {}),
    };
    const response = await this.client.responses.create(request as never);
    const outputText = response.output_text;
    if (!outputText) throw new Error('OpenAI response did not include output_text');
    return {
      output: parseStructuredOutput<T>(outputText, { promptId: args.promptId, model: response.model ?? this.model }),
      model: response.model ?? this.model,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    };
  }
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  embed(texts: string[]): Promise<{ vectors: number[][]; usage: { tokens: number } }>;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly client: OpenAI;

  constructor(args: { apiKey?: string; model: string; client?: OpenAI }) {
    this.model = args.model;
    this.client = args.client ?? new OpenAI({ apiKey: args.apiKey ?? process.env.OPENAI_API_KEY });
  }

  async embed(texts: string[]): Promise<{ vectors: number[][]; usage: { tokens: number } }> {
    if (texts.length === 0) return { vectors: [], usage: { tokens: 0 } };
    const response = await this.client.embeddings.create({ model: this.model, input: texts });
    return {
      vectors: response.data.map((entry) => entry.embedding),
      usage: { tokens: response.usage?.total_tokens ?? 0 },
    };
  }
}
