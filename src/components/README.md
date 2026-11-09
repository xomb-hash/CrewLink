# UI Components (React + Tailwind + Lucide)

Reusable UI components built with React 19, TypeScript, Tailwind CSS (v4), and Lucide Icons. The app chrome follows the black/Archivo Crewlink design language defined in `src/app/globals.css`.

- `AppShell.tsx`: Client shell that renders the fixed topbar, desktop sidebar, and mobile bottom nav.
- `Topbar.tsx`: Fixed header with brand, project search (submits `/?q=`), the single Create link to `/projects/new`, notification bell popover, and GitHub avatar or sign-in.
- `Sidebar.tsx`: Desktop icon navigation (Home, Discover, Dashboard, Sign in/out) with active indicators.
- `MobileNav.tsx`: Bottom icon navigation (Home, Discover, Dashboard, Sign in/out) shown below the `md` breakpoint.
- `NotificationBell.tsx`: Popover listing pending join requests on owned projects and status updates on the user's applications, with a pending-count badge.
- `CreateProjectForm.tsx`: Shared admin-repo selection, optional project logo upload (PNG/JPEG/WebP, 2 MB), join mode, screening form, optional creator note, and required-credential toggles (resume, GitHub link, LinkedIn link). Referral projects get an invite code embedded in the join link.
- `ProjectLogo.tsx`: Displays an uploaded project logo or deterministic gradient/initials art generated from the project name.
- `VisibilityBadge.tsx`: Lock icon for private repositories and globe icon for public repositories.
- `ProjectCard.tsx`: Owner project card with join-link copy, invite-code generation/regeneration, share triggers (LinkedIn, X, WhatsApp), applicant review rows (GitHub/LinkedIn links and resume download when provided), confirmation dialogs for Approve/Reject, and an owner-only Delete with confirmation.
- `AdvisoryBanners.tsx`: GitHub personal-repository write-access and honour-system screening notices.
- `ui/`: shadcn/ui primitives (`badge.tsx`, `button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx`).
