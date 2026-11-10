# Projects Module

Handles repository connection, project creation, join link generation, invite codes, and generated art.

- `share.ts`: `generateShareLinks` builds the join URL plus LinkedIn, X (Twitter), and WhatsApp share links. The join URL includes `?ref=<code>` only while the referral code is active.
- `referral.ts`: `generateReferralCode` (8 characters, unambiguous alphabet), `normalizeReferralCode`, and `referralCodeMatches` (case-insensitive).
- `referralState.ts`: Client-safe referral lifecycle helpers. `REFERRAL_CODE_TTL_MS` is 7 days; `referralCodeState` returns `active`, `used`, `expired`, or `missing`, and `referralCodeExpiresAt` returns the ISO expiry.
- `logo.ts`: `projectLogoUrl` resolves an uploaded logo to `/api/projects/<id>/logo`, or `null` so the UI falls back to generated art.
- `visibility.ts`: `isDiscoverable` is the single listing rule. It returns true only for public projects that do not use referral links (direct join or screening).

## Rules
- Listing visibility follows the join mode: **private** projects use referral links and never appear in Discover or Explore; **public** projects use direct join or screening and are listed. This is enforced in the server data paths and the Explore API, not only by hiding UI.
- Direct-join projects have no invite code and no screening link. Anyone signed in with GitHub can request to join; the owner still approves or rejects.
- Referral projects always have one invite code. It is valid for 7 days from issue and admits exactly one person — the first successful join request marks it used.
- A used or expired code cannot be applied again, and share links omit it until the owner generates a replacement.
- Regenerating the code replaces the old one, restarts the 7-day window, and clears the used state.
- Invite codes are never returned by public join endpoints — only the owner sees them.
- Logo files are validated by type, size, and magic bytes before being stored under `data/uploads/`.
