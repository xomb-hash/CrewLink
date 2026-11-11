import crypto from 'node:crypto';

export interface PkcePair {
  verifier: string;
  challenge: string;
}

// RFC 7636 S256. The verifier is 32 random bytes (43 base64url characters) and
// never leaves the server; only the challenge travels to X.
export function createPkcePair(): PkcePair {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export default { createPkcePair };
