import Anthropic from '@anthropic-ai/sdk';

import type { CompletionProvider, CompletionResult, ThinkingEffort } from './provider.js';
import { loadPromptTemplate } from './prompts.js';

export interface AnthropicCompletionProviderArgs {
  apiKey?: string;
  model: string;
  client?: Anthropic;
  thinkingEffort?: ThinkingEffort;
}

function renderTemplate(template: string, inputs: Record<string, unknown>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) => {
    const value = inputs[key];
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  });
}

export class AnthropicCompletionProvider implements CompletionProvider {
  readonly name = 'anthropic';
  readonly model: string;
  readonly thinkingEffort: ThinkingEffort | undefined;
  private readonly client: Anthropic;

  constructor(args: AnthropicCompletionProviderArgs) {
    this.model = args.model;
    this.thinkingEffort = args.thinkingEffort;
    this.client = args.client ?? new Anthropic({ apiKey: args.apiKey ?? process.env.ANTHROPIC_API_KEY });
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
    const request = {
      model: this.model,
      max_tokens: args.maxTokens,
      messages: [{ role: 'user' as const, content: renderTemplate(prompt.user, args.inputs) }],
      tools: [
        {
          name: 'emit_recap',
          description: 'Emit the structured Backlog Gardener Recap JSON.',
          input_schema: args.schema as { type: 'object'; properties?: unknown; required?: string[] },
        },
      ],
      tool_choice: { type: 'tool' as const, name: 'emit_recap' },
      ...(prompt.system ? { system: prompt.system } : {}),
    };
    const response = await this.client.messages.create(request);
    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Anthropic response did not include expected tool_use output');
    }
    return {
      output: toolUse.input as T,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
