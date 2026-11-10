# Projects Module

Handles repository connection, project creation, join link generation, invite codes, and generated art.

- `share.ts`: `generateShareLinks` builds the join URL plus LinkedIn, X (Twitter), and WhatsApp share links. The join URL includes `?ref=<code>` only while the referral code is active.
- `referral.ts`: `generateReferralCode` (8 characters, unambiguous alphabet), `normalizeReferralCode`, and `referralCodeMatches` (case-insensitive).
- `referralState.ts`: Client-safe referral lifecycle helpers. `REFERRAL_CODE_TTL_MS` is 7 days; `referralCodeState` returns `active`, `used`, `expired`, or `missing`, and `referralCodeExpiresAt` returns the ISO expiry.
- `logo.ts`: `projectLogoUrl` resolves an uploaded logo to `/api/projects/<id>/logo`, or `null` so the UI falls back to generated art.

## Rules
- Referral projects always have one invite code. It is valid for 7 days from issue and admits exactly one person — the first successful join request marks it used.
- A used or expired code cannot be applied again, and share links omit it until the owner generates a replacement.
- Regenerating the code replaces the old one, restarts the 7-day window, and clears the used state.
- Invite codes are never returned by public join endpoints — only the owner sees them.
- Logo files are validated by type, size, and magic bytes before being stored under `data/uploads/`.
