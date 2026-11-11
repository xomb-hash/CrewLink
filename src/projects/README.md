# Projects Module

Handles repository connection, project creation, join link generation, invite codes, and generated art.

- `share.ts`: `generateShareLinks` builds the join URL plus LinkedIn, X (Twitter), and WhatsApp share links. While the code is active the join URL is the reusable `/join/<code>` path; it falls back to the project slug URL when the code is missing, revoked, expired, fully used, or at its usage limit.
- `referral.ts`: `generateReferralCode` (`CREW-` plus 5 characters from an unambiguous alphabet), `normalizeReferralCode`, and `referralCodeMatches` (case-insensitive).
- `referralState.ts`: Client-safe referral lifecycle helpers. `referralCodeState(project, usageCount)` returns `active`, `expired`, `limit-reached`, `revoked`, `used`, or `missing`; expiry is optional and owner-set (there is no default TTL).
- `logo.ts`: `projectLogoUrl` resolves an uploaded logo to `/api/projects/<id>/logo`, or `null` so the UI falls back to generated art.
- `visibility.ts`: `isDiscoverable` is the single listing rule. It returns true only for public projects that do not use referral links (direct join or screening).

## Rules
- Listing visibility follows the join mode: **private** projects use referral links and never appear in Discover or Explore; **public** projects use direct join or screening and are listed. This is enforced in the server data paths and the Explore API, not only by hiding UI.
- Direct-join projects have no invite code and no screening link. Anyone signed in with GitHub can request to join; the owner still approves or rejects.
- Every referral project has one reusable invite code, so a single link can admit many people. Each applicant still gets an independent application and the owner approves each one.
- Usage is unlimited by default. The owner can set a usage limit or expiry date; the link closes when either is reached, and share links fall back to the slug URL.
- Revoking sets `referralCodeRevokedAt` immediately. Regenerating replaces the code, clears revocation and expiry, and starts a fresh usage count.
- Legacy single-use codes (`referralCodeUsedAt`) stay closed instead of becoming reusable.
- Invite codes are never returned by public join endpoints — only the owner sees them.
- Logo files are validated by type, size, and magic bytes before being stored under `data/uploads/`.
