# Config Module

Loads environment settings from `.env` and exports normalized configuration values.

- Exposes typed `config` with `port`, `appUrl`, `sessionSecret`, `githubClientId`, `githubClientSecret`, `githubAppId`, `databaseUrl`, and `dataFile`.
- Publishing settings include `publishingTransport` (`mock` unless explicitly `live`), `credentialProvider` (`local` or `gcp`), `secretsProvider` (`env` or `gcp`), bot tokens, and the per-platform client ids/secrets and endpoints for Bluesky, Mastodon, X, Reddit, LinkedIn, and Slack.
- LinkedIn keeps the raw `LINKEDIN_API_VERSION` here; `src/posting/linkedin/config.ts` validates it (`YYYYMM`, within the support window) and is the only source of the request headers. The LinkedIn callback URL is derived from `appUrl`, never request headers.
- Slack keeps `slackClientId`, `slackClientSecret`, `slackAuthorizeUrl`, `slackTokenUrl`, and `slackApiBaseUrl`; `src/posting/slack/config.ts` owns the bot scopes and builds the callback URL from `appUrl`. WhatsApp has no configuration because it is manual-only.
- Analytics settings include `analyticsMaxPostsPerSync`, `analyticsSyncTimeoutMs`, `analyticsSyncLeaseMs`, `analyticsSnapshotRetentionDays`, `analyticsSnapshotMaxPerEntity`, `analyticsMinSampleForTiming` and `analyticsSchedulerToken`. The scheduler endpoint is disabled when the token is empty; a configured token must be at least 32 characters. `linkedinAnalyticsEnabled` (`LINKEDIN_ANALYTICS_ENABLED`) stays false until LinkedIn approves the Community Management API; analytics otherwise fails closed as `needs_approval`.
- AI settings include `aiProvider` (`unconfigured` in production, `mock` in tests), `aiModel`, per-call timeout/retry/output-token bounds, per-campaign call and execution budgets, idea/variation limits, the scheduling gap, and provider-specific OpenAI/Anthropic/Gemini keys, base URLs and models. Research uses `aiResearchProvider` (`none`, `brave`, `reddit`, `both`) with the Brave key/URL or the existing Reddit app credentials. There is no provider fallback; invalid limits fall back to safe defaults.
- `production.ts` validates production startup (HTTPS APP_URL, unique secrets, PostgreSQL, explicit transport, provider keys, lease > timeout) and fails closed. Instrumentation calls it once per server instance; warnings are logged by name only.
- Does not expose secret values to client-side code.
