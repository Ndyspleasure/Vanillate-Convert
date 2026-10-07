import { concatBytes } from '@vanillate/core';

import {
  assertValidKey,
  incomplete,
  tooLarge,
  type DownloadUrlOptions,
  type SignedRequest,
  type Storage,
  type StoredObject,
  type UploadUrlOptions,
} from './types.ts';

interface Entry {
  bytes: Uint8Array;
  contentType: string;
}

export async function readAll(
  stream: ReadableStream<Uint8Array>,
  limit = Number.MAX_SAFE_INTEGER,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new RangeError('stream exceeds the expected size');
    }
    chunks.push(value);
  }
  return concatBytes(chunks);
}

/** In-memory storage for tests and single-process development. */
export class MemoryStorage implements Storage {
  readonly driver = 'memory' as const;
  private readonly objects = new Map<string, Entry>();

  createUploadUrl(key: string, options: UploadUrlOptions): Promise<SignedRequest> {
    return Promise.resolve().then(() => {
      assertValidKey(key);
      return {
        method: 'PUT' as const,
        url: `memory://${key}`,
        headers: { 'content-type': options.contentType },
        expiresAt: new Date(Date.now() + options.expiresIn * 1000).toISOString(),
      };
    });
  }

  createDownloadUrl(key: string, options: DownloadUrlOptions): Promise<SignedRequest> {
    return Promise.resolve().then(() => {
      assertValidKey(key);
      return {
        method: 'GET' as const,
        url: `memory://${key}?filename=${encodeURIComponent(options.filename)}`,
        headers: {},
        expiresAt: new Date(Date.now() + options.expiresIn * 1000).toISOString(),
      };
    });
  }

  head(key: string): Promise<StoredObject | null> {
    const entry = this.objects.get(key);
    return Promise.resolve(
      entry ? { key, size: entry.bytes.length, contentType: entry.contentType } : null,
    );
  }

  readRange(key: string, start: number, end: number): Promise<Uint8Array> {
    const entry = this.objects.get(key);
    if (!entry) return Promise.reject(new Error(`missing object ${key}`));
    return Promise.resolve(entry.bytes.slice(start, Math.min(end + 1, entry.bytes.length)));
  }

  read(key: string): Promise<ReadableStream<Uint8Array>> {
    const entry = this.objects.get(key);
    if (!entry) return Promise.reject(new Error(`missing object ${key}`));
    const bytes = entry.bytes;
    return Promise.resolve(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    );
  }

  async write(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    options: { contentType: string; size: number },
  ): Promise<void> {
    assertValidKey(key);
    let bytes: Uint8Array;
    try {
      bytes = body instanceof Uint8Array ? body : await readAll(body, options.size);
    } catch (error) {
      throw error instanceof RangeError ? tooLarge(options.size) : error;
    }
    if (bytes.length > options.size) throw tooLarge(options.size);
    if (bytes.length < options.size) throw incomplete(options.size, bytes.length);
    this.objects.set(key, { bytes: bytes.slice(), contentType: options.contentType });
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  async deleteMany(keys: readonly string[]): Promise<void> {
    for (const key of keys) await this.delete(key);
  }

  /** Test helper: number of stored objects. */
  get size(): number {
    return this.objects.size;
  }
}
