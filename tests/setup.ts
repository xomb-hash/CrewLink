// Ensure tests run in isolated test environment and do not pollute live database
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';
delete process.env.GITHUB_WEBHOOK_SECRET;
