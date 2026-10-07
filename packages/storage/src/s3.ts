/**
 * S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Supabase Storage S3, ...).
 *
 * Browsers upload and download directly with presigned URLs, so file bytes never pass
 * through serverless functions. Upload URLs sign `content-type` and `content-length`, which
 * makes storage reject uploads whose size differs from the declared one.
 */
import { AwsClient, AwsV4Signer } from 'aws4fetch';

import { contentDisposition } from '@vanillate/core';

import {
  assertValidKey,
  type DownloadUrlOptions,
  type SignedRequest,
  type Storage,
  type StoredObject,
  type UploadUrlOptions,
} from './types.ts';

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style URLs (`endpoint/bucket/key`), required by MinIO and most S3-compatible services. */
  forcePathStyle: boolean;
}

const MAX_EXPIRES = 7 * 24 * 3600;

export class S3Storage implements Storage {
  readonly driver = 's3' as const;
  private readonly client: AwsClient;
  private readonly options: S3StorageOptions;

  constructor(options: S3StorageOptions) {
    this.options = { ...options, endpoint: options.endpoint.replace(/\/+$/, '') };
    this.client = new AwsClient({
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      region: options.region,
      service: 's3',
    });
  }

  objectUrl(key: string): string {
    assertValidKey(key);
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    const endpoint = new URL(this.options.endpoint);
    if (this.options.forcePathStyle)
      return `${endpoint.origin}/${this.options.bucket}/${encodedKey}`;
    return `${endpoint.protocol}//${this.options.bucket}.${endpoint.host}/${encodedKey}`;
  }

  private async presign(
    url: string,
    method: 'PUT' | 'GET',
    headers: Record<string, string>,
    expiresIn: number,
  ): Promise<SignedRequest> {
    const target = new URL(url);
    target.searchParams.set('X-Amz-Expires', String(Math.min(expiresIn, MAX_EXPIRES)));
    const signer = new AwsV4Signer({
      url: target.toString(),
      method,
      headers,
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
      region: this.options.region,
      service: 's3',
      signQuery: true,
      allHeaders: true,
    });
    const signed = await signer.sign();
    return {
      method,
      url: signed.url.toString(),
      headers,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  createUploadUrl(key: string, options: UploadUrlOptions): Promise<SignedRequest> {
    return this.presign(
      this.objectUrl(key),
      'PUT',
      { 'content-type': options.contentType, 'content-length': String(options.size) },
      options.expiresIn,
    );
  }

  createDownloadUrl(key: string, options: DownloadUrlOptions): Promise<SignedRequest> {
    const url = new URL(this.objectUrl(key));
    url.searchParams.set('response-content-disposition', contentDisposition(options.filename));
    url.searchParams.set('response-content-type', options.contentType);
    return this.presign(url.toString(), 'GET', {}, options.expiresIn);
  }

  async head(key: string): Promise<StoredObject | null> {
    const response = await this.client.fetch(this.objectUrl(key), { method: 'HEAD' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`S3 HEAD failed with ${response.status}`);
    return {
      key,
      size: Number(response.headers.get('content-length') ?? '0'),
      contentType: response.headers.get('content-type'),
    };
  }

  async readRange(key: string, start: number, end: number): Promise<Uint8Array> {
    const response = await this.client.fetch(this.objectUrl(key), {
      headers: { range: `bytes=${start}-${end}` },
    });
    if (response.status === 416) return new Uint8Array(0);
    if (!response.ok) throw new Error(`S3 GET failed with ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async read(key: string): Promise<ReadableStream<Uint8Array>> {
    const response = await this.client.fetch(this.objectUrl(key));
    if (!response.ok || !response.body) throw new Error(`S3 GET failed with ${response.status}`);
    return response.body;
  }

  async write(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    options: { contentType: string; size: number },
  ): Promise<void> {
    const init: RequestInit & { duplex?: 'half' } = {
      method: 'PUT',
      body: body as NonNullable<RequestInit['body']>,
      headers: { 'content-type': options.contentType, 'content-length': String(options.size) },
    };
    if (!(body instanceof Uint8Array)) init.duplex = 'half';
    const response = await this.client.fetch(this.objectUrl(key), init);
    if (!response.ok) throw new Error(`S3 PUT failed with ${response.status}`);
  }

  async delete(key: string): Promise<void> {
    const response = await this.client.fetch(this.objectUrl(key), { method: 'DELETE' });
    if (!response.ok && response.status !== 404)
      throw new Error(`S3 DELETE failed with ${response.status}`);
  }

  async deleteMany(keys: readonly string[]): Promise<void> {
    const queue = [...keys];
    const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
      for (let key = queue.shift(); key !== undefined; key = queue.shift()) await this.delete(key);
    });
    await Promise.all(workers);
  }
}
