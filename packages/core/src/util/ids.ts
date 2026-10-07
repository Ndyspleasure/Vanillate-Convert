/**
 * Random identifiers and capability tokens (isomorphic: Web Crypto only).
 *
 * Job ids are not secrets; access to a job requires its token, which is returned once at
 * creation and stored only as a SHA-256 hash.
 */
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Lowercase base32 id with `bits` of entropy, e.g. `newId('job')` → `job_k3…`. */
export function newId(prefix: string, bits = 130): string {
  const length = Math.ceil(bits / 5);
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += BASE32[byte & 31];
  return `${prefix}_${out}`;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** 256-bit random capability token (base64url). */
export function newToken(): string {
  return toBase64Url(randomBytes(32));
}

/** Web Crypto requires views over a plain ArrayBuffer (not a SharedArrayBuffer). */
function plainBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? (bytes as Uint8Array<ArrayBuffer>)
    : new Uint8Array(bytes);
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : plainBytes(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  let out = '';
  for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Constant-time comparison for equal-length strings such as hashes or signatures. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
