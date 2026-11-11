/**
 * One-off dev helper: create a session for an existing user in the file-backed
 * store and print the signed crewlink_session cookie value.
 *
 * Run with: DATABASE_URL= NODE_ENV=test npx tsx scripts-dev/create-dev-session.ts <userId>
 * Never use against a real database. The file store is dev/test only.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { storage } from '../src/lib/storage';

const userId = process.argv[2] || '1001';

function sessionSecret(): string {
  const env = fs.readFileSync('.env', 'utf8');
  const local = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '';
  for (const text of [local, env]) {
    const match = text.match(/^SESSION_SECRET=(.*)$/m);
    if (match && match[1].trim()) return match[1].trim();
  }
  throw new Error('SESSION_SECRET not found');
}

async function main(): Promise<void> {
  const user = await storage.getUser(userId);
  if (!user) throw new Error(`user ${userId} not found`);
  const sessionId = await storage.createSession(user.id);
  const secret = sessionSecret();
  const signature = crypto.createHmac('sha256', secret).update(sessionId).digest('hex');
  process.stdout.write(`${sessionId}.${signature}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
