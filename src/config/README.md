# Config Module

Loads environment settings from `.env` and exports normalized configuration values.

- Uses standard Node.js without third-party dependencies (`dotenv` is not used).
- Exposes `config` with `port`, `appUrl`, `sessionSecret`, `githubClientId`, `githubClientSecret`, and `dataFile`.
- Does not expose secret values to client-side code.
