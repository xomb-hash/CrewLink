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

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Icons**: [Lucide Icons](https://lucide.dev/)
- **Testing**: Built-in Node test runner (`node:test`) with `tsx` and mock GitHub

---

## Quick Start

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
   *(On Windows PowerShell: `Copy-Item .env.example .env`)*

2. Configure GitHub OAuth App credentials in `.env`:
   - Visit [GitHub Developer Settings](https://github.com/settings/developers) -> **OAuth Apps** -> **New OAuth App**.
   - Application name: `Crewlink`
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:3000/auth/github/callback`
   - Copy the Client ID and create a Client Secret, then paste them into `.env`.

3. Install dependencies:
   ```bash
   npm install
   ```

4. Run automated tests:
   ```bash
   npm test
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Commands

```bash
npm test        # run automated test suites (uses mock GitHub)
npm run dev     # start local development server at http://localhost:3000
npm run build   # compile Next.js production build
npm start       # start Next.js production server
```

---

## Testing Policy

Automated tests in `tests/` use an isolated **fake GitHub** client (`src/github/fake.ts`). They will never make outbound requests to real GitHub.
Real GitHub testing requires setting up a GitHub OAuth App and completing a two-account manual test (owner and applicant).
