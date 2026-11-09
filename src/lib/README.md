# Lib Module

Core utilities for data storage, validation, authentication, security, and logging.

- `storage.ts`: Dual-engine data store supporting PostgreSQL (via Prisma ORM) in production and development, and isolated JSON/in-memory store for unit tests.
- `prisma.ts`: Singleton client connection pool for Prisma ORM.
- `crypto.ts`: AES-256-GCM authenticated encryption at rest for sensitive secrets (GitHub OAuth tokens).
- `rateLimit.ts`: Sliding-window rate limiter protecting API routes from abuse and spam.
- `logger.ts`: Production-ready structured JSON logger with automatic PII and token redaction.
- `notifications.ts`: Transactional notification dispatcher for applicant requests, approvals, and rejections.
- `validation.ts`: Validation for project input, applicant notes, HTML escaping, and GitHub account age calculation.
- `auth.ts`: Cookie-based HMAC-SHA256 session management and authentication helpers.
