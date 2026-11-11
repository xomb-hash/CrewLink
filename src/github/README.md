# GitHub Module

Handles all communication with GitHub's REST and OAuth APIs.

- `api.ts`: Real GitHub API client for OAuth authorization, fetching authenticated user info, listing repositories where user is admin, and a collaborator-invitation helper that approval does not call (contributors use forks and pull requests).
- `fake.ts`: Mock GitHub implementation used for automated tests. Tests never hit live GitHub servers.
- `index.ts`: Exports the active GitHub client, switching to the fake mock during test runs or via `setGitHubClient()`.

## Rules
- All GitHub API communication must reside within this folder.
- Automated tests must use `fakeGitHub`.
- Verification against real GitHub requires manual two-account testing with a registered GitHub OAuth App.
