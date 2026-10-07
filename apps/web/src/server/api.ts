/**
 * Helpers for API route handlers: JSON responses, error mapping, request parsing, access
 * tokens and the anonymous client key used for rate limiting.
 */
import 'server-only';

import { sha256Hex, toVanillateError, VanillateError } from '@vanillate/core';

import { negotiateLocale, type Locale } from '@/i18n/config.ts';

import { getServices, logger, type Services } from './services.ts';

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

/** The caller's language for error messages: `?locale=`, then `Accept-Language`. */
export function requestLocale(request: Request): Locale {
  const query = new URL(request.url).searchParams.get('locale');
  return negotiateLocale(request.headers.get('accept-language'), query);
}

/**
 * Converts any error into a safe JSON response. Internal details are logged, never returned;
 * unexpected errors become `internal-error`.
 */
export function errorResponse(error: unknown, request: Request): Response {
  const failure = toVanillateError(error);
  if (failure.kind === 'system' || failure.kind === 'infrastructure') {
    logger().error('api.error', {
      code: failure.code,
      detail: failure.detail,
      path: new URL(request.url).pathname,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
  const headers: Record<string, string> =
    failure.code === 'rate-limited' ? { 'Retry-After': '60' } : {};
  return json({ error: failure.toPublic(requestLocale(request)) }, failure.status, headers);
}

/** Runs a handler with error mapping. */
export async function handle(request: Request, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    return errorResponse(error, request);
  }
}

export function requireServices(): Services {
  const services = getServices();
  if (!services) throw new VanillateError('server-processing-disabled');
  return services;
}

/** Reads a JSON body of at most `maxBytes` (rejects other content types). */
export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new VanillateError('bad-request', { detail: 'expected application/json' });
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new VanillateError('bad-request', { detail: 'body too large' });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new VanillateError('bad-request', { detail: 'body too large' });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new VanillateError('bad-request', { detail: 'invalid JSON' });
  }
}

/** The job access token from `Authorization: Bearer <token>`. */
export function bearerToken(request: Request): string {
  const match = /^Bearer\s+([A-Za-z0-9_-]{16,256})$/.exec(
    request.headers.get('authorization') ?? '',
  );
  if (!match?.[1]) throw new VanillateError('unauthorized');
  return match[1];
}

/**
 * An anonymous, non-reversible key per client for rate limiting. The IP comes from the
 * platform's proxy header (Vercel sets `x-forwarded-for`; self-hosted deployments must run
 * behind a proxy that sets it).
 */
export async function clientKey(request: Request): Promise<string> {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip') || 'unknown';
  const salt = process.env.RATE_LIMIT_SALT ?? 'vanillate-convert';
  return (await sha256Hex(`${salt}|${ip}`)).slice(0, 32);
}
