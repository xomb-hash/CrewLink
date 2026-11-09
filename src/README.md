# Source Architecture (`src/`)

Modern Next.js App Router and TypeScript application structure:

- `app/`: Next.js App Router pages (landing, dashboard, new project, join) and API route handlers.
- `components/`: Modular React components styled with Tailwind CSS and Lucide icons.
- `config/`: Centralized, typed environment settings loaded from `.env`.
- `github/`: GitHub integration supporting OAuth Apps, GitHub Apps (RS256 JWT installation tokens), and in-memory mock client for tests.
- `lib/`: Core utilities (Prisma ORM database connection, AES-256-GCM token encryption, sliding-window rate limiting, structured logging, transactional notifications, HMAC session auth).
- `projects/`: Share link generation for LinkedIn, X (Twitter), and WhatsApp.
- `types/`: Strongly-typed TypeScript interfaces for Users, Projects, Applicants, Sessions, and API responses.
