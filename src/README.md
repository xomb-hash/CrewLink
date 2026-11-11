# Source Architecture (`src/`)

Modern Next.js App Router and TypeScript application structure:

- `app/`: Next.js App Router pages (landing, dashboard, new project, join) and API route handlers.
- `components/`: Modular React components styled with Tailwind CSS and Lucide icons.
- `config/`: Centralized, typed environment settings loaded from `.env`.
- `github/`: GitHub integration supporting OAuth Apps, GitHub Apps (RS256 JWT installation tokens), and in-memory mock client for tests.
- `lib/`: Core utilities (Prisma ORM database connection, AES-256-GCM token encryption, sliding-window rate limiting, structured logging, transactional notifications, HMAC session auth).
- `projects/`: Share link generation for LinkedIn, X (Twitter), and WhatsApp.
- `posting/`: Drafting, checks, the credential vault and app secrets, platform connections, creator-owned and workspace adapters (Bluesky, Mastodon, X, Reddit, LinkedIn, Slack), bot clients (Discord, Telegram), WhatsApp manual sharing helpers, and the shared publish engine.
- `ai/`: Owner-only AI studio: provider-independent LLM layer, orchestrator, research (via documented search APIs), strategy, generation, brand profiles, quality review, scheduling heuristics and analytics. It only creates ordinary drafts and never sees credentials, approves, or publishes.
- `analytics/`: M9 measurement layer: platform support registry, metric normalization, engagement formulas, read-only official-API clients, owner-triggered sync engine, dashboard queries, grounded AI performance analyst and CSV/PDF reports. It never publishes or approves.
- `platforms/`: The posting destination registry (draft limits and authorisation model); no credentials or network calls.
- `types/`: Strongly-typed TypeScript interfaces for Users, Projects, Applicants, Sessions, and API responses.
