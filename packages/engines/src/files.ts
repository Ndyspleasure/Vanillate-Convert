/**
 * Content detection for files on disk (job inputs and engine outputs).
 */
import { open } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';

import {
  DETECT_HEAD_BYTES,
  DETECT_TAIL_BYTES,
  detectFormat,
  type DetectionResult,
  type Registry,
} from '@vanillate/core';

export interface FileSample {
  size: number;
  head: Uint8Array;
  tail: Uint8Array;
}

/** Reads the first and last bytes of a file (the whole file when it is small). */
export async function sampleFile(path: string): Promise<FileSample> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const headLength = Math.min(size, DETECT_HEAD_BYTES);
    const head = new Uint8Array(headLength);
    await handle.read(head, 0, headLength, 0);
    if (size <= DETECT_HEAD_BYTES) return { size, head, tail: head };
    const tailLength = Math.min(size, DETECT_TAIL_BYTES);
    const tail = new Uint8Array(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    return { size, head, tail };
  } finally {
    await handle.close();
  }
}

/** The first decompressed bytes of a gzip stream (enough to recognize a TAR inside). */
export function inflateHead(head: Uint8Array, limit = 4096): Promise<Uint8Array | null> {
  if (head[0] !== 0x1f || head[1] !== 0x8b) return Promise.resolve(null);
  return new Promise((resolve) => {
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      gunzip.destroy();
      resolve(length > 0 ? new Uint8Array(Buffer.concat(chunks).subarray(0, limit)) : null);
    };
    gunzip.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      length += chunk.length;
      if (length >= limit) finish();
    });
    gunzip.on('error', finish);
    gunzip.on('end', finish);
    gunzip.end(head);
  });
}

/** Detects the format of a file on disk from its content (and name, when given). */
export async function detectFile(
  path: string,
  registry: Registry,
  name: string | null = null,
): Promise<DetectionResult & { size: number }> {
  const sample = await sampleFile(path);
  const result = detectFormat(
    {
      name,
      size: sample.size,
      head: sample.head,
      tail: sample.tail,
      inflatedHead: await inflateHead(sample.head),
    },
    registry,
  );
  return { ...result, size: sample.size };
}
