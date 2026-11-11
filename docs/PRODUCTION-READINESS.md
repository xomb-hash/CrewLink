# Production readiness — M1–M9

This document is the deployment and operations guide for the hardening pass. It
does not claim any live platform integration was verified. Every analytics
credential-dependent integration remains **mocked only** until an authorized
operator runs the smoke test in section 9.

## 1. What hardening changed

- Analytics sync now uses a **database lease per project/platform** instead of an
  in-process mutex. Two application instances cannot sync the same platform at
  the same time.
- AI analytics insights are **fact-grounded**: the backend calculates every
  number, gives the model fact IDs, and rejects any AI-authored digit or percent
  outside a validated `{{fact:ID}}` placeholder. The UI and reports render the
  backend values, not model text numbers.
- The missing **M1–M3 baseline migration** was created. A fresh PostgreSQL
  database can now run `prisma migrate deploy` successfully.
- Production startup now **fails closed** on unsafe defaults (localhost APP_URL,
  placeholder secrets, file-backed database, implicit transport, missing
  provider keys).
- A token-authenticated **scheduler endpoint** was added; it is disabled unless
  `ANALYTICS_SCHEDULER_TOKEN` is configured.
- CSV report formula injection, partial-engagement labelling and DST day
  boundaries were fixed.

No publishing, approval, credential-vault, AI-provider or platform-connection
architecture was replaced.

## 2. Multi-instance synchronization lock

Table: `analytics_sync_locks` (one row per `projectId:platformId`).

- **Acquire:** try a unique-key `INSERT`. If the key exists, issue a conditional
  `UPDATE ... WHERE key = ? AND expiresAt < now()`. Exactly one of two
  concurrent workers gets `count = 1`.
- **Lease:** `ANALYTICS_SYNC_LEASE_MS` (default 120000). Must be greater than
  `ANALYTICS_SYNC_TIMEOUT_MS`; production validation enforces this. A crashed
  worker is recoverable when the lease expires.
- **Owner token:** a random token is stored with the lease. Release is
  `DELETE ... WHERE key = ? AND ownerToken = ?`. An expired worker whose lease
  was recovered cannot delete the new worker's row.
- **Transactions:** none is held during external API calls. Acquisition and
  release are single statements. The sync row (`analytics_syncs`) is status
  tracking, not the mutex.
- **Concurrent requests:** a manual or scheduled request for a platform with a
  live lease receives `sync_in_progress` (HTTP 409 for the owner API; a failed
  result for the scheduler). Locks for the whole request are acquired before
  work starts; if any platform is busy, already-acquired leases are released.
- **File-backed store:** the same API exists for tests and local development.
  It is single-process only; production validation rejects a non-PostgreSQL
  `DATABASE_URL`. Do not run multiple instances on the file store.

## 3. AI fact grounding

Backend (`src/analytics/factGrounding.ts`):

- Calculates totals, rates, period changes, platform comparisons, post values,
  campaign values, format/topic averages, timing buckets and sample sizes.
- Assigns stable IDs such as `total.engagement`, `platform.x.impressions`,
  `post.apost_… .likes`, `comparison.engagement`,
  `campaign.cmp_….engagement`, `timing.weekday.Tue.averageEngagement`.
- Records each fact's definition, completeness (`complete`/`partial`) and sample
  size. Unavailable facts are not offered to the model.

Validation (`src/analytics/insights.ts` + `factGrounding.ts`):

- Unknown fact IDs are rejected.
- A placeholder used without being declared in `factIds` is rejected.
- Any digit, `%`, currency symbol or date outside a placeholder is rejected with
  `unsupported_numeric_claim`.
- A placeholder whose fact is unavailable is rejected.
- Comparisons must cite `comparison.<metric>` and have current and previous
  values; a contradictory direction is rejected.
- Finding sample size and `basis` are derived by the backend from the cited
  facts, not supplied by the model.
- Posting-time claims must cite `timing.*` facts and only appear when at least 8
  measured posts across 3+ days exist.
- `dataQuality`, `limitations` and the fact catalog are backend-authored.

The stored payload keeps both the model text and `rendered*` fields plus the
validated `factCatalog`. The UI, CSV and PDF use the rendered fields and show
fact values with their completeness. AI explanations remain separate from the
authoritative analytics tables.

## 4. Migration strategy

