# Platforms (`src/platforms`)

`registry.ts` is the central list of supported posting destinations and their draft limits. It has no credentials, sending code, or network calls.

Each platform records how Crewlink is authorised:

- `oauth`: the creator connects their own account (Bluesky, Mastodon, X, Reddit, LinkedIn), or installs the Crewlink app in their Slack workspace (Slack). All of them have adapters in `src/posting/adapters/`; Slack authorises a workspace with bot scopes only and publishes to a channel the Crewlink bot can post in.
- `bot`: the creator adds Crewlink's official bot/app to a channel or server (Discord, Telegram). The creator supplies a channel id, never a token; `src/posting/bots/` verifies membership and posting rights before the connection is activated.
- `manual`: Crewlink prepares the text and the creator posts it (WhatsApp). Crewlink builds an official `https://wa.me/` share link and records Prepared, Opened, and Manually marked shared; it has no API, credentials, or delivery claim.

X is recorded with `defaultEnabled: false` and a per-post cost note because it is optional and charges for every publication. The limit is the platform's text limit: Reddit's 40,000-character body limit is used, so the 300-character title rule is a drafting concern handled in `reddit/validate.ts`, and LinkedIn's 3,000-character drafting guard is checked again by the server (`FIELD_LENGTH_TOO_LONG` stays authoritative). LinkedIn publishing is member-only; organization pages need separate LinkedIn products, `w_organization_social`, and page-admin approval, so they are not publishable.

Drafts default to every platform in this list.
