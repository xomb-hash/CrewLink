# Projects Module

Handles repository connection, project creation, join link generation, invite codes, and generated art.

- `share.ts`: `generateShareLinks` builds the join URL (including `?ref=<code>` for referral projects) plus LinkedIn, X (Twitter), and WhatsApp share links.
- `referral.ts`: `generateReferralCode` (8 characters, unambiguous alphabet), `normalizeReferralCode`, and `referralCodeMatches` (case-insensitive).
- `logo.ts`: `projectLogoUrl` resolves an uploaded logo to `/api/projects/<id>/logo`, or `null` so the UI falls back to generated art.

## Rules
- Referral projects always have one active invite code; regenerating it replaces the old one and invalidates previously shared links.
- Invite codes are never returned by public join endpoints — only the owner sees them.
- Logo files are validated by type, size, and magic bytes before being stored under `data/uploads/`.