Current chain (`prisma/migrations`):

| Order | Migration | Purpose |
|---|---|---|
| 1 | `20261101000000_baseline_m1_m3` | Core + M1/M2/M3 schema |
| 2 | `20261111000000_m4_x_publishing` | X thread/usage fields |
| 3 | `20261112000000_m5_reddit` | Reddit draft/publication fields |
| 4 | `20261113000000_m8_ai_workspace` | AI campaign tables |
| 5 | `20261114000000_m9_analytics` | Analytics tables |
| 6 | `20261115000000_m9_production_hardening` | Sync lease table |

The M9 timestamp (`20261114000000`) is **intentionally later** than M8's
`20261113000000`, even though the implementation date was 2026-11-11. Prisma
orders migrations by timestamp. It had never been applied, so keeping the order
avoids moving M9 before M8. Never rename an applied migration; the comment in
the SQL records this.

Scratch-database results (PostgreSQL 16):

- Empty database + `prisma migrate deploy`: all six migrations applied.
  `prisma migrate diff` reported **no difference** against the current schema.
- Database already at M1–M8 (created with `prisma db push`): after marking the
  baseline/M4/M5/M8 migrations applied, `migrate deploy` applied M9 + hardening
  and drift was **none**.
- Re-running the M9 and hardening SQL succeeded (guards).
- Foreign keys and indexes for all analytics tables were verified.

### Deployment paths

**A. Fresh database**

1. Back up nothing that does not exist; keep a record of the target.
2. Review all six SQL files.
3. Set `DATABASE_URL` to the scratch/target database.
4. Run `npx prisma migrate deploy`.
5. Run `npx prisma migrate status` and `npx prisma validate`.

**B. Existing database created with `prisma db push` (M1–M8)**

This is the likely current production shape. The database has tables but no
`_prisma_migrations` history.

1. Take a verified backup.
2. Run `npx prisma migrate status` and confirm the schema already contains the
   M1–M8 tables and columns.
3. Mark the existing shape's migrations as applied **without running them**:
   ```
   npx prisma migrate resolve --applied 20261101000000_baseline_m1_m3
   npx prisma migrate resolve --applied 20261111000000_m4_x_publishing
   npx prisma migrate resolve --applied 20261112000000_m5_reddit
   npx prisma migrate resolve --applied 20261113000000_m8_ai_workspace
   ```
   Run these one at a time. Do not run the baseline SQL against a populated
   database.
4. Run `npx prisma migrate deploy`; it applies only M9 and hardening.
5. Run `npx prisma migrate status`; all six should be applied.
6. Run `npx prisma generate` for the deployment artifact.

**C. Existing database already at M9 but not hardening**

First run `npx prisma migrate status`. If the baseline/M4/M5/M8/M9 rows are
missing from `_prisma_migrations` but their schema is demonstrably present, mark
each one applied in order (baseline first), then deploy:
```
npx prisma migrate resolve --applied 20261101000000_baseline_m1_m3
npx prisma migrate resolve --applied 20261111000000_m4_x_publishing
npx prisma migrate resolve --applied 20261112000000_m5_reddit
npx prisma migrate resolve --applied 20261113000000_m8_ai_workspace
npx prisma migrate resolve --applied 20261114000000_m9_analytics
npx prisma migrate deploy
```
Only include rows that are genuinely missing. Never mark a migration whose
schema is absent.

**D. Empty database with a partial migration table**

Inspect `prisma migrate status` and `_prisma_migrations` first. Resolve only
migrations whose schema is demonstrably present. Never edit an applied
migration; never `db push` a production database to “fix” history.

### Rollback limitations

- Migrations are additive. There is no down-migration; schema rollback means
  restoring the verified backup.
- Deploy the M9 application **after** M9/hardening SQL is applied. Older app code
  can run against the new tables, but the new lock/AI code must not run against a
  database without `analytics_sync_locks`.
- Removing analytics data is a product decision; do not drop tables during an
  incident.

## 5. Scheduler integration

No worker starts inside the app. An external scheduler calls:

```
POST /api/analytics/sync/scheduled
x-crewlink-scheduler-token: <ANALYTICS_SCHEDULER_TOKEN>
Content-Type: application/json

{"projectIds":["prj_..."]}
```

