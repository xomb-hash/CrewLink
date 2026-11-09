# App Router (Next.js)

Next.js App Router providing server-rendered pages and API Route Handlers.

## Pages
- `page.tsx`: Landing page explaining Crewlink's purpose, workflow, and entry points.
- `dashboard/page.tsx` & `DashboardClient.tsx`: Owner dashboard displaying project cards, applicant lists, share options, and advisory banners.
- `projects/new/page.tsx` & `NewProjectClient.tsx`: Form for admin repository selection, join mode configuration (referral or screening), and screening link inputs.
- `join/[slug]/page.tsx` & `JoinClient.tsx`: Public join page for applicants, presenting project overview, screening tasks (if configured), and request submission.

## API Routes
- `auth/github/route.ts`: Initiates GitHub OAuth flow (with rate limiting).
- `auth/github/callback/route.ts`: Exchanges code, sets secure signed session cookie.
- `auth/logout/route.ts`: Clears session cookie and logs out.
- `api/auth/me/route.ts`: Current authenticated user profile.
- `api/repos/route.ts`: Repositories where user has admin access.
- `api/projects/route.ts`: GET owner projects; POST create new project (with rate limiting).
- `api/projects/[id]/route.ts`: GET project details (owner-enforced).
- `api/projects/[id]/applicants/[applicantId]/approve/route.ts`: POST approve applicant (dispatches GitHub invitation and notification).
- `api/projects/[id]/applicants/[applicantId]/reject/route.ts`: POST reject applicant (with notification).
- `api/join/[slug]/route.ts`: Public project join page data.
- `api/join/[slug]/apply/route.ts`: Applicant join request (with rate limiting and notification).
- `api/health/route.ts`: Enterprise health check reporting service uptime, version, and database connectivity.
- `api/webhooks/github/route.ts`: GitHub webhook handler verifying HMAC-SHA256 signatures to track collaborator acceptance in real time.
