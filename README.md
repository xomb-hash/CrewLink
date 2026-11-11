# Crewlink

Crewlink is a place where people who share an idea or goal find each other and start building together.

The first version connects collaborators around GitHub repositories:
1. An **owner** signs in with GitHub and creates a project from a repository they administer.
2. The owner selects a visibility:
   - **Private (default)**: invite-only referral link. The project stays out of Discover, and the owner approves each request.
   - **Public, direct join**: anyone signed in with GitHub can request to join from Discover or Explore; the owner still approves each request.
   - **Public, screening first**: applicants take the owner's test or interview link before approval, and the project appears in Discover and Explore.
3. The owner gets a **join link** and shares it (with built-in LinkedIn, X, and WhatsApp share buttons).
4. An **applicant** opens the link, signs in with GitHub, and requests to join. The owner reviews their account age and public repo count.
5. The owner approves or rejects. Approving marks the applicant as a **Crewlink contributor**; it does not add them as a GitHub collaborator or grant repository permissions. Contributors fork the repository, push to their fork, and open pull requests that the owner reviews and merges.

Crewlink **only connects people**. It is not a chat application and does not track post-approval team performance.

---

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Database / ORM**: PostgreSQL (Supabase) with [Prisma ORM](https://www.prisma.io/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Icons**: [Lucide Icons](https://lucide.dev/)
- **Testing**: Built-in Node test runner (`node:test`) with `tsx` and mock GitHub

---

## Quick Start

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
   *(On Windows PowerShell: `Copy-Item .env.example .env`)*

2. Configure GitHub OAuth App credentials in `.env`:
   - Visit [GitHub Developer Settings](https://github.com/settings/developers) -> **OAuth Apps** -> **New OAuth App**.
   - Application name: `Crewlink`
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:3000/auth/github/callback`
   - Copy the Client ID and create a Client Secret, then paste them into `.env`.

3. Install dependencies:
   ```bash
   npm install
   ```

4. Run automated tests:
   ```bash
   npm test
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Commands

```bash
npm test        # run automated test suites (uses mock GitHub)
npm run dev     # start local development server at http://localhost:3000
npm run build   # compile Next.js production build
npm start       # start Next.js production server
```

---

## GitHub App Setup (Optional Alternative to OAuth App)

If using a GitHub App rather than an OAuth App:
1. GitHub > Settings > Developer settings > GitHub Apps > New GitHub App.
2. Callback URL: `http://localhost:3000/auth/github/callback`.
3. Repository permissions: Administration (Read and write) and Metadata (Read-only).
4. Copy the App ID and Client ID. Generate a client secret and a private key (.pem).
5. Put the .pem in the project directory, fill in `GITHUB_APP_PRIVATE_KEY_PATH` in `.env`, and install the app on a test repo.
Never share or commit `.env` or the `.pem` file.

---

## Resume Storage (Google Cloud Storage)

Applicant PDF resumes are stored in **Google Cloud Storage** when `GCS_BUCKET_NAME` is set:

1. Create a bucket (for example `crewlink-resumes`) and keep it private.
2. Create a service account with the **Storage Object Admin** role on that bucket.
3. In `.env`, set `GCS_BUCKET_NAME`, `GCP_PROJECT_ID`, and either:
   - `GCS_CREDENTIALS_JSON` (the service-account key JSON pasted as one line), or
   - `GOOGLE_APPLICATION_CREDENTIALS` (path to the key file) / Application Default Credentials.

Each resume is saved as `<uuid>.pdf`; the original filename is kept in the database. Downloads still go through the owner/applicant-only route (`/api/resume/[applicantId]`), so the bucket needs no public access and no signed URLs are exposed.
If `GCS_BUCKET_NAME` is empty, resumes fall back to `data/uploads/` on local disk for development and tests. Project logos remain on local disk.

---

## Social Posting Credentials (Milestone 1)

Connections are scoped to one owner and one project. Access and refresh tokens are encrypted before storage and are never returned by an API; draft approval is still required before anything can be published.

- `CREDENTIAL_PROVIDER=local` (default) uses versioned AES-256-GCM with `ENCRYPTION_SECRET_V1`, `ENCRYPTION_SECRET_V2`, and so on. The newest version encrypts new values; older versions still decrypt. Version 1 falls back to `ENCRYPTION_SECRET`/`SESSION_SECRET`.
- `CREDENTIAL_PROVIDER=gcp` uses Cloud KMS. `GOOGLE_CLOUD_KMS_KEY` is the full `projects/.../cryptoKeys/...` resource, authenticated through Application Default Credentials. KMS failures are fatal; there is no fallback to local encryption.
- `SECRETS_PROVIDER=env|gcp` selects where app-level secrets (OAuth client secrets and the shared Telegram/Discord bot tokens) come from. `gcp` reads Secret Manager under `GOOGLE_SECRET_MANAGER_PREFIX` and never falls back to environment variables.

`prisma/schema.prisma` now includes the `platform_connections` model. It has **not** been pushed to the connected database; running `npm run db:push` against a shared database needs explicit approval first.

---

## Discord and Telegram Publishing (Milestone 2)

Discord and Telegram are posted by **Crewlink-owned applications**. Creators never paste a bot token; they connect a channel they control, and the server verifies bot membership and posting rights before the connection becomes active.

- `DISCORD_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`: application-level tokens read through the configured secret store. Missing tokens fail closed; nothing is posted.
- `PUBLISHING_TRANSPORT=mock` (default) uses deterministic fake clients and never touches the network. `live` enables Discord Bot API v10 and Telegram Bot API calls and still does not retry automatically.
- `POST /api/platforms/connections` with a `bot` platform takes `projectId`, `platformId`, and `channelId` (no token). A failed verification returns 400 and stores no connection.
- `POST /api/drafts/[id]/publish` publishes one approved draft. The server re-checks that the draft is approved, that `approvedText` and `approvedHash` match the current text, and that the connection is active. Each draft can reach each platform at most once; a failed attempt may be retried manually after fixing the channel, and the retry claim is conditional so concurrent retries cannot both send.
- Connecting a different channel or server invalidates approved drafts for that platform, so the owner must approve the text again for the new destination.
- A `publications` row is created before the API call (`sending`) and marked `published` or `failed` afterwards. It stores a content hash, never the message text or any token. If a send cannot be recorded, or a `sending` row is stale, the API returns `uncertain` (409) and the draft is never resent automatically.
- Discord and Telegram are independent: one adapter failing never blocks the other, because each publish call reads its own draft, connection, and bot client.

`prisma/schema.prisma` also includes the `publications` model. Like `platform_connections`, it has **not** been pushed to the connected database.

The publishing HTTP calls have only been exercised against fake/mock transports. They need a manual test with real Crewlink-owned Discord and Telegram apps before they can be called working.

---

## Publishing UI

`/publishing` is the owner-only page for the Discord, Telegram, Slack, X, Reddit, LinkedIn, and WhatsApp flows. It is a client UI over the existing owner-enforced APIs; no posting logic was added for it.

- Connect, change, or disconnect the Discord and Telegram channels for an owned project. Connecting verifies the Crewlink bot server-side before the connection becomes active, and changing the channel revokes current approvals.
- Connect a Slack workspace through Slack OAuth, pick a channel the Crewlink app can post in, then compose, approve, and publish. WhatsApp is manual-only: prepare, copy the message, open WhatsApp, and mark it shared by hand.
- Generate drafts, edit the text, save, approve the exact text, then publish. Approving never publishes by itself, and publishing is always a separate click.
- Each draft shows one of: Needs approval, Ready to publish, Publishing, Published, Failed, or Check the channel. Failed sends get a manual retry button. Uncertain sends (a stale `sending` row or a result that could not be recorded) show an instruction to check the channel and have no retry button.
- The fail-safe is enforced in both places: `publicationState.ts` marks uncertain sends as non-actionable, and the publish API still refuses them with 409. Nothing in the UI posts or retries automatically.

The page covers Discord, Telegram, Slack, X, Reddit, LinkedIn, and WhatsApp. Bluesky and Mastodon use the APIs below until their UI is approved.

---

## Bluesky and Mastodon Publishing (Milestone 3)

Creators connect their **own** Bluesky or Mastodon account. Tokens are encrypted with the Milestone 1 credential vault, stay server-side, and are never returned by an API or written to logs or publication records.

### Bluesky

- `POST /api/platforms/connections` with `platformId: "bluesky"`, `identifier` (handle or email), and `appPassword`. The app password is exchanged once for an AT Protocol session; only the access and refresh JWTs are stored (encrypted), not the app password.
- The connection records the handle and DID. Re-authorising the same account keeps current draft approvals; switching accounts invalidates them.
- `POST /api/platforms/connections/[id]/verify` re-checks the session and refreshes it when possible. A revoked session disconnects the connection.
- Posts are validated at 300 grapheme clusters and 3000 bytes. Expired access tokens are refreshed and the post is retried once; ambiguous network failures are reported as `uncertain` and never resent. Successful posts return the `at://` record URI.
- `BLUESKY_SERVICE_URL` defaults to `https://bsky.social`.

### Mastodon

- `POST /api/platforms/connections` with `platformId: "mastodon"` and `instanceUrl` registers a Crewlink OAuth app and returns an `authorizationUrl`. The browser never receives the client secret or a token.
- The instance host must be a public HTTPS origin; loopback, private ranges, link-local addresses, local names, credentials, paths, and query strings are rejected.
- The callback (`GET /api/platforms/mastodon/callback`) validates a single-use, hashed state with a 10-minute expiry, exchanges the code server-side, verifies the account, and stores the encrypted access token plus the normalized instance URL, account id, and username. A denial, expiry, or exchange error clears the pending handshake.
- Requested scopes are `read:accounts` (identity verification) and `write:statuses` (publishing) only.
- Statuses use the connected instance's configured character limit (`/api/v2/instance`, falling back to `/api/v1/instance` and then the documented 500 default). Sends carry an `Idempotency-Key` derived from the publication row.
- Rate limits, server errors, expired/revoked tokens, and ambiguous outcomes map to the same safe states as the Discord/Telegram flow. Revoked tokens disconnect the account; `uncertain` sends are never retried automatically.

Publishing still requires the project owner, an approved draft whose text and hash match, and an active, verified connection. Discord/Telegram behavior is unchanged, and the two account platforms are independent of each other.

`prisma/schema.prisma` adds `instanceUrl`, `oauthStateHash`, `oauthStateExpiresAt`, and `pendingOAuthCiphertext` to `platform_connections`. These changes have **not** been pushed to the connected database; applying them needs explicit approval. `PUBLISHING_TRANSPORT=mock` (the default) uses deterministic Bluesky/Mastodon fakes and makes no network calls. Live Bluesky and Mastodon calls are untested against the real services.

## X Publishing (Milestone 4)

X has two modes, and the UI states which one is being used:

- **Manual Publishing — Free.** The owner composes a thread in Crewlink, copies it or opens X's compose page, posts by hand, then clicks **Mark as published — free**. Crewlink records `mode: "manual"`, makes no X API call, spends no credits, stores no connection, and labels the result as marked by hand and unverified. It never claims X confirmed the post.
- **Automatic Publishing — Requires paid X API access.** Crewlink uses a Crewlink-owned X OAuth 2.0 app and the official paid API. Every automatic post is charged to that app; the estimate and the app-wide monthly budget are shown before publishing.

### Connect and compose

- `POST /api/platforms/connections` with `platformId: "x"` and `projectId` returns an `authorizationUrl` (OAuth 2.0 Authorization Code + PKCE S256). The callback is `GET /api/platforms/x/callback`.
- Requested scopes are `tweet.read tweet.write users.read offline.access` only. Access and refresh tokens are encrypted with the Milestone 1 vault and never returned by an API, written to logs, or stored in publication rows.
- The OAuth state is 32 random bytes, stored only as a sha256 hash with a 10-minute expiry, bound to the initiating user **and** session, and consumed atomically so a callback cannot be replayed. The PKCE verifier and redirect URI live only inside the encrypted pending payload. A denial, expiry, or failed exchange clears the handshake.
- X drafts accept `threadParts` through `PUT /api/drafts/[id]`. Each post uses the official weighted count (Latin 1, CJK/emoji 2, URLs 23) with a 280 limit and a 25-post thread cap. `draft.text` stores the canonical blank-line join, so approval hashes and duplicate checks are unchanged.
- `GET /api/drafts/[id]/x/estimate` returns the request count, local estimate, remaining monthly budget, and whether automatic publishing is configured.

### Automatic publishing and cost protection

- `POST /api/drafts/[id]/publish` with `{ "confirmCost": true, "maxCostUsd": <number> }`. Without `confirmCost` the API returns 402 and sends nothing. The server recomputes the estimate; it refuses the send if the estimate exceeds `maxCostUsd` or the remaining monthly budget.
- Prices live in one module (`src/posting/x/pricing.ts`), using the verified official rates: **$0.015 per create request** and **$0.200 per create request that contains a URL** (verified 2026-11-11, per official X docs). These are estimates; the actual invoice may differ.
- `X_MONTHLY_BUDGET_USD` is an app-wide monthly ceiling for Crewlink-billed X requests (default 10). An invalid or negative value fails closed to 0, which stops automatic publishing. Manual publishing is never limited by it.
- A reservation is written to `x_usage_ledger` before the first request and settles to `committed` on success, `uncertain`, or a partial thread, or `released` on a definitive failure. Reserved and committed rows count against the budget.
- The UI shows "Manual Publishing — Free" and "Automatic Publishing — Requires paid X API access" separately.

### Threads, retries and failures

- Threads post sequentially; each reply uses `reply.in_reply_to_tweet_id` from the previous post. External ids are stored in order.
- An expired access token is refreshed once and the post that received 401 is retried (it was not created). Rate limits, validation errors, and revoked credentials fail the attempt without an automatic resend. Definitive failures can be retried manually with a fresh cost confirmation.
- A network error, timeout, or missing response id is `uncertain`: the publication stays `sending`, keeps any ids and its charge, and is never resent. If at least one thread part was created before a later part failed, the publication becomes a non-retryable `partial_thread`; Crewlink tells the owner to finish on X.
- Duplicate prevention is unchanged: one publication row per draft and platform, a conditional retry claim, and no restart after any external id exists.

`prisma/schema.prisma` adds `drafts.threadParts`, `publications.connectionId`/`mode`/`externalIds`/`confirmedAt`, and the `x_usage_ledger` table. A guarded migration exists at `prisma/migrations/20261111000000_m4_x_publishing`, but the earlier M1–M3 baseline migration is still missing and nothing has been applied to the connected database. Applying migrations needs explicit approval. `PUBLISHING_TRANSPORT=mock` keeps all X calls in the deterministic fake client; no test uses real X credentials or spends credits. Live X calls are untested against the real service.

---

## Reddit Publishing (Milestone 5)

Creators connect their **own** Reddit account through the official OAuth API and publish text or link submissions to a subreddit they can post in. Crewlink never asks for a Reddit password, session cookie, or app password, and never scrapes Reddit or drives a browser.

### Connect and discover

- `POST /api/platforms/reddit/authorize` with `projectId` returns an `authorizationUrl`; the callback is `GET /api/platforms/reddit/callback`. The OAuth client id/secret stay server-side.
- Requested scopes are `identity read submit` only. Access and refresh tokens are encrypted with the Milestone 1 vault and are never returned by an API, written to logs, or stored in publication rows. Reconnecting the same account updates one connection; switching accounts invalidates approved drafts.
- OAuth state is 32 random bytes, stored only as a sha256 hash with a 10-minute expiry, bound to the initiating user **and** session, and consumed atomically before the code exchange. A denial, expiry, session mismatch, or failed exchange clears the handshake.
- `GET /api/platforms/reddit/subreddits?projectId=&q=` searches through the official API, and `GET /api/platforms/reddit/subreddits/[name]?projectId=` returns the community type, subscriber count, posting type, rules, and post requirements (title/body limits, domains, required strings, flair/gallery). Results are cached per user **and** project. Cached permissions are guidance only; the live requirements are read again immediately before publishing.

### Compose, validate and publish

- Reddit drafts carry a required title (300 max), a body (40,000 max), a subreddit (2–21 letters, numbers or underscores), and a `self` or `link` type. Text drafts need a body; link drafts need a public http(s) URL. The server rejects over-limit titles and bodies instead of silently cutting them.
- The composer shows a safe Markdown preview (input is escaped first; links are limited to http/https) and a Reddit-style card reflecting the actual submission. The approval hash covers the subreddit, type, title, body, and link, so changing any of them requires a new approval.
- `POST /api/drafts/[id]/reddit/check` re-reads the subreddit's current rules and reports blocking checks plus anything Crewlink cannot verify (for example, moderator judgment, account-age or karma rules that the API does not return). A private, archived, banned, or muted community blocks the send; restricted communities and flair/gallery requirements are reported explicitly.
- `POST /api/drafts/[id]/publish` uses the existing engine: project owner only, approved draft with a matching text and hash, active connection, and one publication per draft and platform. Text submissions send `kind=self` with `text`; link submissions send `kind=link` with `url`. The submission id (`t3_…`) and external URL are stored without the body or any token.
- Reddit can return HTTP 200 with `json.errors`; those are mapped to typed failures, and `resubmit=false` is sent so Reddit does not create a second post. Rate limits use `x-ratelimit-reset`. A network error, timeout, or response without an id is `uncertain`: the publication stays `sending` and is never resent. Definitive failures can be retried manually after fixing the cause.

### API terms and limits

Crewlink uses Reddit's official OAuth API and enforces its rate-limit headers. Reddit's documented non-commercial OAuth ceiling is used for guidance only (`REDDIT_RATE_LIMIT_PER_MINUTE`, default 100); the API response is authoritative. Commercial or high-volume access, its pricing, retention, and attribution terms have **not** been verified or approved. See `TODO.md`; do not treat a passing test suite as approval to post at scale.

`prisma/schema.prisma` adds Reddit draft fields and publication metadata, and `prisma/migrations/20261112000000_m5_reddit` is guarded DDL for them. The earlier M1–M3 baseline migration is still missing, so the migration directory is **not** independently deployable, and nothing has been applied to the connected database. `PUBLISHING_TRANSPORT=mock` keeps all Reddit calls in the deterministic fake client; no test uses real Reddit credentials. Live Reddit calls are untested against the real service.

---

## LinkedIn Publishing (Milestone 6)

Creators connect their **own** LinkedIn member account through LinkedIn's official OAuth 2.0 flow and publish a text post through the versioned Posts API. Crewlink never asks for a LinkedIn password, never scrapes LinkedIn, and never drives a browser.

### Connect and identity

- `POST /api/platforms/linkedin/authorize` with `projectId` returns an `authorizationUrl`; the callback is `GET /api/platforms/linkedin/callback`. The client id/secret stay server-side, and the redirect URI is derived from `APP_URL`, never from request headers.
- Requested scopes are `openid profile w_member_social` only. LinkedIn's documented flow has no PKCE parameters, so Crewlink does not invent them. Identity is read from the OpenID Connect userinfo endpoint; the member `sub` becomes the author URN `urn:li:person:{sub}`. The browser never supplies the author.
- OAuth state is 32 random bytes, stored only as a sha256 hash with a 10-minute expiry, bound to the initiating user **and** session, and consumed atomically before the code exchange. A denial, expiry, session mismatch, or failed exchange clears the handshake.
- Access and refresh tokens (when LinkedIn actually issues one) are encrypted with the Milestone 1 vault. They are never returned by an API, written to logs, or stored in publication rows. Reconnecting the same account updates one connection; switching accounts invalidates approved drafts.
- LinkedIn does not document a token-revocation endpoint here, so disconnect wipes the encrypted token material locally. Members who want to remove Crewlink entirely must also remove the app from their LinkedIn account.
- LinkedIn access tokens last about 60 days. Refresh tokens are only issued to approved Marketing Developer Platform partners, so Crewlink refreshes only when a refresh token exists; otherwise the account is marked disconnected and the owner reconnects. No refresh is fabricated.

### Member vs organization publishing

Member posts are implemented. Publishing as a LinkedIn **organization page** needs a separate Marketing Developer Platform app and review, the `w_organization_social` permission, and an admin role on the page. That is out of scope and is not implemented; the UI states that Crewlink publishes member posts only.

### API version management

- One module (`src/posting/linkedin/config.ts`) owns the API version, the `LinkedIn-Version` header, and `X-Restli-Protocol-Version: 2.0.0`. Every LinkedIn request (token, userinfo, posts) sends the same version.
- `LINKEDIN_API_VERSION` uses `YYYYMM`; unset means the documented default (currently `202610`). Malformed values and versions older than LinkedIn's 12-month support window fail closed with a clear message before any publication is claimed. `202511` sunsets on 2026-11-16.
- A version rejected by LinkedIn (HTTP 426) is reported with an instruction to update `LINKEDIN_API_VERSION`. Supported version and sunset dates need periodic review; see `TODO.md`.

### Compose, validate and publish

- `PUT /api/drafts/[id]` rejects a LinkedIn post over 3,000 characters instead of silently truncating it. The composer shows a live counter and a LinkedIn-style preview. LinkedIn's Posts API does not publish a numeric text limit, so the registry ceiling is a drafting guard and `FIELD_LENGTH_TOO_LONG` from the API remains authoritative.
- An empty post is blocked before approval (`post_required`). Approval hashes the exact text, so any edit requires a new approval.
- `POST /api/drafts/[id]/publish` reuses the existing engine: project owner only, approved draft with matching text and hash, active connection, and one publication per draft and platform. It sends the documented `/rest/posts` payload with `author`, `commentary`, `visibility: PUBLIC`, `MAIN_FEED` distribution, and `PUBLISHED` lifecycle state.
- The response's `x-restli-id` and a feed link derived only from a documented share/ugcPost URN are stored. No external URL is invented for other id types.
- 401/403, 404/409/400/422, 429, 426, and 5xx responses map to typed failures. A rate limit supplies the retry hint. Over-limit text is reported, not truncated.
- LinkedIn has no idempotency key. A network error, timeout, missing id, or ambiguous response is `uncertain`: the publication stays `sending` and is never resent automatically. Definitive failures can be retried manually after fixing the cause.

No Prisma schema or migration change is needed for M6: the existing `platform_connections` and `publications` models already carry the account metadata and post id/URL. The M1–M3 baseline migration is still missing, so nothing is independently deployable, and nothing has been applied to the connected database. `PUBLISHING_TRANSPORT=mock` keeps all LinkedIn calls in the deterministic fake client; no test uses real LinkedIn credentials. Live LinkedIn calls are untested against the real service, and LinkedIn app product approval is not guaranteed.

---

## Slack Publishing (Milestone 7)

Slack uses the official OAuth v2 install flow and the official Web API. Crewlink never asks for a Slack password or token, never uses an unofficial API, and never drives a browser.

### Create the Slack app

1. Create an app at `https://api.slack.com/apps` ("From scratch") for the workspace you want to test with.
2. Under **OAuth & Permissions**, add only these bot token scopes: `chat:write`, `channels:read`, `groups:read`. Do not add user scopes.
3. Set the redirect URL to `{APP_URL}/api/platforms/slack/callback` (for local development, `http://localhost:3000/api/platforms/slack/callback`).
4. Copy the client id and secret into `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`. Leave them empty to keep Slack disconnected: connecting and automatic publishing fail closed, while drafts stay editable.

Default endpoints are `https://slack.com/oauth/v2/authorize`, `https://slack.com/api/oauth.v2.access`, and `https://slack.com/api`. They can be overridden with `SLACK_AUTHORIZE_URL`, `SLACK_TOKEN_URL`, and `SLACK_API_BASE_URL` for a test proxy; `PUBLISHING_TRANSPORT=mock` (the default) keeps all Slack calls in the deterministic mock client.

### Connect and choose a channel

- `POST /api/platforms/slack/authorize` with `projectId` returns an `authorizationUrl`. `GET /api/platforms/slack/callback` completes the install. The client secret and the OAuth state stay server-side; the redirect URI is derived from `APP_URL`, never from request headers.
- OAuth state is 32 random bytes, stored only as a sha256 hash with a 10-minute expiry, bound to the initiating user **and** session, and consumed atomically before the code exchange. A denial, expiry, session mismatch, replay, or failed exchange clears the handshake.
- Only the bot token is stored, encrypted with the Milestone 1 vault and bound by AAD to the user, platform, and connection. The workspace id/name, bot user id, granted scopes, and install metadata are kept; the token is never returned by an API, written to logs, or stored in a publication row.
- `GET /api/platforms/slack/channels` lists public channels plus private channels the Crewlink bot is already a member of. Crewlink uses the bot token only, so a person's channel access never widens what the bot can see; private channels are **not** auto-joined. To publish to a private channel, invite the app in Slack first (`/invite @Crewlink`), then refresh the list.
- `POST /api/platforms/slack/channel` selects a channel only after verifying it exists, is not archived, and the bot can post (`not_in_channel` / `restricted_action` are refused). Changing the channel or workspace invalidates approved Slack drafts.
- Reconnecting the same workspace updates one connection; switching workspaces clears the old channel and invalidates approvals. `DELETE /api/platforms/connections/[id]` calls `auth.revoke` where possible and always wipes the encrypted token locally.

### Compose and publish

- The composer is plain text with a live Slack mrkdwn preview and the documented 4,000-character limit. Slack mrkdwn is rendered with HTML escaped first, links limited to http(s), and mentions limited to `[@#][A-Za-z0-9]+`; it is not Markdown. Text only; files and media are out of scope.
- `POST /api/drafts/[id]/publish` reuses the shared engine: project owner only, approved draft with matching text and hash, active connection, a verified channel, and one publication per draft and platform. The workspace and channel come from the stored connection, never from the request body.
- A successful `chat.postMessage` stores the Slack `ts` as the external id and the channel id as the target; the content hash is stored, never the message text or token.
- Every Slack response is validated by its JSON `ok` flag, not only the HTTP status. `invalid_auth` / `token_revoked` mark the connection disconnected and ask the owner to reconnect; `missing_scope`, `not_in_channel`, `channel_not_found`, `is_archived`, `restricted_action`, `msg_too_long`, and Slack restrictions map to typed failures without dropping a working install.
- A 429 uses Slack's `Retry-After` for the retry hint. A timeout, network error, missing `ts`, or ambiguous result is `uncertain`: the publication stays `sending` and is never resent automatically. Definitive failures can be retried manually.

### Limits and error handling

- Slack may throttle a workspace (tier-based limits). Crewlink sends one message per explicit publish click and never loops or retries automatically.
- A renamed channel keeps its id, so the stored destination still resolves; a deleted or archived channel reports a channel error and asks the owner to choose another. Channel ids are stored, not names.
- Thread publishing is deliberately not implemented; it is not needed for the approved flow.

No Prisma schema or migration change was needed for Slack: `platform_connections.status` and `publications.status` are already strings, and the existing workspace/channel/external-id fields carry the install data. No migration has been applied to the connected database. `PUBLISHING_TRANSPORT=mock` keeps Slack in the deterministic mock client; no test uses real Slack credentials. **Live Slack calls are untested against the real API.**

---

## WhatsApp Manual Sharing (Milestone 7)

WhatsApp is manual-only. Crewlink has no WhatsApp Business API, no Meta credentials, no OAuth, no credits, and no paid subscription, and it does not use `whatsapp-web.js`, an unofficial API, browser automation, WhatsApp Web session extraction, cookies, or personal-account automation.

- The owner composes plain text with a live counter and preview, saves it, and approves the exact text. Validation reuses the existing checks (empty text, secrets, private links, duplicates) and never truncates; line breaks and URLs are preserved.
- `POST /api/drafts/[id]/whatsapp/prepare` validates the owner, approval, and hash, runs the composer checks, builds an official `https://wa.me/?text=…` click-to-chat link with `encodeURIComponent`, and records a `prepared` publication with `mode: 'manual'`. Building the link never contacts WhatsApp and transmits nothing.
- The owner copies the message and opens WhatsApp through the share link, selects a recipient, and sends the message themselves. `POST /api/drafts/[id]/whatsapp/opened` records that the owner opened WhatsApp; `POST /api/drafts/[id]/whatsapp/shared` records that the owner says they shared it. Both revalidate ownership, approval, and hash.
- History distinguishes **Prepared**, **Opened in WhatsApp**, and **Manually marked shared**. It never says sent, delivered, or verified, because Crewlink cannot observe a WhatsApp send. The share URL is not persisted in the publication row.
- A draft edited after approval cannot be prepared or shared (`draft_changed`), a second share is refused, and concurrent prepares reuse one record. WhatsApp is independent from Slack and every other platform.

The `wa.me` share link has **not** been verified end-to-end on a device in this milestone.

---

## AI Studio (Milestone 8)

`/ai` is an owner-only workspace that turns one objective into a campaign: research, a strategy, platform drafts, a quality pass, a suggested calendar and internal analytics. It reuses the existing drafting, approval, duplicate and publishing rules; it adds no second publishing path.

### Flow

1. **Choose a project and write an objective.** The project must belong to the signed-in owner.
2. **Research.** Crewlink searches through a documented API and stores each result with its URL, publisher, publication date, retrieval time, summary and provider. Search results are marked verified; links you paste are marked unverified. A URL the model cites but the provider did not return is demoted to an assumption, never presented as a source. Retrieved text is wrapped in `<untrusted>` markers and forged tags are stripped so a page cannot inject instructions.
3. **Strategy.** The agent proposes a campaign name, objective, audience, platforms, duration, IANA timezone, themes, posting frequency, a day-by-day calendar, content ideas and desired outcomes. You can edit any of it; edits reject platforms or durations that would break existing ideas.
4. **Brand voice.** Each project has one editable profile: name, description, audience, tone, vocabulary, style, words/topics to avoid, CTAs and example posts. It is included in generation prompts. Crewlink does not learn from private messages or accounts.
5. **Generation.** Platform-specific drafts are produced for LinkedIn, X threads, Reddit self/link posts, Bluesky, Telegram and Slack and validated with the same checks as manual drafting. Over-limit content is rejected, never truncated; duplicate variations are dropped; the join link rule still applies. Each result is an ordinary draft (`status: drafted`) linked to its campaign and idea.
6. **Review.** Quality returns an advisory score, problems, improvements and only the sources that were actually retrieved. It always labels output `unverified` and does not claim links were checked. You can edit or regenerate before approval.
7. **Schedule.** Suggestions use deterministic spacing with per-platform minimum gaps in your timezone (DST-aware), avoid simultaneous posts, and keep any manual override. They are suggestions, not claims of optimal times; no background process sends anything.
8. **Analytics.** Counts come only from Crewlink's own drafts, publications and schedules. External impressions, reach and engagement are reported as unavailable.

Approving and publishing stay manual and unchanged: AI drafts need the normal approval, the approval hash must still match, and duplicate protection applies. The AI never sees decrypted platform credentials, never calls a platform API, and never publishes.

### Configuration

Copy the AI block from `.env.example`. Keys are server-side only and are never sent to the browser.

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `unconfigured` (default, fails closed), `mock` (deterministic, no network), `openai`, `anthropic` or `gemini` |
| `AI_MODEL` | Shared model override; provider-specific `OPENAI_MODEL` / `ANTHROPIC_MODEL` / `GEMINI_MODEL` take precedence |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | Provider keys for the selected provider only |
| `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_MAX_OUTPUT_TOKENS` | Per-call bounds |
| `AI_MAX_LLM_CALLS_PER_CAMPAIGN`, `AI_EXECUTION_BUDGET_MS` | Campaign call and time budget |
| `AI_MAX_DURATION_DAYS`, `AI_MAX_IDEAS_PER_CAMPAIGN`, `AI_VARIATIONS_PER_IDEA` | Campaign size limits |
| `AI_MIN_SCHEDULE_GAP_MINUTES` | Minimum spacing between suggested posts |
| `AI_RESEARCH_PROVIDER` | `none`, `brave`, `reddit` or `both` |
| `BRAVE_SEARCH_API_KEY`, `BRAVE_SEARCH_URL` | Brave Search API for research |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Reddit app-only OAuth for public search |

There is no fallback between providers: an unconfigured provider stops the request with 503 and the UI shows a configuration warning. `mock` makes no network calls and is only for tests or explicit local exploration.

### Limits and unverified work

- **Live OpenAI, Anthropic and Gemini calls are untested.** Only the mock provider runs in tests, and real output quality has not been reviewed.
- **Live Brave and Reddit search is untested.** Tests use fake search results.
- **Provider pricing is unverified**, so no cost estimate is shown or stored.
- **No official platform analytics** are connected, so impressions, reach, likes, comments, shares and clicks are unavailable; no metric is estimated.
- The quality score is advisory, not objective truth, and link checking is not performed.
- The M8 Prisma migration (`prisma/migrations/20261113000000_m8_ai_workspace`) is guarded additive DDL and has **not** been applied. The file-backed and Prisma storage paths are covered by parity tests, but nothing has been migrated.
- The AI workspace does not replace the `/publishing` page. Discord, Telegram, X, Reddit, LinkedIn, Slack and WhatsApp publishing keep their existing flows.

---

## Analytics and Optimization (Milestone 9)

`/analytics` is the owner-only measurement workspace. It covers the loop
**publish → collect → measure → learn → improve** without changing the publish
engine or the approval rules.

- **Manual, bounded sync.** `POST /api/analytics/sync` is an explicit owner
  action, rate limited to 6/minute, capped by `ANALYTICS_MAX_POSTS_PER_SYNC` and
  `ANALYTICS_SYNC_TIMEOUT_MS`. It reuses the existing connection verifier and
  encrypted vault, records one `analytics_syncs` row per platform, and stops on a
  revoked token or rate limit. No background worker is started.
- **Multi-instance safe.** A database lease (`analytics_sync_locks`) is acquired
  atomically per project/platform. It has a unique key, random owner token and
  expiry; release matches the token, so an expired worker cannot release a newer
  lease. A crashed worker is recoverable after `ANALYTICS_SYNC_LEASE_MS`. No
  transaction is held during platform calls.
- **Snapshots, not overwrites.** Post and account metrics are stored as
  timestamped snapshots. A repeat sync with identical values writes nothing; the
  dedupe key makes concurrent writes idempotent. Retention keeps at most
  `ANALYTICS_SNAPSHOT_MAX_PER_ENTITY` snapshots per entity and drops rows older
  than `ANALYTICS_SNAPSHOT_RETENTION_DAYS`.
- **Explicit availability.** A platform that did not return a metric shows an em
  dash, never zero. Each platform has one support status: supported, partial,
  needs approval, needs permission or unsupported. `docs/M9-ANALYTICS.md` records
  the official source for every claim.

| Platform | What the official API provides | Status |
|---|---|---|
| X | Owned-post likes, replies, reposts, quotes, bookmarks, link clicks and owner-context impressions | Partial — paid API, 30-day private metrics, no unique reach |
| LinkedIn | Member impressions, reach, reactions, comments, reshares, saves and link clicks; member followers | Needs approval — `r_member_postAnalytics` via Community Management API |
| Reddit | Submission score and comment count | Partial — no impressions/reach/followers |
| Bluesky | Likes, replies, reposts, quotes, bookmarks; followers and post count | Supported |
| Mastodon | Favourites, replies, reblogs, quotes; followers and status count | Supported per instance; counts only |
| Discord | Message reaction counts; approximate guild member count | Partial — needs Read Message History |
| Telegram | Channel subscriber count only | Partial — Bot API has no message read |
| Slack | Reactions and thread reply counts | Needs permission — `channels:history`/`groups:history` + `reactions:read` and a reinstall |
| WhatsApp | Nothing — manual `wa.me` sharing only | Unsupported |

- **Documented calculations.** `engagementTotal` sums only the actions a platform
  actually returned and reports incomplete totals as partial. `engagementRate`
  exists only where a consistent impressions denominator exists (X and
  LinkedIn); every other platform shows raw engagement. Posting-time suggestions
  need at least 8 measured posts across 3+ days and are labelled as associations,
  not significance.
- **AI performance analyst.** It reuses the M8 provider abstraction, prompt
  rules and JSON validation. The backend calculates every number and gives the
  model a fact catalog with stable IDs, definitions, sample sizes and
  completeness. The model may only use `{{fact:ID}}` placeholders; a literal
  digit, percentage or unknown/missing fact id is rejected before storage. The
  backend renders the values, and the UI/reports render those backend facts, not
  model-authored numbers. It separates correlation from causation and always
  returns `verificationStatus: "unverified"`. With fewer than 3 measured posts it
  records an explicit insufficient-data insight and does not call a model. It
  never changes a campaign, approves, schedules or publishes.
- **Campaign feedback.** `/analytics` shows generated, approved and published
  counts, available engagement, best/weakest post, previous-campaign comparison
  and stored insights for every M8 campaign. Accepting an insight only marks it
  accepted; the owner copies the brief into a new campaign.
- **Reports.** `GET /api/analytics/report?format=csv|pdf` returns a sectioned CSV
  or a dependency-free text PDF with overview, platform comparison, posts, top
  content, campaigns, insights and limitations. Both are owner-only and clearly
  mark incomplete platforms.
- **External scheduler.** `POST /api/analytics/sync/scheduled` is disabled unless
  `ANALYTICS_SCHEDULER_TOKEN` is set (>=32 chars). It accepts
  `x-crewlink-scheduler-token` or a Bearer token, processes at most 20 projects,
  uses the same leases and owner path, and starts no worker. Recommended cadence
  and retry behavior are in `docs/PRODUCTION-READINESS.md`.
- **Migration chain.** The missing M1–M3 baseline is now
  `prisma/migrations/20261101000000_baseline_m1_m3`; M4, M5, M8, M9 and the M9
  hardening migration apply above it. A fresh PostgreSQL database and an
  M1–M8 `db push` database were both migrated on a scratch instance with no
  schema drift. The M9 timestamp is intentionally after M8. No migration has been
  applied to production.
- **Production startup.** Instrumentation fails closed on localhost APP_URL,
  placeholder/short secrets, a non-PostgreSQL database, an implicit transport or
  missing provider credentials. Production requires an explicit
  `PUBLISHING_TRANSPORT`; `mock` remains network-free but must be explicit.
- **Unverified.** No live platform analytics call has been made with real
  credentials. Tests use deterministic mocks and fake `fetch`. LinkedIn access
  needs approval, Slack needs new scopes and a reinstall, Discord needs the Read
  Message History permission. Browser/device verification of the analytics UI
  was not completed in this environment. See `docs/PRODUCTION-READINESS.md`.

---

## Testing Policy

Automated tests in `tests/` use an isolated **fake GitHub** client (`src/github/fake.ts`). They will never make outbound requests to real GitHub.
Real GitHub testing requires setting up a GitHub OAuth App and completing a two-account manual test (owner and applicant).
