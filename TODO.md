# Crewlink TODO

Open work from the M1–M8 release-readiness audits (2026-11-11). Each item is a
known gap in the code or its deployment story, not a wish list. Tick an item only
when its "Done when" line is true.

P0 blocks production. P1 blocks running more than one app instance. P2 is
operational follow-up. Items under "Accepted by design" are deliberate.

## P0 — before a real account or a production deploy

- [ ] **Apply the M1–M8 schema.**
  `platform_connections`, `publications` (`connectionId`, `mode`, `externalIds`,
  `confirmedAt`, `targetName`, `externalUrl`), `drafts.threadParts`,
  `drafts.title`/`subreddit`/`submissionType`/`linkUrl`, the `x_usage_ledger`
  table, plus `projects.referralCodeExpiresAt`, `referralCodeUsageLimit`,
  `referralCodeRevokedAt`, a unique `referralCode` index, and
  `applicants.referralCode` with a `(projectId, referralCode)` index exist only in
  `prisma/schema.prisma`. `prisma/migrations/20261111000000_m4_x_publishing` and
  `prisma/migrations/20261112000000_m5_reddit` cover their additions with guarded
  DDL, but the M1–M3 baseline migration is still missing, so the migration
  directory is not deployable on its own. Milestone 6 (LinkedIn) and Milestone 7
  (Slack + WhatsApp) add no schema change and reuse the existing connection and
  publication fields. Milestone 8 adds `ai_campaigns`, `ai_campaign_tasks`,
  `ai_research_sources`, `ai_brand_profiles`, `ai_content_ideas`,
  `ai_generated_posts`, `ai_campaign_schedules`, `ai_agent_executions`,
  `ai_campaign_analytics`, and optional `drafts.campaignId`/`contentIdeaId`, all in
  `prisma/migrations/20261113000000_m8_ai_workspace` (guarded, additive, not
  applied). Milestone 9 adds `analytics_accounts`, `analytics_posts`,
  `analytics_snapshots`, `analytics_syncs`, `analytics_insights` and
  `analytics_sync_locks` in `prisma/migrations/20261114000000_m9_analytics` and
  `20261115000000_m9_production_hardening`. The hardening pass added the missing
  `20261101000000_baseline_m1_m3`; a fresh PostgreSQL database and an M1–M8
  `db push` database were migrated on a scratch instance with no schema drift.
  Check for duplicate `referralCode` values before adding the unique index.
  **Done when:** the reviewed chain is applied to the target using the exact
  sequence in `docs/PRODUCTION-READINESS.md`, then `prisma migrate status`,
  `prisma migrate deploy` and `prisma generate` succeed. Never run migrations
  against the shared database without explicit approval.

- [ ] **Validate the AI provider and research integrations live.**
  Only the deterministic `mock` provider and fake search run in tests. OpenAI,
  Anthropic and Gemini have never been called for real, and neither Brave Search
  nor Reddit public search has been exercised with live credentials. Provider
  pricing is unverified, so no cost is recorded, and real output quality is
  unreviewed. Automation must also be checked against each provider's current
  model names, rate limits and JSON-mode behaviour.
  **Done when:** each selected provider completes one research/strategy/generation
  campaign, search returns cited sources, malformed and rate-limited responses are
  observed, and the results are reviewed for quality. Keys must stay server-side
  and no live call may run from the automated suite.

- [ ] **Make production config fail closed.**
  `APP_URL` defaults to `http://localhost:3100`, placeholder `SESSION_SECRET`
  and `ENCRYPTION_SECRET` values are accepted, `ENCRYPTION_SECRET` falls back to
  `SESSION_SECRET`, and a missing or non-Postgres `DATABASE_URL` silently selects
  the file-backed store (`src/config/index.ts`, `src/lib/storage.ts`).
  **Done when:** a production boot with any of those conditions exits with a
  clear error instead of starting.

- [ ] **Assert live publishing prerequisites at startup.**
  `PUBLISHING_TRANSPORT` must be set to `live` explicitly, and the Discord and
  Telegram bot tokens, the Slack client id/secret, and the KMS/Secret Manager
  credentials must be present. WhatsApp has no prerequisites because it is
  manual-only.
  **Done when:** production startup verifies them, and `.env.example` documents
  every one as required.

- [ ] **Live smoke test each platform.**
  Bluesky, Mastodon, X, Reddit, LinkedIn, and Slack have never been called for
  real; Discord and Telegram only through mock transport, and the WhatsApp
  `wa.me` share link has not been verified end-to-end on a device. For X, also
  confirm that the Crewlink-owned app's billing actually matches the local
  estimate. For Reddit, post once to a throwaway account/subreddit and run a
  revoked-token attempt to confirm the connection is marked disconnected. For
  LinkedIn, post once as a member, then confirm an expired or revoked token is
  reported and disconnected (LinkedIn documents no revocation endpoint, so
  disconnect is a local wipe and the member must remove the app on LinkedIn's
  side). For Slack, install the app in a test workspace, post once to a public
  channel and once to a private channel after `/invite @Crewlink`, then remove
  the app from a channel and confirm the typed `not_in_channel` failure. For
  WhatsApp, prepare a message, open the share link on a real device, and confirm
  the prepared/opened/marked-shared history never claims delivery.
  **Done when:** each platform published once and the failure path was observed.
  X automatic publishing spends real API credits, Reddit needs its own
  account/app approval, LinkedIn needs a LinkedIn app with the OpenID Connect
  and Share on LinkedIn products, and Slack needs a Slack app installed in a
  test workspace, so all four need explicit approval.

