/**
 * Local filesystem storage for development and single-machine deployments. Uploads and
 * downloads go through the web app (`/api/v1/storage/<token>`) using HMAC-signed tokens.
 * Not suitable for serverless platforms such as Vercel (no shared, persistent disk).
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';

import { signToken } from './signing.ts';
import {
  assertValidKey,
  type DownloadUrlOptions,
  type SignedRequest,
  type Storage,
  type StoredObject,
  type UploadUrlOptions,
} from './types.ts';

export interface LocalStorageOptions {
  root: string;
  signingSecret: string;
  /** Public path (or absolute URL) of the storage route, e.g. `/api/v1/storage`. */
  publicPath: string;
}

export class LocalStorage implements Storage {
  readonly driver = 'local' as const;
  private readonly root: string;
  private readonly secret: string;
  private readonly publicPath: string;

  constructor(options: LocalStorageOptions) {
    if (options.signingSecret.length < 32)
      throw new Error('STORAGE_SIGNING_SECRET must be at least 32 characters');
    this.root = resolve(options.root);
    this.secret = options.signingSecret;
    this.publicPath = options.publicPath.replace(/\/+$/, '');
  }

  /** Resolves a key to a path inside the root (keys are validated, this is defense in depth). */
  private path(key: string): string {
    assertValidKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('key escapes the storage root');
    return full;
  }

  get signingSecret(): string {
    return this.secret;
  }

  async createUploadUrl(key: string, options: UploadUrlOptions): Promise<SignedRequest> {
    this.path(key);
    const expires = Math.floor(Date.now() / 1000) + options.expiresIn;
    const token = await signToken(this.secret, {
      key,
      method: 'PUT',
      expires,
      contentType: options.contentType,
      size: options.size,
    });
    return {
      method: 'PUT',
      url: `${this.publicPath}/${token}`,
      headers: { 'content-type': options.contentType },
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  async createDownloadUrl(key: string, options: DownloadUrlOptions): Promise<SignedRequest> {
    this.path(key);
    const expires = Math.floor(Date.now() / 1000) + options.expiresIn;
    const token = await signToken(this.secret, {
      key,
      method: 'GET',
      expires,
      contentType: options.contentType,
      filename: options.filename,
    });
    return {
      method: 'GET',
      url: `${this.publicPath}/${token}`,
      headers: {},
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const info = await stat(this.path(key));
      return info.isFile() ? { key, size: info.size, contentType: null } : null;
    } catch {
      return null;
    }
  }

  async readRange(key: string, start: number, end: number): Promise<Uint8Array> {
    const handle = await open(this.path(key), 'r');
    try {
      const length = Math.max(0, end - start + 1);
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  read(key: string): Promise<ReadableStream<Uint8Array>> {
    return Promise.resolve(
      Readable.toWeb(createReadStream(this.path(key))) as ReadableStream<Uint8Array>,
    );
  }

  /** Streams to a temporary file, enforcing the exact size, then renames atomically. */
  async write(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    options: { contentType: string; size: number },
  ): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    const temp = join(dirname(target), `.upload-${crypto.randomUUID()}`);
    let written = 0;
    try {
      const source =
        body instanceof Uint8Array
          ? Readable.from([body])
          : Readable.fromWeb(body as WebReadableStream);
      const sink = createWriteStream(temp, { flags: 'wx' });
      const counter = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          written += chunk.length;
          if (written > options.size) {
            callback(new RangeError(`upload exceeds ${options.size} bytes`));
            return;
          }
          sink.write(chunk, callback);
        },
        final(callback) {
          sink.end(callback);
        },
      });
      await pipeline(source, counter);
      if (written !== options.size)
        throw new RangeError(`expected ${options.size} bytes, got ${written}`);
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async deleteMany(keys: readonly string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.delete(key)));
  }
}
