# M9 — Social Media Analytics & Optimization

Design note written before implementation. It records what already exists, what
is missing, what each platform's official API actually exposes, and the
architecture used by the M9 code.

Status of this document: design + support matrix. Live platform calls are
**not** verified; only mocked or fake-`fetch` tests were run unless a section
says otherwise.

---

## 1. Existing analytics capabilities

Before M9, Crewlink measured **its own activity only**:

- `M8` `ai_campaign_analytics` (`CampaignAnalytics` model): one row per campaign,
  upserted by `collectCampaignAnalytics()` in `src/ai/analytics.ts`. It stores
  `publishedPosts`, `failedPosts`, `scheduledPosts` and `byPlatform`. Its
  `unavailable` list explicitly names impressions, reach, likes, comments,
  shares, clicks and engagement, and its note says no platform analytics API is
  connected.
- Publishing history: `publications` rows (status, mode, external id/url,
  timestamps, content hash) and `platform_connections` (encrypted tokens,
  verified account/channel).
- AI campaign data: campaigns, ideas, generated posts, schedules, executions.
- The `/ai` Analytics section renders the M8 activity counts and the
  unavailable list.

There is **no** platform-reported metric, no post-level or account-level
snapshot, no follower history, no engagement calculation and no analytics route
or page.

## 2. Missing capabilities

- Platform-reported post metrics and account metrics.
- Historical snapshots and trend calculation.
- A normalized metric model with explicit availability (never "0" for missing).
- Documented per-platform engagement-rate formulas.
- A sync engine with rate-limit, token, revocation and partial-failure handling.
- A dedicated `/analytics` workspace with filters, comparison, top content,
  timing and audience views.
- An AI performance analyst grounded in stored metrics.
- Campaign-level performance feedback into the M8 workflow.
- CSV and PDF reporting.

## 3. Official API support (verified against official docs, 2026-11-11)

| Platform | Post-level official data | Account-level official data | Impressions / reach | History | Status |
|---|---|---|---|---|---|
| **X** | Owned-post `public_metrics`, `non_public_metrics`, `organic_metrics`; `GET /2/tweets/analytics` adds hourly/daily buckets | `GET /2/users/me?user.fields=public_metrics` → followers, tweets | Impressions are owner-context only; **no unique reach** | Current totals; metrics endpoint is a 30-day window | **Partial** — owned posts, paid API, private metrics 30 days |
| **LinkedIn** | `GET /rest/memberCreatorPostAnalytics` (impressions, members reached, reactions, comments, reshares, saves, link clicks) | `memberFollowersCount`; org follower/page stats | Member impressions + `MEMBERS_REACHED` (total only, not daily) | Daily buckets over a chosen range | **Needs approval** — `r_member_postAnalytics` via Community Management API |
| **Reddit** | `GET /api/info?id=t3_…` → `score`, `num_comments` | Karma only; no followers count | **No** impressions/reach (`view_count` is undocumented and usually null) | Current counters only | **Partial** — engagement only |
| **Bluesky** | `app.bsky.feed.getPosts` → likes, reposts, replies, quotes, bookmarks | `app.bsky.actor.getProfile` → followers, posts | **No** impressions/reach | Current counters only | **Supported** — public reads |
| **Mastodon** | `GET /api/v1/statuses/:id` → favourites, reblogs, replies, quotes | `GET /api/v1/accounts/:id` → followers, statuses | **No** impressions/reach | Current counters only | **Supported** — per instance, counts only |
| **Discord** | `GET /channels/{id}/messages/{id}` → reactions | `GET /guilds/{id}?with_counts=true` → approximate members | **No** views/impressions | Message exists until deleted; poll to snapshot | **Partial** — reactions and member count only |
| **Telegram** | **No** message read method in the Bot API; views are not exposed | `getChatMemberCount` → subscriber count | **No** | None | **Partial** — account count only |
| **Slack** | `conversations.history` / `replies` + reactions | Channel member count | **No** impressions/reach | Recent history only; free workspaces capped | **Needs permission** — requires `channels:history`/`groups:history` + `reactions:read` and a reinstall |
| **WhatsApp** | None — manual sharing only | None | **No** | None | **Unsupported** |

Sources:

- X: <https://docs.x.com/x-api/fundamentals/metrics>, <https://docs.x.com/x-api/posts/get-post-analytics>, <https://docs.x.com/x-api/getting-started/pricing>
- LinkedIn: <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics>, <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/follower-statistics>, <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics>, <https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access>
- Reddit: <https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki>, <https://www.reddit.com/dev/api/>
- Bluesky: <https://github.com/bluesky-social/bsky/blob/main/lexicons/app/bsky/feed/defs.json>, <https://docs.bsky.app/docs/advanced-guides/rate-limits>
- Mastodon: <https://docs.joinmastodon.org/entities/Status/>, <https://docs.joinmastodon.org/api/rate-limits/>
- Discord: <https://docs.discord.com/developers/resources/message.md>, <https://docs.discord.com/developers/resources/guild.md>
- Telegram: <https://core.telegram.org/bots/api>
- Slack: <https://docs.slack.dev/reference/methods/conversations.history/>, <https://docs.slack.dev/reference/methods/reactions.get/>, <https://docs.slack.dev/reference/methods/admin.analytics.getFile/>
- WhatsApp: <https://faq.whatsapp.com/5913398998672934>

## 4. Required scopes and permissions

