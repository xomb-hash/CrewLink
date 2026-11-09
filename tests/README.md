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
- `health.test.ts`: System health check endpoint verification, database latency check, and uptime reporting.
- `webhooks.test.ts`: GitHub HMAC-SHA256 webhook signature validation and real-time member addition tracking.
- `notifications.test.ts`: Transactional notification event dispatching.
- `projects_share.test.ts`: LinkedIn, X, and WhatsApp share URL generation.
- `projects_api.test.ts`: Next.js API route handlers for project creation and retrieval with admin permission check.
- `applicants_api.test.ts`: Join page data, join request submissions, account age / public repo reporting, duplicate application prevention, and approval with GitHub collaborator invitation.
- `security_checks.test.ts`: Server-side authorization checks ensuring only repository owners can approve, reject, or inspect applicant details.

## Rules
- Automated tests must **never** make live network requests to real GitHub.
- All tests must pass before any change is completed.
