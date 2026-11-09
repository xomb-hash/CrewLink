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

## Commands

Needs only Node.js 18 or newer. There are no packages to install.

```bash
node --test        # run all automatic tests, all must pass
node server.js     # start the app, then open http://localhost:3000
```

Settings come from `.env` (copy `.env.example`). GitHub App setup steps are in the root README.

## Project layout

```text
server.js         starts the server
src/app.js        router: which URL goes to which feature
src/config/       settings from .env
src/lib/          storage, validation, request helpers
src/github/       everything that talks to GitHub, including the invitation
src/auth/         sign in with GitHub, sessions
src/projects/     create and list projects, share links
src/applicants/   join page, requests, approve, reject
public/           the web page: styles/, shared/, components/, features/
tests/            automatic tests
```

`public/components/` has button, form, dialog, tag, toast, project card and visibility icon. Reuse them before making new ones.

## How to work

- Rule of thumb: **change one small piece, run `node --test`, test by hand with two GitHub accounts, then commit.**
- Tests use a **fake GitHub**. Add or update a test for any behaviour you change.
- Follow the style of the code around you. If you change what a folder does, keep its README accurate.
- Commands you write into READMEs or instructions must work in both PowerShell and bash (no bash-only syntax such as `export` or `&&` chains).
- If something is not covered here or in a README, say so and ask. Do not invent requirements.
- Keep reports short: what changed, what you ran, what is still untested.

## Boundaries

**Always**
- Run `node --test` before saying a task is done.
- Keep GitHub calls inside `src/github/` and URL routing in `src/app.js`.
- Enforce owner-only approve and reject on the server, not only in the UI.

**Ask first**
- Adding an npm package (there are none today).
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

## Status

**Built:** create a project from a repo (with admin-access check), sign in with GitHub, join link and join page, request to join, owner dashboard with Approve and Reject plus the GitHub invitation call, lock and globe icons, share links for LinkedIn, X and WhatsApp, 10 automatic tests (fake GitHub).

**Not built (do not build unless the task asks):** testing against real GitHub, the posting agent, Google AI drafting, platform connections, college spaces and verified clubs, the events list, people-to-people matching.

Real GitHub is **untested**. It needs the GitHub App to be created and a two-account test (second GitHub account in a private browser window). When you change GitHub-facing code, say in your report that this manual test is still needed.

Separate design prototypes (landing page, app-style interface, wireframes) are static pages and are not connected to the backend. Do not treat them as the live app.

## Known traps

- **GitHub access levels:** read-only invitations only apply on organisation repos. On personal repos every collaborator gets write access. The dashboard warns about this. Keep that warning.
- **Screening is on the honour system.** Crewlink cannot check that someone finished a test. Never word the UI as if completion is verified.

## Posting agent (designed, not built)

Helps an owner announce a project on free platforms. Build it only when asked, and follow this design:

- Platforms in order: Discord, Telegram, Bluesky, Mastodon, then LinkedIn. Start with Discord.
- Draft one post per platform in that platform's style. Templates first, Google AI later (still an open decision).
- Run automatic checks on every draft: length limit, missing join link, private details, repeated posts.
- **The owner reviews and approves each post. Nothing is posted without that click.**
- Each owner connects their own accounts, so Crewlink needs no platform approvals.
- X is left out (posting costs money). WhatsApp stays a share link (no posting API for individuals). The existing LinkedIn, X and WhatsApp share links are separate and stay.

## Current priorities

1. Run the real two-account GitHub test and fix what breaks.
2. Add the drafting step for one platform (Discord first).

## Open decisions (ask, do not decide)

- First user group: one college, or one event such as a hackathon?
- First version of the agent: templates or Google AI?
- Are college spaces part of version 1, or do they come after the GitHub version?

---

Based on the project brief dated 7 November 2026. Update Status, priorities and open decisions as they change.
