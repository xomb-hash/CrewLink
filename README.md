# Crewlink

Crewlink is a place where people who share an idea or goal find each other and start building together.

The first version connects collaborators around GitHub repositories:
1. An **owner** signs in with GitHub and creates a project from a repository they administer.
2. The owner selects a join mode:
   - **Referral link**: people sign in, owner approves.
   - **Screening first**: applicants take the owner's test or interview link before approval.
3. The owner gets a **join link** and shares it (with built-in LinkedIn, X, and WhatsApp share buttons).
4. An **applicant** opens the link, signs in with GitHub, and requests to join. The owner reviews their account age and public repo count.
5. The owner approves or rejects. Approving triggers a real **GitHub collaborator invitation**.

Crewlink **only connects people**. It is not a chat application and does not track post-approval team performance.

---

## Requirements

- Node.js 18 or newer
- Zero npm packages to install (pure standard library: `node:http`, `node:crypto`, `node:fs`, `node:test`)

---

## Quick Start

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
   *(On Windows PowerShell, you can run: `Copy-Item .env.example .env`)*

2. Add your GitHub OAuth App credentials in `.env`:
   - Visit [GitHub Developer Settings](https://github.com/settings/developers) -> **OAuth Apps** -> **New OAuth App**.
   - Application name: `Crewlink`
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:3000/auth/github/callback`
   - Copy the Client ID and create a Client Secret, then paste them into `.env`.

3. Run automatic tests:
   ```bash
   node --test
   ```

4. Start the server:
   ```bash
   node server.js
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Commands

```bash
node --test        # run all automated tests (uses mock GitHub)
node server.js     # start the HTTP server
```

---

## Project Structure

```text
server.js                 starts the server
src/
  app.js                  main router: routes URLs to features
  config/                 reads configuration from .env
  lib/                    storage, validation, request helpers
  github/                 GitHub API integration & invitations (plus test mock)
  auth/                   GitHub OAuth sign-in and session handling
  projects/               create, list projects, share links
  applicants/             join page, requests, approve, reject
public/                   web interface
  components/             button, form, dialog, tag, toast, project card, visibility icon
  features/               dashboard, join page, project creation
  shared/                 header, footer, API client
  styles/                 main stylesheet
tests/                    automated tests using node:test
```

---

## Testing Policy

Automated tests in `tests/` use an isolated **fake GitHub** client (`src/github/fake.js`). They will never make outbound requests to real GitHub.
Real GitHub testing requires setting up a GitHub OAuth App and completing a two-account manual test (owner and applicant).
