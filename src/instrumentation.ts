// Runs once when a Next.js server instance starts. Production configuration is
// validated before the server is ready to handle requests; a missing or unsafe
// required value fails closed instead of silently using a development default.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { validateProductionConfig } = await import('./config/production');
  const { logger } = await import('./lib/logger');
  const result = validateProductionConfig();
  for (const warning of result.warnings) {
    logger.warn(`Production configuration warning: ${warning}`);
  }
}
