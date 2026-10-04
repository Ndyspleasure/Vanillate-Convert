/** Small byte helpers shared by detection and engines. Isomorphic (no Node APIs). */

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function asciiToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** UTF-16LE encoding of an ASCII string (used to find OLE2 stream names). */
export function utf16leBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) out[i * 2] = text.charCodeAt(i) & 0xff;
  return out;
}

export function startsWith(haystack: Uint8Array, needle: Uint8Array, offset = 0): boolean {
  if (offset < 0 || offset + needle.length > haystack.length) return false;
  for (let i = 0; i < needle.length; i++) if (haystack[offset + i] !== needle[i]) return false;
  return true;
}

/** Index of `needle` in `haystack[from, to)`, or -1. */
export function indexOfBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
  from = 0,
  to = haystack.length,
): number {
  const end = Math.min(to, haystack.length) - needle.length;
  const first = needle[0];
  if (needle.length === 0) return from;
  for (let i = Math.max(0, from); i <= end; i++) {
    if (haystack[i] !== first) continue;
    let match = true;
    for (let j = 1; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

export function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

export function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)) +
    (bytes[offset + 3] ?? 0) * 0x1000000
  );
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

const KIB = 1024;
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Human readable size using binary multiples (1 KB = 1024 B), e.g. `12.5 MB`. */
export function formatBytes(bytes: number, locale = 'en'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= KIB && unit < UNITS.length - 1) {
    value /= KIB;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${UNITS[unit]}`;
}
