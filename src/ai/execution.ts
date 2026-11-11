import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './llm';

export interface AgentRuntime {
  readonly provider: LlmProvider;
  readonly signal?: AbortSignal;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  startedAt: number;
  complete(request: LlmRequest): Promise<LlmResponse>;
  summary(): {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs: number;
  };
}

export interface RuntimeOptions {
  signal?: AbortSignal;
  maxCalls?: number;
  // 0 or undefined means no token ceiling.
  maxTokens?: number;
}

// Bounds every agent run: calls, tokens, cancellation. Limits throw typed errors
// so the orchestrator can stop a campaign without an uncontrolled loop.
export function createAgentRuntime(
  provider: LlmProvider,
  options: RuntimeOptions = {}
): AgentRuntime {
  const startedAt = Date.now();
  const maxCalls = options.maxCalls ?? 0;
  const maxTokens = options.maxTokens ?? 0;
  const runtime: AgentRuntime = {
    provider,
    signal: options.signal,
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    startedAt,
    async complete(request: LlmRequest): Promise<LlmResponse> {
      if (options.signal?.aborted) {
        throw new LlmError('aborted', 'The AI run was cancelled.');
      }
      if (maxCalls > 0 && runtime.calls >= maxCalls) {
        throw new LlmError(
          'limit_reached',
          `This campaign reached its limit of ${maxCalls} model calls.`
        );
      }
      const response = await provider.complete({ ...request, signal: options.signal });
      runtime.calls += 1;
      runtime.promptTokens += response.usage.promptTokens;
      runtime.completionTokens += response.usage.completionTokens;
      runtime.totalTokens += response.usage.totalTokens;
      if (maxTokens > 0 && runtime.totalTokens > maxTokens) {
        throw new LlmError(
          'token_limit',
          `This campaign exceeded its token budget of ${maxTokens}.`
        );
      }
      return response;
    },
    summary() {
      return {
        calls: runtime.calls,
        promptTokens: runtime.promptTokens,
        completionTokens: runtime.completionTokens,
        totalTokens: runtime.totalTokens,
        latencyMs: Date.now() - startedAt,
      };
    },
  };
  return runtime;
}