- [ ] **Confirm Reddit commercial API access and terms.**
  Crewlink uses Reddit's official OAuth API with `identity read submit` and the
  documented non-commercial rate ceiling. Commercial or high-volume use,
  pricing, retention, attribution, and any required Reddit approval have **not**
  been verified. `src/config/index.ts` centralizes the client id/secret,
  User-Agent, endpoints, and guidance limit, but that is not an access grant.
  **Done when:** Reddit's current terms and commercial-approval requirements are
  documented from the official source and, if needed, approval is obtained; then
  the config limits and `README.md` are updated to match. Do not invent pricing.

- [ ] **Browser-verify the analytics workspace.**
  The UI compiles and the API is covered, but localhost access from the
  sandboxed shell was blocked, so no desktop/mobile browser pass, screenshot or
  console-error check was completed. Test Overview, Platforms, Posts, Top
  content, Audience, Posting time, Campaigns, AI insights, CSV/PDF, empty/loading/
  error/partial/permission states, date and platform filters, horizontal overflow
  and accessibility basics.
  **Done when:** desktop and mobile evidence exists and no console/API errors are
  observed.

- [ ] **Live smoke test analytics.**
  M9 has never called a real analytics API. Each supported platform needs one
  authorized read: X owned-post metrics (paid API; confirm the tier and billing),
  Reddit `score`/`num_comments`, Bluesky `getPosts`/`getProfile`, Mastodon
  status/account counts on a real instance, Discord reactions plus guild counts
  (Read Message History), Telegram subscriber count, and Slack reactions/thread
  replies after adding `channels:history`/`groups:history` + `reactions:read` and
  reinstalling. LinkedIn needs Community Management API approval and
  `r_member_postAnalytics` before `LINKEDIN_ANALYTICS_ENABLED=true` is meaningful.
  **Done when:** each platform synced once, one deliberate revoked-token and one
  rate-limit path were observed, and the UI shows the real availability status.
  Do not claim a number is platform-reported unless the API returned it.

- [ ] **Run the two-account GitHub test.**
  Pre-existing priority from `AGENTS.md`, still outstanding: real GitHub App
  setup plus a second GitHub account in a private browser window.
  **Done when:** create, join, approve and contributor flows pass end to end.

## P1 — before a second app instance

- [ ] **Distributed single-flight for Bluesky refresh.**
  `src/posting/adapters/bluesky.ts` keeps its in-flight map and 60 s reuse window
  in process memory. Two instances refreshing the same connection can race; the
  AT Protocol rotates refresh tokens, so the loser gets a 401 — the send fails
  safely, but the connection can be marked disconnected.
  **Done when:** concurrent refreshes across two processes (DB advisory lock on
  the connection id, or sticky sessions) produce exactly one rotation.

- [ ] **Make the X budget check atomic across instances.**
  `getXBudgetSummary` reads the month's reserved+committed sum, then
  `reserveXUsage` inserts. Two instances publishing at the same moment can both
  pass the check and slightly overshoot `X_MONTHLY_BUDGET_USD`. Duplicate charges
  are still prevented by the unique `publicationId`, and manual publishing is
  unaffected.
  **Done when:** a conditional insert or advisory lock makes the check and the
  reservation one atomic step under concurrent publishers.

- [ ] **Make AI campaign runs single-flight across instances.**
  `src/ai/orchestrator.ts` keeps an in-process `runningCampaigns` set and rejects
  a campaign whose stored status is `running`, but two instances can both read a
  non-running campaign and start it, doubling LLM spend and racing writes.
  Generation is idempotent per idea, so the second run should hit its existing
  guard rather than duplicate drafts, but the cost is still paid.
  **Done when:** a conditional status claim (or DB lock) makes exactly one run
  proceed across processes and the loser returns a conflict.

## P2 — operational follow-ups

- [ ] **Re-verify the X price table before live use.**
  `src/posting/x/pricing.ts` records the official rates and a verification date
  (2026-11-11). X can change pricing or billing semantics (for example per-post
  versus per-request). The estimate is explicitly labelled an estimate and the
  actual charge may differ, but the configured rates should be checked against
  the official docs when automatic publishing is enabled.
  **Done when:** the rates and verification date are re-checked and updated.

- [ ] **Renew the LinkedIn API version before it ages out.**
  `src/posting/linkedin/config.ts` pins the default to `202610`, and LinkedIn
  supports each monthly version for at least 12 months (`202511` sunsets on
  2026-11-16). A malformed or too-old configured value fails closed with
  `linkedin_not_configured`, so an overdue version stops publishing until it is
  changed.
  **Done when:** `LINKEDIN_LATEST_DOCUMENTED_VERSION`/`LINKEDIN_DEFAULT_API_VERSION`
  are raised to a current version, the README notes the new sunset, and the
  version tests still pass.

