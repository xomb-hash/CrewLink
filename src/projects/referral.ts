import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateReferralCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return code;
}

export function normalizeReferralCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

export function referralCodeMatches(expected: unknown, provided: unknown): boolean {
  const expectedCode = normalizeReferralCode(expected);
  return Boolean(expectedCode) && expectedCode === normalizeReferralCode(provided);
}