- The endpoint is disabled (503) unless the token is configured with at least 32
  characters. Wrong/missing tokens get 401. It is rate-limited to 6 req/min per
  IP and processes at most 20 projects per call.
- `projectIds` is optional. Without it, projects with an active platform
  connection are selected (up to 20).
- Ownership is enforced by the service token; each project is synced through
  the same owner-scoped sync engine. The endpoint never returns credentials.
- Recommended cadence: once or twice per day per project. Analytics snapshots
  change slowly; more frequent polling increases platform costs and rate-limit
  pressure without adding useful history.
- Retry behavior: a 200 response can contain per-project `failed`/`partial`
  results. Retry only `failed` results after the lease expires (at least
  `ANALYTICS_SYNC_LEASE_MS`); never retry a `sync_in_progress` immediately.
- Monitor `analytics_syncs.status`, `errorCode`, `finishedAt` and the lock table.
  Alert on repeated `auth_revoked`, `rate_limited`, `permission_missing` or
  `sync_timeout`. A stale lock older than the lease is recoverable; do not
  delete a live lock manually.
- Keep the token in the scheduler's secret store. Never put it in a browser,
  query string, report, or client bundle.

## 6. Production configuration

Production startup calls `validateProductionConfig()` from
`src/instrumentation.ts`. It fails closed for:

- Missing/non-HTTPS/localhost `APP_URL`.
- Missing/default/short `SESSION_SECRET`.
- Missing/default/short `ENCRYPTION_SECRET_V1` (or `ENCRYPTION_SECRET`).
- Missing/non-PostgreSQL `DATABASE_URL`.
- Unset or unknown `PUBLISHING_TRANSPORT` (must be explicit `live` or `mock`).
- `CREDENTIAL_PROVIDER=gcp` without `GOOGLE_CLOUD_KMS_KEY`.
- `SECRETS_PROVIDER=gcp` without `GOOGLE_CLOUD_PROJECT`.
- Selected AI provider without its key.
- Research provider without its key/credentials.
- `LINKEDIN_ANALYTICS_ENABLED=true` without LinkedIn credentials.
- `ANALYTICS_SCHEDULER_TOKEN` shorter than 32 characters.
- `ANALYTICS_SYNC_LEASE_MS <= ANALYTICS_SYNC_TIMEOUT_MS`.

Warnings (not failures): explicit `PUBLISHING_TRANSPORT=mock`, explicit
`AI_PROVIDER=mock`, and `live` with no platform credentials yet.

Required production variables (see `.env.example`):
`APP_URL`, `SESSION_SECRET`, `ENCRYPTION_SECRET_V1`/`ENCRYPTION_SECRET`,
`DATABASE_URL`, `PUBLISHING_TRANSPORT`.

Optional: platform client IDs/secrets, bot tokens, AI provider key/model,
research keys, `LINKEDIN_ANALYTICS_ENABLED`, `ANALYTICS_*`, and
`ANALYTICS_SCHEDULER_TOKEN` (empty disables the scheduler).

Mock is never selected silently in production; it must be written explicitly.
`PUBLISHING_TRANSPORT=mock` makes no real publishing or analytics network calls.

## 6b. Platform readiness

No live platform analytics credential was available in this environment. The
following statuses are therefore deliberate:

| Platform | Status | What is implemented | What is still required |
|---|---|---|---|
| X | Implemented, awaiting credentials; partially supported | Owned-post `public_metrics`/`non_public_metrics`/`organic_metrics`, user public metrics, rate-limit mapping, no unique reach | Paid X API access and a real owned-post read; confirm current tier/price and 30-day private-metric window |
| LinkedIn | Implemented, awaiting API approval | Member post/follower normalization, version headers, approval/scope gate | Community Management API approval, `r_member_postAnalytics` on the connection, live member read |
| Reddit | Mocked only; partially supported | `score` and `num_comments` normalization, `api/info`, pagination/rate-limit response handling | Confirm Reddit API/commercial terms and run one authorized read; impressions/reach remain unavailable |
| Bluesky | Implemented, awaiting live verification | Public post/profile reads, likes/replies/reposts/quotes/bookmarks, followers/posts | One live authorized/public read and a snapshot check |
| Mastodon | Implemented, awaiting live verification | Status/account counts, SSRF-pinned instance request, per-instance limits | Live instance read with the granted `read:statuses`/`read:accounts` scopes |
| Discord | Implemented; partial, permission-dependent | Message reaction sum, approximate guild member count, error mapping | Bot needs View Channel + Read Message History; live read of one message |
| Telegram | Implemented; partial | `getChatMemberCount` only | Live channel subscriber read; post-level metrics stay unsupported |
| Slack | Implemented, awaiting permission | Reactions and thread replies, cursor pagination, `ok:false` mapping, scope gate | Add `channels:history`/`groups:history` + `reactions:read`, reinstall the app, verify channel/message read |
| WhatsApp | Unsupported | Explicit unsupported status, no client, no credentials | Nothing to verify; manual sharing has no analytics API |

