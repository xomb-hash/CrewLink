# Lib Module

Core utilities for data storage, validation, authentication, security, and logging.

- `storage.ts`: Dual-engine data store supporting PostgreSQL (via Prisma ORM) in production and development, and isolated JSON/in-memory store for unit tests. Deleting a project cascades to its applicants, drafts, platform connections, publications and M9 analytics rows. Platform connections store only encrypted token envelopes. AI campaign records (campaigns, tasks, research sources, brand profiles, ideas, generated posts, schedules, executions, analytics) and M9 analytics records (accounts, posts, snapshots, syncs, insights) use the same dual-engine path.
- `prisma.ts`: Singleton client connection pool for Prisma ORM.
- `crypto.ts`: AES-256-GCM authenticated encryption at rest for GitHub OAuth tokens. It requires `ENCRYPTION_SECRET` (never a built-in default), always encrypts when called, and throws on corrupted or tampered ciphertext instead of returning an empty string. Legacy plaintext tokens are still decrypted as-is for backward compatibility. Social platform tokens use the versioned vault in `src/posting/credentials.ts`.
- `rateLimit.ts`: Sliding-window rate limiter protecting API routes from abuse and spam.
- `logger.ts`: Production-ready structured JSON logger with automatic PII and token redaction.
- `notifications.ts`: Transactional notification dispatcher for applicant requests, approvals, and rejections.
- `validation.ts`: Validation for project input, applicant notes, HTML escaping, and GitHub account age calculation.
- `auth.ts`: Cookie-based HMAC-SHA256 session management and authentication helpers.
- `utils.ts`: Standard class-merging helper (`cn`) combining `clsx` and `tailwind-merge` for shadcn/ui components.
