import {
  LlmError,
  normalizeUsage,
  requestJson,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '../llm';

interface OpenAIOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  retries: number;
}

export class OpenAIProvider implements LlmProvider {
  readonly id = 'openai';
  readonly model: string;
  readonly configured: boolean;

  constructor(private readonly options: OpenAIOptions) {
    this.model = options.model;
    this.configured = Boolean(options.apiKey);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (!this.configured) {
      throw new LlmError('not_configured', 'OpenAI is not configured.');
    }
    const started = Date.now();
    const body = await requestJson(
      'openai',
      `${this.options.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          temperature: 0.4,
          max_tokens: request.maxOutputTokens,
          ...(request.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      },
      { timeoutMs: this.options.timeoutMs, retries: this.options.retries, signal: request.signal }
    );

    const record = body as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
    };
    const text = record.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new LlmError('malformed_response', 'OpenAI returned no text.');
    }
    return {
      text,
      provider: this.id,
      model: this.model,
      usage: normalizeUsage({
        prompt: record.usage?.prompt_tokens,
        completion: record.usage?.completion_tokens,
        total: record.usage?.total_tokens,
      }),
      latencyMs: Date.now() - started,
    };
  }
}
