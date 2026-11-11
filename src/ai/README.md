# AI Studio (`src/ai/`)

Owner-only campaign assistant behind `/ai` and `/api/ai/*`. It turns one objective into research, a strategy, platform drafts, a quality review, a suggested calendar and internal analytics.

## Invariants

- **Drafts only.** Every agent produces ordinary Crewlink drafts. Approval hashes, duplicate gates, ownership checks and the publish engine in `src/posting/` stay authoritative. No agent approves, publishes or calls a platform API.
- **No credentials.** Nothing here reads the connection vault, decrypted tokens or app secrets.
- **Server-only.** LLM and search keys are read from `src/config/` and never sent to the browser. `/api/ai/status` exposes only provider name, model and configured flags.
- **No fallback.** `AI_PROVIDER=unconfigured` fails closed with 503. A configured provider is used, or the request stops.
- **Ownership.** `access.ts` requires the signed-in project owner and the campaign's creator; other users get 401/403.
- **Honest output.** Research stores only URLs actually retrieved; model-cited links become assumptions. Quality always reports `unverified` and does not claim links were checked. Analytics reports external metrics as unavailable. Provider pricing is unverified, so no cost is recorded.

## Files

- `provider.ts`, `providers/`: provider-independent LLM interface (`unconfigured`, `mock`, `openai`, `anthropic`, `gemini`), selection, status.
- `llm.ts`, `json.ts`: HTTP client, bounded timeout/retries/tokens, JSON extraction and schema helpers.
- `prompts.ts`: shared prompt construction, `<untrusted>` delimiters and forged-tag stripping.
- `orchestrator.ts`, `execution.ts`: stage sequencing, per-task states, execution and token records.
- `research.ts`, `search.ts`: research agent and the Brave/Reddit search gateways (documented APIs only).
- `strategy.ts`, `generation.ts`, `brand.ts`: strategy/calendar, platform drafting through existing validators, project brand profiles.
- `quality.ts`: advisory score, problems, improvements, source checks.
- `scheduling.ts`: deterministic spacing, IANA timezone/DST conversion, manual overrides.
- `analytics.ts`: internal draft/publication/schedule metrics and the list of unavailable external metrics.
- `campaigns.ts`, `actions.ts`, `errors.ts`, `ids.ts`, `types.ts`: storage-backed campaign operations, owner-facing actions, typed errors, ids and interfaces.

## Tests

`tests/ai_provider.test.ts`, `tests/ai_agents.test.ts`, `tests/ai_api.test.ts` and `tests/ai_workspace.test.ts`. All use the mock provider and fake search; no live provider or search call runs in tests.

## Not verified

Live OpenAI/Anthropic/Gemini calls, live Brave/Reddit search, real output quality, provider pricing, and the `20261113000000_m8_ai_workspace` migration (guarded DDL, not applied).
