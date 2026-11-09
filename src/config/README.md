# Config Module

Loads environment settings from `.env` and exports normalized configuration values.

- Exposes typed `config` with `port`, `appUrl`, `sessionSecret`, `githubClientId`, `githubClientSecret`, `githubAppId`, `databaseUrl`, and `dataFile`.
- Does not expose secret values to client-side code.
