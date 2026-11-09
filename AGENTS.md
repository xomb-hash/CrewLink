# AGENTS.md

Instructions for AI coding agents working on **Crewlink**. Read this first. Before changing a folder, read the short README inside it.

## What Crewlink is

Crewlink is a place where people who share an idea or goal find each other and start building together.

- First part being built: **Crewlink for GitHub**. An owner connects a GitHub repo, shares one join link, and decides who comes aboard.
- Later, the same core will support other groups: college clubs, city communities, event teams.
- Crewlink **only connects people**. It does not manage how a team performs afterwards, and it is **not a chat app**. After approval, people continue in GitHub, WhatsApp or Discord.

## Core flow (must keep working)

1. The **owner** signs in with GitHub and creates a project from a repo they administer (admin access is checked).
2. The owner chooses how people join:
   - **Referral link**: people sign in, the owner approves.
   - **Screening first**: people complete the owner's own test or interview link before approval.
3. The owner gets one **join link** and shares it.
4. An **applicant** opens the link, signs in with GitHub and requests to join. The owner sees their account age and public repo count.
5. The owner approves or rejects. Approving sends a **real GitHub collaborator invitation**. The person must accept it on GitHub.

UI rules: lock icon = private repo, globe icon = public repo. Clicking a public project opens its code on GitHub.

## Tech Stack & Commands

Built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, and **Lucide Icons**.

```bash
npm test        # run all automated tests, all must pass
npm run dev     # start development server at http://localhost:3000
npm run build   # build production application
```

Settings come from `.env` (copy `.env.example`). GitHub App / OAuth setup steps are in the root README.

## Project layout

```text
src/app/          Next.js App Router (pages and API route handlers)
src/components/   reusable React UI components (AppShell, Topbar, Sidebar, MobileNav, CreateProjectForm, ProjectCard, VisibilityBadge, AdvisoryBanners)
src/config/       typed settings from .env
src/lib/          storage, validation, session auth helpers
src/github/       everything that talks to GitHub, including the invitation and test mock
src/projects/     project share link helpers
src/types/        TypeScript interfaces for projects, applicants, users, sessions
tests/            automated tests using node:test and tsx (fake GitHub)
```

## How to work

- Rule of thumb: **change one small piece, run `npm test`, test by hand with two GitHub accounts, then commit.**
- Tests use a **fake GitHub**. Add or update a test for any behaviour you change.
- Follow the style of the code around you. If you change what a folder does, keep its README accurate.
- Commands you write into READMEs or instructions must work in both PowerShell and bash (no bash-only syntax such as `export` or `&&` chains).
- If something is not covered here or in a README, say so and ask. Do not invent requirements.
- Keep reports short: what changed, what you ran, what is still untested.

## Boundaries

**Always**
- Run `npm test` before saying a task is done.
- Keep GitHub calls inside `src/github/`.
- Enforce owner-only approve and reject on the server, not only in the UI.

**Ask first**
- Changing the core flow or the two join modes.
- Showing owners more applicant data than account age and public repo count.
- Changing the GitHub App's permissions.
- Anything about payments, premium tiers or featured listings (the business model is not validated).
- Deciding any of the open decisions below.

**Never**
- Commit, print or share `.env` or the GitHub App private key file.
- Call real GitHub from automated tests.
- Post anything for an owner without their approval.
- Add chat features or team-performance tracking.
- Say a GitHub change "works" before the two-account test passes.
- Touch making of agent (will be done by friend).

## Status

**Built:** Next.js App Router + TypeScript + Tailwind CSS migration complete. PostgreSQL (Supabase) integration with Prisma ORM, AES-256-GCM token encryption at rest, sliding-window rate limiting, GitHub webhook listener with HMAC-SHA256 signature verification, `/api/health` monitoring, structured JSON logging, GitHub Actions CI/CD workflow, create project from repo (with admin-access check) with optional logo upload or generated art, sign in with GitHub, join link and join page with project overview and creator card, request to join with optional GitHub/LinkedIn links and PDF resume (owner can mark each as required), referral invite codes embedded in join links with owner-only regeneration, owner dashboard with Approve and Reject plus the GitHub invitation call, "Projects you joined" section, Discover page for public projects, notification bell popover, lock and globe icons, share links for LinkedIn, X and WhatsApp, 90 automatic tests (fake GitHub).

**Not built (do not touch making of agent):** testing against real GitHub, the posting agent (done by friend), Google AI drafting, platform connections, college spaces and verified clubs, the events list, people-to-people matching.

Real GitHub is **untested**. It needs the GitHub App / OAuth App to be created and a two-account test (second GitHub account in a private browser window). When you change GitHub-facing code, say in your report that this manual test is still needed.

## Known traps

- **GitHub access levels:** read-only invitations only apply on organisation repos. On personal repos every collaborator gets write access. The dashboard warns about this. Keep that warning.
- **Screening is on the honour system.** Crewlink cannot check that someone finished a test. Never word the UI as if completion is verified.

## Current priorities

1. Run the real two-account GitHub test and fix what breaks.
2. Friend works on posting agent.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