- [ ] **Confirm LinkedIn app products and organization publishing.**
  Member posting needs the "Share on LinkedIn" and "Sign In with LinkedIn using
  OpenID Connect" products and `w_member_social`. Organization pages need
  Marketing Developer Platform approval, `w_organization_social`, and a page-admin
  role; Crewlink does not implement that. LinkedIn may also impose access,
  rate-limit or commercial terms that have not been reviewed here.
  **Done when:** the app's products, scopes and any rate/commercial terms are
  documented from the official source, and the README/TODO are updated. Do not
  invent limits or pricing.

- [ ] **Confirm Slack app distribution and channel policy.**
  The Crewlink Slack app is installed per workspace with bot scopes only. Slack
  may require app review or admin approval before installing in some workspaces,
  and private-channel posting requires an explicit `/invite @Crewlink`. Rate
  limits are tier-based and handled from `Retry-After`, but the app's rate-limit
  tier and any distribution review have not been verified.
  **Done when:** the app's install/distribution requirements and rate-limit tier
  are documented from Slack's official sources, and the README is updated.

- [ ] **Schedule analytics syncs operationally.**
  The token-authenticated `POST /api/analytics/sync/scheduled` endpoint and
  `docs/PRODUCTION-READINESS.md` now provide the mechanism, locking and retry
  guidance. A deployment still has to create the scheduler, store
  `ANALYTICS_SCHEDULER_TOKEN`, choose a cadence (once or twice a day is
  recommended), and configure alerts for repeated `failed`/`partial` rows. Do not
  add an in-process timer.
  **Done when:** the external scheduler runs against the deployment, calls the
  endpoint with the service token, and alerting is observed for a forced failure.

- [ ] **Alert on repeated adapter failures and `uncertain` publications.**
  Failing sends are recorded, but nobody is told. Distinguish stale `sending`
  rows from ordinary failures so an owner is never asked to retry blindly.
  **Done when:** a metric or scheduled check surfaces both within minutes.

- [ ] **Clean up abandoned OAuth handshakes.**
  Expired `pending` platform connections hold an encrypted client secret until
  something reads them. They expire logically but are never swept.
  **Done when:** a scheduled job deletes or blanks pending rows past
  `oauthStateExpiresAt`.

- [ ] **Stop registering a Mastodon OAuth app on every begin.**
  Each connect attempt registers a new app on the instance, so apps accumulate
  server-side. Reuse a stored app per instance, or document instance-side cleanup.
  **Done when:** repeated begin attempts create at most one app per instance.

- [ ] **Connect official platform analytics before claiming performance.**
  `/ai` analytics read only Crewlink's own drafts, publications and schedules.
  Impressions, reach, likes, comments, shares and clicks need each platform's
  official metrics API and permissions, which are not integrated. Nothing is
  estimated today, and recommendations stay limited to internal activity.
  **Done when:** at least one platform's official metrics are collected with the
  right permissions, the unavailable list is updated, and no metric is inferred.

- [ ] **Verify AI provider pricing before recording cost.**
  Provider pricing has not been checked, so `ai_agent_executions.costMicros`
  stays null and the UI shows no cost. Token counts are recorded.
  **Done when:** current official rates are documented beside the provider
  configuration and cost is computed only from verified rates.

## Accepted by design — do not "fix"

- Uncertain sends are never resent automatically; the owner checks the channel.
- Approval is bound to the exact text and its sha256; any edit needs re-approval.
- Access tokens are plaintext in server memory for the duration of one call.
- `PUBLISHING_TRANSPORT` defaults to mock; nothing publishes without an owner
  clicking publish.
- Mastodon `Idempotency-Key` dedupes only inside the instance's retention window.
- LinkedIn documents no token-revocation endpoint; disconnecting wipes Crewlink's
  encrypted copy and the member removes the app on LinkedIn's side.
- LinkedIn posts are member-only; organization publishing stays unimplemented
  until its products and approval are in place.
- WhatsApp is manual-only. Crewlink cannot observe a WhatsApp send, so a manual
  record never claims sent, delivered, or read, and the share link is built
  locally without contacting WhatsApp.
- Slack channel discovery uses the bot token only. A private channel appears only
  after the bot is invited; Crewlink never auto-joins a channel.
- AI output is ordinary drafts. The AI never approves, publishes, reads decrypted
  credentials, or bypasses ownership; approval hashes and duplicate gates still
  apply, and edited drafts need re-approval.
- AI schedule entries are suggestions with heuristic spacing. They are not
  optimal-time claims, nothing auto-sends, and manual overrides are preserved.
- AI quality scores are advisory, link checking is not performed, and generated
  output is always labelled unverified.
- Model-cited URLs that the configured search provider did not return are treated
  as assumptions, never as sources.
- External analytics metrics remain unavailable rather than estimated, and AI
  provider cost is not recorded while pricing is unverified.
