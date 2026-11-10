# App Router (Next.js)

Next.js App Router providing server-rendered pages and API Route Handlers.

## Pages
- `page.tsx` + `HomeClient.tsx`: Landing page for signed-out visitors. Signed-in owners see their connected projects as a card grid with `All / Public / Private / Referral / Screening` filters and topbar search (`/?q=`), plus a "Projects looking for collaborators" preview. Every card opens the project details modal over the current page.
- `discover/page.tsx` & `DiscoverClient.tsx`: Browse public projects from other creators with search and All/Referral/Screening filter pills; cards show invite-code and application-status badges and open the project details modal over the page.
- `explore/page.tsx` & `ExploreClient.tsx`: Explore public projects with search and role filter pills, using the same project card design as Discover; cards open the project details modal over the page.
- `applications/page.tsx` & `ApplicationsClient.tsx`: Tracker for the signed-in user's join requests, grouped by status with a link back to Explore.
- `@modal/(.)join/[slug]/page.tsx` + `ModalClient.tsx`: Intercepting parallel route that renders `ProjectDetailsModal` over Home/Discover on client navigation. `@modal/default.tsx` renders nothing elsewhere. Closing calls `router.back()`; a refresh or shared `/join/[slug]` link renders the full join page instead.
- `dashboard/page.tsx` & `DashboardClient.tsx`: Owner dashboard with a GitHub profile block, project cards (join-link copy, share options, invite-code status and regeneration), applicant review (Approve/Reject), a "Projects you joined" section, and advisory banners.
- `projects/new/page.tsx` & `NewProjectClient.tsx`: Centered create card reusing `CreateProjectForm`. The single Create link in the top right opens this page.
- `join/[slug]/page.tsx` & `JoinClient.tsx`: Direct-visit join page (refresh or shared link) presenting the project overview, an "About the creator" card (avatar, GitHub link, account age, public repos, optional note), the screening task (if configured), and request submission. Referral projects require the invite code from the link (`?ref=`); a used, expired, or unknown code shows the matching server message instead of pre-filling it. Applicants can add GitHub/LinkedIn profile links and attach a PDF resume (max 5 MB), with owner-marked fields enforced as required.

## API Routes
- `auth/github/route.ts`: Initiates GitHub OAuth flow (with rate limiting).
- `auth/github/callback/route.ts`: Exchanges code, sets secure signed session cookie.
- `auth/logout/route.ts`: Clears session cookie and logs out.
- `api/auth/me/route.ts`: Current authenticated user profile.
- `api/repos/route.ts`: Repositories where user has admin access.
- `api/projects/route.ts`: GET owner projects; POST create new project (JSON or multipart with optional logo, rate limited).
- `api/projects/[id]/route.ts`: GET project details (owner-enforced); DELETE project (owner-only, removes applicants, drafts, logo, and resume files; the GitHub repository is untouched).
- `api/projects/[id]/logo/route.ts`: Public project logo image (404 when the project uses generated art).
- `api/projects/[id]/referral-code/route.ts`: POST regenerate the active referral invite code (owner-only, referral projects only); returns the new code, its issue time, and 7-day expiry.
- `api/projects/[id]/applicants/[applicantId]/approve/route.ts`: POST approve applicant (dispatches GitHub invitation and notification).
- `api/projects/[id]/applicants/[applicantId]/reject/route.ts`: POST reject applicant (with notification).
- `api/join/[slug]/route.ts`: Public project join page data (never exposes the invite code).
- `api/join/[slug]/apply/route.ts`: Applicant join request accepting JSON or multipart (invite code, message, GitHub/LinkedIn links, optional PDF resume). Referral codes are claimed atomically on submission, so only the first successful request uses one; expired, used, and mismatched codes return 400 with an explanation. Enforces required credentials, rate limiting, and notification.
- `api/notifications/route.ts`: Signed-in activity feed (pending join requests on owned projects and decisions on the user's applications).
- `api/resume/[applicantId]/route.ts`: Authenticated PDF download for the applicant or the project owner only.
- `api/health/route.ts`: Enterprise health check reporting service uptime, version, and database connectivity.
- `api/webhooks/github/route.ts`: GitHub webhook handler verifying HMAC-SHA256 signatures to track collaborator acceptance in real time.
