/**
 * Text decoding with BOM handling and a legacy fallback.
 *
 * Text-based formats (subtitles, CSV, JSON...) arrive in many encodings. We honour UTF-8 and
 * UTF-16 byte order marks, decode strict UTF-8 when possible and fall back to Windows-1252,
 * which is how most "ANSI" subtitle and CSV files are encoded.
 */

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
  bom: boolean;
}

function decoder(encoding: TextEncodingName, fatal: boolean): InstanceType<typeof TextDecoder> {
  return new TextDecoder(encoding, { fatal, ignoreBOM: false });
}

/**
 * Removes up to three trailing bytes of an incomplete UTF-8 sequence so that a truncated
 * head (e.g. the first 64 KiB of a file) still decodes strictly.
 */
function trimPartialUtf8(bytes: Uint8Array): Uint8Array {
  const end = bytes.length;
  for (let back = 1; back <= 3 && end - back >= 0; back++) {
    const byte = bytes[end - back] ?? 0;
    if ((byte & 0xc0) === 0x80) continue; // continuation byte
    if ((byte & 0x80) === 0) return bytes; // ASCII: complete
    const needed =
      (byte & 0xe0) === 0xc0 ? 2 : (byte & 0xf0) === 0xe0 ? 3 : (byte & 0xf8) === 0xf0 ? 4 : 1;
    return back < needed ? bytes.subarray(0, end - back) : bytes;
  }
  return bytes;
}

export function detectBom(bytes: Uint8Array): TextEncodingName | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

/**
 * Decodes bytes as text. `truncated` indicates the bytes are only the beginning of a file,
 * so an incomplete trailing UTF-8 sequence is tolerated.
 */
export function decodeText(bytes: Uint8Array, { truncated = false } = {}): DecodedText {
  const bom = detectBom(bytes);
  if (bom === 'utf-16le' || bom === 'utf-16be') {
    const even = truncated ? bytes.subarray(0, bytes.length - (bytes.length % 2)) : bytes;
    return { text: decoder(bom, false).decode(even), encoding: bom, bom: true };
  }
  const candidate = truncated ? trimPartialUtf8(bytes) : bytes;
  try {
    return {
      text: decoder('utf-8', true).decode(candidate),
      encoding: 'utf-8',
      bom: bom === 'utf-8',
    };
  } catch {
    return {
      text: decoder('windows-1252', false).decode(bytes),
      encoding: 'windows-1252',
      bom: false,
    };
  }
}

/**
 * Heuristic: is this (head of a) file text? UTF-16 with BOM is text; otherwise there must be
 * no NUL bytes and few control characters, and it must decode as UTF-8 or look like
 * single-byte text.
 */
export function looksLikeText(bytes: Uint8Array, { truncated = false } = {}): boolean {
  if (bytes.length === 0) return false;
  const bom = detectBom(bytes);
  if (bom === 'utf-16le' || bom === 'utf-16be') return true;
  let control = 0;
  for (const byte of bytes) {
    if (byte === 0) return false;
    if (
      byte < 0x20 &&
      byte !== 0x09 &&
      byte !== 0x0a &&
      byte !== 0x0d &&
      byte !== 0x0c &&
      byte !== 0x1b
    )
      control++;
  }
  if (control / bytes.length > 0.02) return false;
  try {
    decoder('utf-8', true).decode(truncated ? trimPartialUtf8(bytes) : bytes);
    return true;
  } catch {
    // Legacy 8-bit text: allow if mostly printable ASCII.
    let ascii = 0;
    for (const byte of bytes) if (byte >= 0x20 && byte < 0x7f) ascii++;
    return ascii / bytes.length > 0.85;
  }
}

/** Strips a leading BOM character from decoded text. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