| Platform | Already granted by Crewlink | Needed for analytics | Change |
|---|---|---|---|
| X | `tweet.read tweet.write users.read offline.access` | same (owner context) | none |
| LinkedIn | `openid profile w_member_social` | `r_member_postAnalytics` (+ `r_member_profileAnalytics` for followers) via Community Management API | new product approval + reauth |
| Reddit | `identity read submit` | `read` (already) | none |
| Bluesky | `atproto` session | public reads; no new scope | none |
| Mastodon | `read:accounts write:statuses` | `read:statuses` for private statuses | new scope only if private posts matter |
| Discord | View Channel + Send Messages | **Read Message History** (65536) | bot permission toggle |
| Telegram | channel admin + `can_post_messages` | none beyond admin for `getChatMemberCount` | none |
| Slack | `chat:write channels:read groups:read` | `channels:history`/`groups:history`, `reactions:read` | **new scopes + reinstall**; live metrics disabled until then |
| WhatsApp | none | none | unsupported |

Crewlink does **not** silently add scopes. Slack analytics only runs when the
stored connection scopes already contain the history/reaction scopes; otherwise
the platform is reported as `needs_permission`. LinkedIn analytics only runs when
`LINKEDIN_ANALYTICS_ENABLED=true` **and** the stored scope includes
`r_member_postAnalytics`.

## 5. Proposed architecture

```
publish (M2–M7) ──► publications (existing)
                         │
manual sync (owner) ─────┤
                         ▼
             src/analytics/sync.ts
        ┌────────────┬──────────────┬─────────────┐
        ▼            ▼              ▼             ▼
  platform client  metric       storage        sync record
  (mock by default) normalize   (Prisma/file)  (status/errors)
        │            │              │
        │            └──► analytics_posts + analytics_snapshots
        │                        │
        └──► analytics_accounts  └──► queries.ts ──► /api/analytics/* ──► /analytics UI
                                                    │
                                                    ├──► insights.ts (M8 LLM provider)
                                                    └──► reports.ts (CSV/PDF)
```

- New module `src/analytics/` (types, support registry, metrics, clients,
  sync, queries, insights, reports, access).
- Reuses: `publications`, `platform_connections`, M1 credential vault +
  `decryptConnectionTokens`, existing `verifyConnection` token refresh,
  `PUBLISHING_TRANSPORT` mock/live switch, shared HTTP helper, M8 provider /
  `llm.ts` / `json.ts` / prompt conventions, `requireOwnedProject` ownership
  rules, rate limiter, logger.
- No background worker. Sync is an explicit owner action; the response is
  bounded by a post cap and a deadline. Production may call the same route from
  a scheduler, but no worker is started by this code.
- No changes to the publish engine, approval hash or duplicate gates.

## 6. Database changes

Five additive tables (no existing column changes):

- `analytics_accounts` — one row per `platform_connections` row. Latest
  normalized account metrics, availability, last sync/error.
- `analytics_posts` — one row per `publications` row (`publicationId` unique),
  with campaign/draft/platform links, external id/url, content type, latest
  normalized metrics, availability, engagement rate and status.
- `analytics_snapshots` — historical post/account metric snapshots with a unique
  `dedupeKey`, `scope`, `capturedAt`, `source`.
- `analytics_syncs` — one row per sync attempt and platform (status, counts,
  trigger, sanitized error).
- `analytics_insights` — AI analyst output (period, sample size, payload,
  provider/model/token counts, accepted/dismissed state).

Relations cascade from `Project`; `analytics_posts.publicationId` cascades from
`Publication`; `analytics_accounts.connectionId` is unique; snapshots have
per-entity indexes. The migration
`prisma/migrations/20261114000000_m9_analytics` is guarded additive DDL. The
M1–M3 baseline is still missing, so the chain is validated on a scratch database
only (see the final report).

Retention: at most 60 snapshots per post/account and 365 days; pruning runs
after each sync.

## 7. Implementation plan

1. Domain types, support registry, metric normalization and engagement formulas.
2. Prisma schema, guarded migration, file-backed + Prisma storage methods.
3. Mock/live analytics clients and the sync engine.
4. Query services and campaign performance.
5. AI analyst + `/api/analytics/*` routes.
6. `/analytics` UI and navigation.
7. CSV/PDF reports.
8. Tests (storage parity, metrics, sync, AI, security, reports), docs, and
   verification (tsc, full suite, build, prisma validate, migration chain).

## 8. Verification (2026-11-11)

- **Automated tests:** 113 new M9 tests across eight files; full suite 813 passed.
- **TypeScript:** `npx tsc --noEmit` passed.
- **Prisma:** `npx prisma validate` passed and `npx prisma generate` produced the
  M9 models.
- **Build:** `npm run build` passed (Next.js 16.4.5) and emitted `/analytics` plus
  the `/api/analytics/*` routes.
- **Migration chain (scratch PostgreSQL 16):** a pre-M9 schema was created with
  `prisma db push`, the M4/M5/M8 migrations were marked applied, then
  `prisma migrate deploy` applied `20261114000000_m9_analytics`. All five tables,
  their columns, indexes and eleven foreign keys were verified. Re-running the
  migration SQL twice succeeded because every statement is guarded.
- **Empty-database chain:** `prisma migrate deploy` on a truly empty database
  still fails at M4 with `relation "drafts" does not exist`. This is the known
  missing M1–M3 baseline (see `TODO.md`), not an M9 defect. M9 is independently
  deployable only after that baseline exists or on a database already created
  with `prisma db push`.
- **Live calls:** none. Every platform client was exercised with a deterministic
  mock or a fake `fetch`. No real credential, post, view or metric was read.
- **UI:** compiled and type-checked; the server-render smoke test could not reach
  localhost from the sandboxed shell, so no browser screenshot or device test was
  completed. Responsive classes and empty/loading/error/partial states are
  implemented but visually unverified.
