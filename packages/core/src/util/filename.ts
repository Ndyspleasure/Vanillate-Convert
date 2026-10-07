/**
 * File name handling. Names come from users and are untrusted: they are only ever used as
 * display names and download names, never as filesystem paths.
 */
import type { Format } from '../registry/types.ts';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// Control characters, characters invalid on Windows, and bidi overrides that can disguise
// extensions (e.g. "photo\u202Egpj.exe").
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const MAX_BYTES = 180;

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function truncateUtf8(text: string, maxBytes: number): string {
  let out = '';
  for (const char of text) {
    if (utf8Length(out + char) > maxBytes) break;
    out += char;
  }
  return out;
}

/** Returns a safe display/download name (no paths, control characters or reserved names). */
export function sanitizeFilename(name: string | null | undefined, fallback = 'file'): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  let clean = base.normalize('NFC').replace(UNSAFE, '_').replace(/\s+/g, ' ').trim();
  clean = clean.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (clean === '' || /^_+$/.test(clean)) clean = fallback;
  if (WINDOWS_RESERVED.test(clean)) clean = `_${clean}`;
  if (utf8Length(clean) > MAX_BYTES) {
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 && clean.length - dot <= 17 ? clean.slice(dot) : '';
    clean =
      truncateUtf8(clean.slice(0, clean.length - ext.length), MAX_BYTES - utf8Length(ext)) + ext;
  }
  return clean;
}

/** The file name without its extension (known double extensions such as `.tar.gz` included). */
export function fileStem(name: string, knownExtensions: readonly string[] = []): string {
  const lower = name.toLowerCase();
  const double = knownExtensions
    .filter((ext) => ext.includes('.'))
    .find((ext) => lower.endsWith(`.${ext}`));
  if (double) return name.slice(0, name.length - double.length - 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Builds an output name from the input name and target format, e.g. `photo.heic` → `photo.jpg`
 * or, for multi-file outputs, `slides-003.png`.
 */
export function outputFilename(
  inputName: string,
  target: Pick<Format, 'extensions'>,
  part?: { index: number; total: number },
  knownExtensions: readonly string[] = [],
): string {
  const safe = sanitizeFilename(inputName);
  const stem = fileStem(safe, knownExtensions) || 'file';
  const extension = target.extensions[0] ?? 'bin';
  const suffix =
    part && part.total > 1
      ? `-${String(part.index + 1).padStart(Math.max(3, String(part.total).length), '0')}`
      : '';
  return sanitizeFilename(`${stem}${suffix}.${extension}`);
}

/** RFC 6266 / RFC 5987 Content-Disposition value for downloads. */
export function contentDisposition(filename: string): string {
  const safe = sanitizeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
