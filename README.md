# Crewlink

Connects project owners with people who want to join, using GitHub. Plain Node.js, no packages to install.

## Run
1. Install Node.js 18 or newer.
2. `node --test` runs 7 checks (no GitHub account needed).
3. Copy `.env.example` to `.env` and fill it in (steps for the GitHub App are in docs below), then `node server.js`.
4. Open http://localhost:3000

## Where everything lives
| Folder | What it does | Read this when you want to... |
|---|---|---|
| `server.js` | Starts the server | change the start-up message |
| `src/app.js` | The router: which URL goes to which feature | add a new page or API route |
| `src/config/` | All settings and environment variables | add a new setting |
| `src/lib/` | Shared helpers: storage, validation, requests | change validation rules or move to a database |
| `src/github/` | Everything that talks to GitHub | change the invitation or permissions |
| `src/auth/` | Sign in with GitHub and sessions | change login behaviour |
| `src/projects/` | Create and list projects, roles, share links | add project fields or a new share platform |
| `src/platforms/` | Supported post destinations and limits | add or adjust a draft platform |
| `src/posting/` | Local post drafting, checks, and approval routes | change post templates or review rules |
| `src/applicants/` | Join page, requests, approve and reject | change the join flow |
| `public/styles/` | Colours and page layout | change the look of the whole app |
| `public/components/` | Buttons, forms, pop-up window, tags, messages, project card | change one piece everywhere (for example every button) |
| `public/features/` | Sign in, create project, project list, post review, personal post | change what a person can do on the page |
| `public/shared/` | Backend calls and small helpers | a backend route changed |
| `tests/` | Automatic checks | add a check for a new feature |

Each folder has a short README.md. Start with the one for the part you want to change.

## Adding a feature (the habit)
1. Pick the folder it belongs in. 2. Make one small change. 3. Run `node --test`.
4. Try it by hand with two GitHub accounts. 5. `git commit`.

## GitHub App setup
1. GitHub > Settings > Developer settings > GitHub Apps > New GitHub App.
2. Callback URL: `http://localhost:3000/auth/github/callback`. Turn Webhook off.
3. Repository permissions: Administration (Read and write) and Metadata (Read-only). Check names in GitHub's current docs.
4. Copy the App ID and Client ID. Generate a client secret and a private key (.pem).
5. Put the .pem in this folder, fill in `.env`, install the app on a test repo.
Never share or commit `.env` or the .pem file.

## Good to know
- GitHub only gives read-only access on organisation repos. On personal repos collaborators get write access.
- Sessions live in memory (sign in again after a restart). Data is in `data/projects.json`.
