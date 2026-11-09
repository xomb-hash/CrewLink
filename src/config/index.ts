import path from 'node:path';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'crewlink-dev-secret-key-change-in-production-32chars',
  githubClientId: process.env.GITHUB_CLIENT_ID || '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',
  githubAppId: process.env.GITHUB_APP_ID || '',
  githubPrivateKeyPath: process.env.GITHUB_PRIVATE_KEY_PATH || '',
  dataFile: process.env.DATA_FILE || path.resolve(process.cwd(), 'data', 'crewlink.json'),
};

export default config;
