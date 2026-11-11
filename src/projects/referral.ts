import crypto from 'node:crypto';

// --- Code format: short and readable, without look-alike characters (0/O, 1/I) ---
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const CODE_PREFIX = 'CREW-';

// --- Generate one random code; uniqueness is checked by storage ---
export function generateReferralCode(): string {
  let code = CODE_PREFIX;
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return code;
}

// --- Normalize input so every comparison is case-insensitive ---
export function normalizeReferralCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

// --- Compare a stored code with one supplied in a URL or request body ---
export function referralCodeMatches(expected: unknown, provided: unknown): boolean {
  const expectedCode = normalizeReferralCode(expected);
  return Boolean(expectedCode) && expectedCode === normalizeReferralCode(provided);
}
