export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult<T> {
  output: T;
  model: string;
  usage: CompletionUsage;
}

export type ThinkingEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface CompletionProvider {
  readonly name: string;
  readonly model: string;
  readonly thinkingEffort: ThinkingEffort | undefined;
  complete<T>(args: {
    promptId: string;
    promptVersion: string;
    inputs: Record<string, unknown>;
    schema: Record<string, unknown>;
    maxTokens: number;
    timeoutMs: number;
  }): Promise<CompletionResult<T>>;
}

export class FakeCompletionProvider implements CompletionProvider {
  readonly name = 'fake';
  readonly model = 'fake-completion';
  readonly thinkingEffort = undefined;

  constructor(private readonly responder: (inputs: Record<string, unknown>) => unknown) {}

  async complete<T>(args: {
    promptId: string;
    promptVersion: string;
    inputs: Record<string, unknown>;
    schema: Record<string, unknown>;
    maxTokens: number;
    timeoutMs: number;
  }): Promise<CompletionResult<T>> {
    return {
      output: this.responder(args.inputs) as T,
      model: this.model,
      usage: { inputTokens: JSON.stringify(args.inputs).length, outputTokens: 100 },
    };
  }
}
