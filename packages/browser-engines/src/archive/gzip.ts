/**
 * gzip via the platform's Compression Streams API, with an output size limit.
 */
import { concatBytes } from '@vanillate/core';

export class SizeLimitError extends RangeError {
  override name = 'SizeLimitError';
}

async function collect(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new SizeLimitError('decompressed data exceeds the limit');
    }
    chunks.push(value);
  }
  return concatBytes(chunks);
}

type ByteTransform = ReadableWritablePair<Uint8Array, Uint8Array>;

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
}

// The DOM typings model the writable side as BufferSource; at runtime both sides are bytes.
function decompressor(): ByteTransform {
  return new DecompressionStream('gzip') as unknown as ByteTransform;
}

function compressor(format: 'gzip' | 'deflate'): ByteTransform {
  return new CompressionStream(format) as unknown as ByteTransform;
}

export async function gunzip(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  return collect(streamOf(bytes).pipeThrough(decompressor()), limit);
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return collect(streamOf(bytes).pipeThrough(compressor('gzip')), Number.MAX_SAFE_INTEGER);
}

/** zlib (RFC 1950) deflate, as used by PDF FlateDecode and TIFF/PNG. */
export async function deflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  return collect(streamOf(bytes).pipeThrough(compressor('deflate')), Number.MAX_SAFE_INTEGER);
}

/** Reads the original file name stored in a gzip header (FNAME), if present. */
export function gzipOriginalName(bytes: Uint8Array): string | null {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return null;
  const flags = bytes[3] ?? 0;
  let offset = 10;
  if (flags & 0x04) offset += 2 + ((bytes[10] ?? 0) | ((bytes[11] ?? 0) << 8)); // FEXTRA
  if (!(flags & 0x08)) return null; // FNAME
  const end = bytes.indexOf(0, offset);
  if (end < 0 || end - offset > 1024) return null;
  return new TextDecoder('latin1').decode(bytes.subarray(offset, end)) || null;
}
