# Crewlink

Connects people who share an idea. First add-on: a GitHub project owner shares a join link
and approves or screens applicants. A posting agent helps the owner announce the project.

## Layout
- src/: backend. app.js is the router; config, lib, github, auth, projects, applicants.
- public/: the page. styles, shared, components, features. No build step.
- tests/: node:test checks that use fake servers, never real accounts.
Each folder has a README.md. Keep them updated when you change a folder.

## Rules
- No new dependencies. Node 18+ built-ins only (fetch, node:crypto, node:test).
- Follow the existing folder pattern. Small files, one job each.
- Never put secrets in code, tests, logs or git. They come from .env. Keep .env.example current.
- Validate input on the server. Escape user text before putting it in HTML.
- Only the project owner may act on a project's drafts or posts.
- NEVER post anything without the owner's explicit approval of the exact text, per platform.
- Show me a plan before writing code. After each milestone: run node --test, list every file
  changed, then stop and wait for me.
- Ask before deleting files or running commands outside this folder.

## Design
Match the existing look: black and off-white, 1px borders, no shadows or gradients,
one blue accent, pill buttons. Reuse components/ before creating new ones.
