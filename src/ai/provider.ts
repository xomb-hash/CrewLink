import { config } from '../config/index';
import { AiUnavailableError } from './errors';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './llm';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { MockLlmProvider } from './providers/mock';
import { OpenAIProvider } from './providers/openai';
import type { AiProviderStatus } from './types';

// These are defaults, not endorsements: set AI_MODEL or the provider-specific
// model variable after checking the provider's current model list.
const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-latest',
  gemini: 'gemini-2.0-flash',
};

export class UnconfiguredProvider implements LlmProvider {
  readonly configured = false;

  constructor(
    readonly id: string,
    readonly model = ''
  ) {}

  async complete(_request: LlmRequest): Promise<LlmResponse> {
    throw new LlmError(
      'not_configured',
      `AI provider "${this.id}" is not configured. Set its API key and AI_MODEL, or choose another provider.`
    );
  }
}

export function createLlmProvider(): LlmProvider {
  const id = config.aiProvider.toLowerCase();
  if (id === 'mock') return new MockLlmProvider();
  if (id === 'openai') {
    return new OpenAIProvider({
      apiKey: config.openaiApiKey,
      baseUrl: config.openaiBaseUrl,
      model: config.openaiModel || config.aiModel || DEFAULT_MODELS.openai,
      timeoutMs: config.aiTimeoutMs,
      retries: config.aiMaxRetries,
    });
  }
  if (id === 'anthropic') {
    return new AnthropicProvider({
      apiKey: config.anthropicApiKey,
      baseUrl: config.anthropicBaseUrl,
      model: config.anthropicModel || config.aiModel || DEFAULT_MODELS.anthropic,
      timeoutMs: config.aiTimeoutMs,
      retries: config.aiMaxRetries,
    });
  }
  if (id === 'gemini') {
    return new GeminiProvider({
      apiKey: config.geminiApiKey,
      baseUrl: config.geminiBaseUrl,
      model: config.geminiModel || config.aiModel || DEFAULT_MODELS.gemini,
      timeoutMs: config.aiTimeoutMs,
      retries: config.aiMaxRetries,
    });
  }
  return new UnconfiguredProvider(config.aiProvider || 'unconfigured');
}

let activeProvider: LlmProvider = createLlmProvider();

export function getLlmProvider(): LlmProvider {
  return activeProvider;
}

// Routes call this before creating any campaign work. There is no fallback: an
// unconfigured provider stops the request with a 503.
export function requireConfiguredProvider(): LlmProvider {
  const provider = getLlmProvider();
  if (!provider.configured) {
    throw new AiUnavailableError(
      `The AI provider "${provider.id}" is not configured. Add its server-side API key or choose another provider.`
    );
  }
  return provider;
}

// Tests and local tooling swap the provider. Production routes never call this.
export function setLlmProvider(provider: LlmProvider): void {
  activeProvider = provider;
}

export function resetLlmProvider(): void {
  activeProvider = createLlmProvider();
}

export function researchProviderStatus(): { provider: string; configured: boolean } {
  const provider = config.aiResearchProvider;
  if (provider === 'brave' || provider === 'both') {
    if (config.braveSearchApiKey) return { provider: 'brave', configured: true };
    if (provider === 'brave') return { provider: 'brave', configured: false };
  }
  if (provider === 'reddit' || provider === 'both') {
    if (config.redditClientId && config.redditClientSecret) {
      return { provider: provider === 'both' ? 'brave,reddit' : 'reddit', configured: true };
    }
    if (provider === 'reddit') return { provider: 'reddit', configured: false };
  }
  return { provider: 'none', configured: false };
}

export function aiProviderStatus(): AiProviderStatus {
  const research = researchProviderStatus();
  return {
    provider: activeProvider.id,
    model: activeProvider.model,
    configured: activeProvider.configured,
    researchProvider: research.provider,
    researchConfigured: research.configured,
  };
}
