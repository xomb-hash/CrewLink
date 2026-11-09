# Automatic Tests

Automated test suite using Node.js's built-in test runner (`node:test` and `node:assert`).

Run all tests:
```bash
node --test
```

## Test Suites
- `storage.test.js`: CRUD operations for projects, applicants, sessions, and users.
- `validation.test.js`: Input validation, GitHub account age calculations, and XSS sanitization.
- `github_fake.test.js`: Mock GitHub API behavior (OAuth token exchange, admin access checking, collaborator invitation calls).
- `auth.test.js`: Session cookie cryptographic signing, verification, and tamper resistance.
- `projects_create.test.js`: Project connection, admin verification check, visibility, and slug creation.
- `projects_share.test.js`: LinkedIn, X, and WhatsApp share URL generation.
- `applicants_join.test.js`: Join page data, join request submissions, account age / public repo reporting, duplicate application prevention.
- `applicants_approve.test.js`: Owner approval flow and dispatching of real GitHub collaborator invitations.
- `applicants_reject.test.js`: Owner rejection flow.
- `security_owner_checks.test.js`: Server-side authorization checks ensuring only repository owners can approve, reject, or inspect applicant details.
- `app_routes.test.js`: HTTP router endpoints, redirects, static assets, and 404 responses.

## Rules
- Automated tests must **never** make live network requests to real GitHub.
- All tests must pass before any change is completed.
