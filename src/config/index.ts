export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || 'crewlink-dev-secret-key-change-in-production-32chars',
  githubClientId: process.env.GITHUB_CLIENT_ID || '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',
  githubAppId: process.env.GITHUB_APP_ID || '',
  githubPrivateKeyPath: process.env.GITHUB_PRIVATE_KEY_PATH || '',
  gcsBucketName: process.env.GCS_BUCKET_NAME || '',
  gcpProjectId: process.env.GCP_PROJECT_ID || '',
  gcsCredentialsJson: process.env.GCS_CREDENTIALS_JSON || '',
};

export default config;
