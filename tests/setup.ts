// Ensure tests run in isolated test environment and do not pollute live database
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';
delete process.env.GITHUB_WEBHOOK_SECRET;
// Tests must never call GCP: force the local credential vault and env secret store.
process.env.CREDENTIAL_PROVIDER = 'local';
process.env.SECRETS_PROVIDER = 'env';
// The encryption helpers refuse to run without a secret, and tests do not load .env.
process.env.ENCRYPTION_SECRET = 'crewlink-test-encryption-secret-32-chars';
// Tests never reach Discord or Telegram; the mock transport is the default anyway.
// These are fake tokens that only satisfy the "configured" check.
process.env.PUBLISHING_TRANSPORT = 'mock';
process.env.DISCORD_BOT_TOKEN = 'test-discord-bot-token';
process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-bot-token';
// X OAuth tests use the mock client; these values only satisfy configuration
// checks and never reach a real host.
process.env.X_CLIENT_ID = 'test-x-client-id';
process.env.X_CLIENT_SECRET = 'test-x-client-secret';
process.env.X_API_BASE_URL = 'https://api.x.test';
process.env.X_AUTHORIZE_URL = 'https://x.test/i/oauth2/authorize';
process.env.X_MONTHLY_BUDGET_USD = '10';
// Reddit OAuth and publishing use the mock client; no live Reddit host is used.
process.env.REDDIT_CLIENT_ID = 'test-reddit-client-id';
process.env.REDDIT_CLIENT_SECRET = 'test-reddit-client-secret';
process.env.REDDIT_API_BASE_URL = 'https://oauth.reddit.test';
process.env.REDDIT_AUTHORIZE_URL = 'https://www.reddit.test/api/v1/authorize';
process.env.REDDIT_TOKEN_URL = 'https://www.reddit.test/api/v1/access_token';
process.env.REDDIT_REVOKE_URL = 'https://www.reddit.test/api/v1/revoke_token';
// LinkedIn OAuth and publishing use the mock client; no live LinkedIn host is
// used. The version is pinned so the version-module tests are deterministic.
process.env.LINKEDIN_CLIENT_ID = 'test-linkedin-client-id';
process.env.LINKEDIN_CLIENT_SECRET = 'test-linkedin-client-secret';
process.env.LINKEDIN_API_VERSION = '202610';
process.env.LINKEDIN_API_BASE_URL = 'https://api.linkedin.test';
process.env.LINKEDIN_AUTHORIZE_URL = 'https://www.linkedin.test/oauth/v2/authorization';
process.env.LINKEDIN_TOKEN_URL = 'https://www.linkedin.test/oauth/v2/accessToken';
// Slack OAuth and publishing use the mock client; no live Slack host is used.
process.env.SLACK_CLIENT_ID = 'test-slack-client-id';
process.env.SLACK_CLIENT_SECRET = 'test-slack-client-secret';
process.env.SLACK_AUTHORIZE_URL = 'https://slack.test/oauth/v2/authorize';
process.env.SLACK_TOKEN_URL = 'https://slack.test/api/oauth.v2.access';
process.env.SLACK_API_BASE_URL = 'https://slack.test/api';
