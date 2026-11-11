import {
  LlmError,
  normalizeUsage,
  requestJson,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '../llm';

interface AnthropicOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  retries: number;
}

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly model: string;
  readonly configured: boolean;

  constructor(private readonly options: AnthropicOptions) {
    this.model = options.model;
    this.configured = Boolean(options.apiKey);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (!this.configured) {
      throw new LlmError('not_configured', 'Anthropic is not configured.');
    }
    const started = Date.now();
    const body = await requestJson(
      'anthropic',
      `${this.options.baseUrl}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          max_tokens: request.maxOutputTokens ?? 2048,
          temperature: 0.4,
        }),
      },
      { timeoutMs: this.options.timeoutMs, retries: this.options.retries, signal: request.signal }
    );

    const record = body as {
      content?: Array<{ type?: string; text?: unknown }>;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    const text = (record.content || [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('')
      .trim();
    if (!text) {
      throw new LlmError('malformed_response', 'Anthropic returned no text.');
    }
    return {
      text,
      provider: this.id,
      model: this.model,
      usage: normalizeUsage({
        prompt: record.usage?.input_tokens,
        completion: record.usage?.output_tokens,
      }),
      latencyMs: Date.now() - started,
    };
  }
}