The fake-`fetch` tests cover endpoint shape, scopes/permission gates, token-free
errors, rate-limit/Retry-After handling, pagination, normalization, missing
metrics, revoked/expired credentials and snapshot persistence. They do **not**
prove current live API behavior.

## 7. Security audit summary

Fixed in this pass:

- Cross-instance sync race → atomic database leases with token-safe release.
- AI fabricated numbers/unknown fact IDs → hard validation and backend rendering.
- Fresh-deploy failure → reviewed additive baseline.
- Unsafe production defaults → startup failure.
- CSV formula injection → cell neutralization.
- Prompt injection surface → analytics facts wrapped as untrusted data; model
  numbers are placeholders only.
- Partial engagement presented as complete → action-aware completeness labels.
- DST day counting mismatch → timezone-aware calendar dates.

Verified (existing behavior preserved): owner/project/campaign access checks,
connection ownership, OAuth state validation, AES-GCM/AAD vault, no token in
analytics tables, no token in API responses/logs, cross-project analytics
isolation, rate limits. No critical/high finding remains from the review.

## 8. Verification results

- New M9-hardening tests: lock, fact grounding, scheduler, production config,
  migration guards, DST, CSV injection, partial engagement.
- Full suite: **830 tests, 830 pass** (see final report for the exact number;
  run `npm test` before deployment).
- `npx tsc --noEmit`, `npx prisma validate`, `npx prisma generate`,
  `npm run build`: pending final run recorded in the delivery report.
- Empty database migration, M1–M8 upgrade, M9 upgrade, schema drift, FKs,
  indexes and idempotent re-execution: verified on scratch PostgreSQL 16.
- Browser verification: **not completed** in this environment; localhost access
  from the sandboxed shell was blocked. Do not treat the UI as visually
  verified until section 9 is run on a real browser.

## 9. Deployment checklist

1. **Back up** the database and verify the restore procedure. Record the current
   `_prisma_migrations` state (if any).
2. **Review migrations** (all six files) and this document. Confirm the target is
   either fresh, M1–M8 via `db push`, or already has M9.
3. **Configure environment** using `.env.example`; run the production validation
   locally with the real variable names (never paste secrets into a report).
   Ensure `APP_URL` is HTTPS, production secrets are unique, and
   `PUBLISHING_TRANSPORT`/`AI_PROVIDER` are explicit.
4. **Apply migrations** with `npx prisma migrate deploy` (or the resolve sequence
   in section 4 for a db-pushed database). Run `npx prisma migrate status` and
   `npx prisma validate`. Do not run `db push` against production.
5. **Deploy the application.** Start one instance, verify `/api/health`, then
   scale. Confirm the production startup check did not fail.
6. **Verify platform connections.** Reverify each connected account/channel
   through the existing `/publishing` flow. LinkedIn analytics stays off until
   Community Management API approval; Slack analytics stays
   `needs_permission` until the app is reinstalled with history/reaction scopes;
   Discord needs Read Message History; WhatsApp remains unsupported.
7. **Analytics smoke test.** As the project owner, run one manual sync. Confirm
   `analytics_posts`, `analytics_accounts` and one snapshot per measured entity,
   and that `analytics_sync_locks` is empty afterwards. Then call the scheduler
   endpoint with the service token from the deployment environment (not a
   browser). Confirm a second immediate call is `sync_in_progress`, not a
   duplicate sync.
8. **Monitor.** Alert on repeated `analytics_syncs` failures, stale locks beyond
   the lease, `uncertain` publications, auth revocations, 429s and startup
   configuration errors. Re-run the two-account GitHub test and the live platform
   smoke tests listed in `TODO.md` before claiming those integrations are live.
