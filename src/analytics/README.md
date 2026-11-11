# Analytics (`src/analytics/`)

M9 measurement layer. It reads platform-reported metrics through official APIs,
stores normalized snapshots, calculates a small documented set of Crewlink
values, and produces advisory AI analysis. It never publishes, approves,
schedules, or reads decrypted credentials outside a sync call.

## Invariants

- **No invented metrics.** A metric is stored only when an official API returned
  it. Missing values are `null`/absent with an explicit unavailable list, never
  `0`. There are no estimates, scrapes, browser automation or unofficial APIs.
- **Two numbers, two labels.** Platform-reported metrics and Crewlink-calculated
  engagement totals/rates are kept apart in the database, API and UI.
- **One denominator per platform.** `engagementRate()` returns a rate only for X
  and LinkedIn posts that returned impressions and engagement actions. Every
  other platform shows raw engagement only.
- **No uncontrolled worker.** `POST /api/analytics/sync` is an explicit,
  owner-only, rate-limited action with a post cap and deadline. A deployment may
  call it from a scheduler; this module starts nothing.
- **M8 stays authoritative.** AI output is an ordinary `analytics_insights` row.
  It never changes a campaign, approves a draft, or publishes. Approval hashes,
  duplicate gates and the publish engine are untouched.
- **Credentials stay server-side.** A sync reuses `verifyConnection` and
  `decryptConnectionTokens`; tokens are held in memory for one call, never
  logged or returned, and analytics rows contain no ciphertext.

## Files

- `types.ts`: stored rows, dashboard views, AI payload and support shapes.
- `metricsKeys.ts`: canonical `MetricKey` vocabulary and labels.
- `platforms.ts`: the single support registry (status, metrics, permissions,
  denominator, limitations, docs URL) and engagement formulas.
- `metrics.ts`: per-platform normalization, engagement totals/rates, aggregation,
  trend/band helpers, content-type derivation and stored-metric validation.
- `range.ts`: preset/custom date ranges, previous period, timezone weekday/hour
  helpers.
- `clients/`: mock (default, deterministic) and live read-only clients for X,
  LinkedIn, Reddit, Bluesky, Mastodon, Discord, Telegram and Slack. WhatsApp has
  no client. Live clients are only selected when `PUBLISHING_TRANSPORT=live`;
  Slack requires the history/reaction scopes and LinkedIn requires
  `LINKEDIN_ANALYTICS_ENABLED=true` plus `r_member_postAnalytics`.
- `sync.ts`: owner-triggered sweep; account/post normalization; idempotent
  snapshots; bounded retries/rate limits; partial failures; retention pruning;
  per-process sync lock.
- `queries.ts`: overview, platform comparison, post table, top content, audience,
  posting-time, campaign performance and analytics status.
- `insights.ts`: grounded fact sheet, M8 provider call, strict payload
  validation, insufficient-data short-circuit and insight persistence.
- `reports.ts`: sectioned CSV (formula-injection safe) and a dependency-free text PDF, plus report data. Rendered AI facts are used, not raw model prose.

## Storage

`src/lib/storage.ts` exposes the Prisma and file-backed branches for
`analytics_accounts`, `analytics_posts`, `analytics_snapshots`, `analytics_syncs`
and `analytics_insights`. `prisma/migrations/20261114000000_m9_analytics` is
guarded additive DDL. It has **not** been applied; the M1–M3 baseline migration
is still outstanding.

## Not verified

Live analytics calls have never used real platform credentials. The mocked and
fake-`fetch` tests cover normalization, error mapping, pagination and rate
limits, but only a manual live smoke test can confirm current API behaviour.
LinkedIn analytics additionally needs LinkedIn approval; Slack needs a reinstall
with new scopes; Discord needs Read Message History on the Crewlink bot.
