/**
 * Byte transfer for the local storage driver (development and self-hosting). Production on
 * S3-compatible storage never reaches this route: clients use presigned URLs directly.
 *
 *   PUT /api/v1/storage/{token}  upload exactly the signed size and content type
 *   GET /api/v1/storage/{token}  download as an attachment
 *
 * Tokens are HMAC-signed, scoped to one key and method, and expire.
 */
import { contentDisposition, VanillateError } from '@vanillate/core';
import {
  isLocalStorage,
  verifyToken,
  type LocalStorage,
  type SignedParams,
} from '@vanillate/storage';

import { handle, requireServices } from '@/server/api.ts';

async function authorize(
  token: string,
  method: 'PUT' | 'GET',
): Promise<{
  storage: LocalStorage;
  params: SignedParams;
}> {
  const { storage } = requireServices();
  if (!isLocalStorage(storage)) throw new VanillateError('not-found');
  if (token.length > 4096) throw new VanillateError('unauthorized');
  const check = await verifyToken(storage.signingSecret, token);
  if (!check.ok)
    throw new VanillateError(check.reason === 'expired' ? 'job-expired' : 'unauthorized');
  if (check.params.method !== method) throw new VanillateError('method-not-allowed');
  return { storage, params: check.params };
}

export async function PUT(
  request: Request,
  ctx: RouteContext<'/api/v1/storage/[token]'>,
): Promise<Response> {
  return handle(request, async () => {
    const { storage, params } = await authorize((await ctx.params).token, 'PUT');
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType !== params.contentType) {
      throw new VanillateError('bad-request', {
        detail: 'content type does not match the signature',
      });
    }
    const size = params.size ?? -1;
    const declared = request.headers.get('content-length');
    if (declared !== null && Number(declared) !== size) {
      throw new VanillateError('bad-request', {
        detail: 'content length does not match the signature',
      });
    }
    if (!request.body) throw new VanillateError('bad-request', { detail: 'empty body' });
    try {
      // Streams to disk and enforces the exact signed size.
      await storage.write(params.key, request.body, { contentType, size });
    } catch (error) {
      if (error instanceof VanillateError) throw error;
      throw new VanillateError('upload-incomplete', { detail: String(error), cause: error });
    }
    return new Response(null, { status: 204 });
  });
}

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/v1/storage/[token]'>,
): Promise<Response> {
  return handle(request, async () => {
    const { storage, params } = await authorize((await ctx.params).token, 'GET');
    const object = await storage.head(params.key);
    if (!object) throw new VanillateError('job-expired');
    return new Response(await storage.read(params.key), {
      headers: {
        'Content-Type': params.contentType,
        'Content-Length': String(object.size),
        'Content-Disposition': contentDisposition(params.filename ?? 'download'),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        // Downloads are never rendered as pages of this site (e.g. converted HTML).
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  });
}
