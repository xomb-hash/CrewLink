# App Router (Next.js)

Next.js App Router providing server-rendered pages and API Route Handlers.

## Pages
- `page.tsx` + `HomeClient.tsx`: Landing page for signed-out visitors. Signed-in owners see their connected projects as a card grid with `All / Public / Private / Referral / Screening` filters and topbar search (`/?q=`), plus a "Projects looking for collaborators" preview. Public cards open the repository on GitHub; private cards open the join page.
- `discover/page.tsx` & `DiscoverClient.tsx`: Browse public projects from other creators with search and All/Referral/Screening filters; cards show invite-code and application-status badges and link to the join page.
- `dashboard/page.tsx` & `DashboardClient.tsx`: Owner dashboard with a GitHub profile block, project cards (join-link copy, share options, invite-code generation), applicant review (Approve/Reject), a "Projects you joined" section, and advisory banners.
- `projects/new/page.tsx` & `NewProjectClient.tsx`: Centered create card reusing `CreateProjectForm`. The topbar Create action opens the same form in a centered modal dialog; it is the only Create entry point.
- `join/[slug]/page.tsx` & `JoinClient.tsx`: Public join page presenting the project overview, an "About the creator" card (avatar, GitHub link, account age, public repos, optional note), the screening task (if configured), and request submission. Referral projects require the invite code from the link (`?ref=`); applicants can add GitHub/LinkedIn profile links and attach a PDF resume (max 5 MB), with owner-marked fields enforced as required.

## API Routes
- `auth/github/route.ts`: Initiates GitHub OAuth flow (with rate limiting).
- `auth/github/callback/route.ts`: Exchanges code, sets secure signed session cookie.
- `auth/logout/route.ts`: Clears session cookie and logs out.
- `api/auth/me/route.ts`: Current authenticated user profile.
- `api/repos/route.ts`: Repositories where user has admin access.
- `api/projects/route.ts`: GET owner projects; POST create new project (JSON or multipart with optional logo, rate limited).
- `api/projects/[id]/route.ts`: GET project details (owner-enforced).
- `api/projects/[id]/logo/route.ts`: Public project logo image (404 when the project uses generated art).
- `api/projects/[id]/referral-code/route.ts`: POST regenerate the active referral invite code (owner-only, referral projects only).
- `api/projects/[id]/applicants/[applicantId]/approve/route.ts`: POST approve applicant (dispatches GitHub invitation and notification).
- `api/projects/[id]/applicants/[applicantId]/reject/route.ts`: POST reject applicant (with notification).
- `api/join/[slug]/route.ts`: Public project join page data (never exposes the invite code).
- `api/join/[slug]/apply/route.ts`: Applicant join request accepting JSON or multipart (invite code, message, GitHub/LinkedIn links, optional PDF resume), enforcing the project's referral code and required credentials, with rate limiting and notification.
- `api/notifications/route.ts`: Signed-in activity feed (pending join requests on owned projects and decisions on the user's applications).
- `api/resume/[applicantId]/route.ts`: Authenticated PDF download for the applicant or the project owner only.
- `api/health/route.ts`: Enterprise health check reporting service uptime, version, and database connectivity.
- `api/webhooks/github/route.ts`: GitHub webhook handler verifying HMAC-SHA256 signatures to track collaborator acceptance in real time.
