# Automated Tests

Automated test suite using Node.js's native test runner (`node:test`, `node:assert`) with `tsx` for TypeScript execution.

Run all tests:
```bash
npm test
```

## Test Suites
- `storage.test.ts`: CRUD operations for projects, applicants, sessions, and users.
- `validation.test.ts`: Input validation, GitHub account age calculations, and XSS sanitization.
- `github_fake.test.ts`: Mock GitHub API behavior (OAuth token exchange, admin access checking, collaborator invitation calls).
- `auth.test.ts`: Session cookie cryptographic signing, verification, and tamper resistance.
- `crypto.test.ts`: AES-256-GCM encryption/decryption round-trip, tamper resistance, and legacy token compatibility.
- `rate_limit.test.ts`: IP-based sliding-window rate limiting, headers, and quota enforcement.
- `health.test.ts`: System health check endpoint verification, database latency check, uptime reporting, and absence of storage internals in the public payload.
- `explore_api.test.ts`: Public listing discoverability (direct join and screening), referral/private exclusion, role and search filters, and My Applications visibility for private requests.
- `webhooks.test.ts`: GitHub HMAC-SHA256 webhook signature validation and real-time member addition tracking.
- `notifications.test.ts`: Transactional notification event dispatching.
- `projects_share.test.ts`: LinkedIn, X, and WhatsApp share URL generation.
- `projects_api.test.ts`: Next.js API route handlers for project creation and retrieval with admin permission check.
- `applicants_api.test.ts`: Join page data, join request submissions, referral code enforcement, account age / public repo reporting, duplicate application prevention, required credentials, resume access rules, and approval with GitHub collaborator invitation.
- `referral_logo.test.ts`: Invite code generation/normalization, owner-only regeneration, old-link invalidation, notification feed contents, and project logo validation, upload, serving, and path privacy.
- `delete_project.test.ts`: Owner-only project deletion, authentication and 404 handling, and cleanup of applicants, drafts, logo, and resume files.
- `security_checks.test.ts`: Server-side authorization checks ensuring only repository owners can approve, reject, or inspect applicant details.
- `posting.test.ts`: Post draft creation, character and grapheme cluster limits, secret detection, duplicate warnings, and zero-network-call guarantees.


## Rules
- Automated tests must **never** make live network requests to real GitHub.
- All tests must pass before any change is completed.
