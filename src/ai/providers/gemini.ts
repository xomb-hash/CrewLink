import {
  LlmError,
  normalizeUsage,
  requestJson,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '../llm';

interface GeminiOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  retries: number;
}

export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini';
  readonly model: string;
  readonly configured: boolean;

  constructor(private readonly options: GeminiOptions) {
    this.model = options.model;
    this.configured = Boolean(options.apiKey);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (!this.configured) {
      throw new LlmError('not_configured', 'Gemini is not configured.');
    }
    const started = Date.now();
    const url = `${this.options.baseUrl}/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent?key=${encodeURIComponent(this.options.apiKey)}`;
    const body = await requestJson(
      'gemini',
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.user }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: request.maxOutputTokens ?? 2048,
            ...(request.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      },
      { timeoutMs: this.options.timeoutMs, retries: this.options.retries, signal: request.signal }
    );

    const record = body as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
      usageMetadata?: {
        promptTokenCount?: unknown;
        candidatesTokenCount?: unknown;
        totalTokenCount?: unknown;
      };
    };
    const text = (record.candidates?.[0]?.content?.parts || [])
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    if (!text) {
      throw new LlmError('malformed_response', 'Gemini returned no text.');
    }
    return {
      text,
      provider: this.id,
      model: this.model,
      usage: normalizeUsage({
        prompt: record.usageMetadata?.promptTokenCount,
        completion: record.usageMetadata?.candidatesTokenCount,
        total: record.usageMetadata?.totalTokenCount,
      }),
      latencyMs: Date.now() - started,
    };
  }
}
