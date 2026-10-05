/**
 * HMAC-signed URLs for the local storage driver (the Next.js API serves the bytes).
 */
import { fromBase64Url, timingSafeEqual, toBase64Url } from '@vanillate/core';

export interface SignedParams {
  key: string;
  method: 'PUT' | 'GET';
  /** Unix seconds. */
  expires: number;
  contentType: string;
  size?: number;
  filename?: string;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(signature));
}

function canonical(params: SignedParams): string {
  return JSON.stringify([
    params.method,
    params.key,
    params.expires,
    params.contentType,
    params.size ?? null,
    params.filename ?? null,
  ]);
}

/** Encodes the parameters and their signature into a single opaque token. */
export async function signToken(secret: string, params: SignedParams): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(params)));
  return `${payload}.${await hmac(secret, canonical(params))}`;
}

export type TokenCheck =
  { ok: true; params: SignedParams } | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

export async function verifyToken(
  secret: string,
  token: string,
  now = Date.now(),
): Promise<TokenCheck> {
  const [payload, signature] = token.split('.');
  if (!payload || !signature || token.split('.').length !== 2)
    return { ok: false, reason: 'malformed' };
  let params: SignedParams;
  try {
    params = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as SignedParams;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    typeof params !== 'object' ||
    typeof params.key !== 'string' ||
    typeof params.expires !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (!timingSafeEqual(signature, await hmac(secret, canonical(params))))
    return { ok: false, reason: 'signature' };
  if (params.expires * 1000 < now) return { ok: false, reason: 'expired' };
  return { ok: true, params };
}
