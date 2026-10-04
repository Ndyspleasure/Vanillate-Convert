/**
 * Minimal ZIP directory reader for format detection.
 *
 * Reads entry names from the central directory when it lies inside the provided tail bytes,
 * otherwise walks local file headers from the head. Never decompresses anything; the only
 * content read is a stored `mimetype` entry (ODF, EPUB).
 */
import { readUint16LE, readUint32LE } from '../util/bytes.ts';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const MAX_ENTRIES = 5000;
const latin1 = new TextDecoder('latin1');

export interface ZipListing {
  entries: string[];
  /** Content of a stored `mimetype` first entry, if present. */
  mimetype: string | null;
  /** Whether `entries` comes from the complete central directory. */
  complete: boolean;
}

export function isZip(head: Uint8Array): boolean {
  return (
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)
  );
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  try {
    return utf8 ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : latin1.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

function readMimetype(head: Uint8Array): string | null {
  if (readUint32LE(head, 0) !== LOCAL_HEADER) return null;
  const method = readUint16LE(head, 8);
  const compressed = readUint32LE(head, 18);
  const nameLength = readUint16LE(head, 26);
  const extraLength = readUint16LE(head, 28);
  const name = latin1.decode(head.subarray(30, 30 + nameLength));
  if (name !== 'mimetype' || method !== 0 || compressed > 200) return null;
  const start = 30 + nameLength + extraLength;
  if (start + compressed > head.length) return null;
  return latin1.decode(head.subarray(start, start + compressed)).trim();
}

function listFromCentralDirectory(tail: Uint8Array, tailOffset: number): string[] | null {
  // EOCD is at least 22 bytes and may be followed by a comment of up to 65535 bytes.
  for (let i = tail.length - 22; i >= 0 && i >= tail.length - 22 - 65535; i--) {
    if (readUint32LE(tail, i) !== END_OF_CENTRAL_DIRECTORY) continue;
    const count = readUint16LE(tail, i + 10);
    const size = readUint32LE(tail, i + 12);
    const offset = readUint32LE(tail, i + 16);
    if (count === 0xffff || offset === 0xffffffff) return null; // ZIP64: fall back to local headers
    const start = offset - tailOffset;
    if (start < 0 || start + size > tail.length) return null;
    const names: string[] = [];
    let p = start;
    for (let n = 0; n < Math.min(count, MAX_ENTRIES); n++) {
      if (readUint32LE(tail, p) !== CENTRAL_HEADER) return names.length > 0 ? names : null;
      const flags = readUint16LE(tail, p + 8);
      const nameLength = readUint16LE(tail, p + 28);
      const extraLength = readUint16LE(tail, p + 30);
      const commentLength = readUint16LE(tail, p + 32);
      names.push(decodeName(tail.subarray(p + 46, p + 46 + nameLength), (flags & 0x0800) !== 0));
      p += 46 + nameLength + extraLength + commentLength;
    }
    return names;
  }
  return null;
}

function listFromLocalHeaders(head: Uint8Array): string[] {
  const names: string[] = [];
  let p = 0;
  while (p + 30 <= head.length && names.length < MAX_ENTRIES) {
    if (readUint32LE(head, p) !== LOCAL_HEADER) break;
    const flags = readUint16LE(head, p + 6);
    const compressed = readUint32LE(head, p + 18);
    const nameLength = readUint16LE(head, p + 26);
    const extraLength = readUint16LE(head, p + 28);
    if (p + 30 + nameLength > head.length) break;
    names.push(decodeName(head.subarray(p + 30, p + 30 + nameLength), (flags & 0x0800) !== 0));
    // Entries with a data descriptor do not record their size up front; stop walking.
    if ((flags & 0x0008) !== 0) break;
    p += 30 + nameLength + extraLength + compressed;
  }
  return names;
}

/**
 * Lists ZIP entries from the first bytes (`head`) and last bytes (`tail`) of a file of
 * `size` bytes. When the file fits in `head`, pass the same buffer for both.
 */
export function listZip(
  head: Uint8Array,
  tail: Uint8Array | undefined,
  size: number | undefined,
): ZipListing {
  const mimetype = readMimetype(head);
  if (tail && size !== undefined) {
    const central = listFromCentralDirectory(tail, size - tail.length);
    if (central) return { entries: central, mimetype, complete: true };
  }
  return { entries: listFromLocalHeaders(head), mimetype, complete: false };
}
