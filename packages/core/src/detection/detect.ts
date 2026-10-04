/**
 * Content-based format detection.
 *
 * Evidence, strongest first:
 *   1. container sniffing — ZIP entry names / `mimetype`, OLE2 stream names, TAR inside gzip;
 *   2. structured text — XML root element, JSON/NDJSON parsing, text patterns;
 *   3. magic-byte signatures from the catalog;
 *   4. the file extension and, last, the MIME type reported by the browser.
 *
 * Extensions and MIME types are untrusted hints: they break ties between formats whose
 * content looks the same (e.g. TIFF-based camera RAW formats) and they are reported when
 * they contradict the content. The same function runs in the browser (for instant feedback)
 * and on the server (to validate uploads before any engine touches them).
 */
import type { Sniff } from '../catalog/schema.ts';
import type { Registry } from '../registry/registry.ts';
import type { Format } from '../registry/types.ts';
import { startsWith, asciiToBytes } from '../util/bytes.ts';
import { isOle, oleHasStream } from './ole.ts';
import { matchSignatures } from './signatures.ts';
import { decodeText, looksLikeText, stripBom } from './text.ts';
import { isZip, listZip, type ZipListing } from './zip.ts';

/** Bytes to read from the start and end of a file for detection. */
export const DETECT_HEAD_BYTES = 65536;
export const DETECT_TAIL_BYTES = 65536;

export interface DetectInput {
  /** Original file name (untrusted). */
  name?: string | null;
  /** MIME type reported by the client (untrusted). */
  mimeType?: string | null;
  /** Total file size in bytes. */
  size?: number;
  /** The first bytes of the file (up to `DETECT_HEAD_BYTES`). */
  head: Uint8Array;
  /** The last bytes of the file (up to `DETECT_TAIL_BYTES`); may equal `head` for small files. */
  tail?: Uint8Array;
  /** Decompressed beginning of a gzip stream, used to recognize `.tar.gz` without an extension. */
  inflatedHead?: Uint8Array | null;
}

export type DetectionConfidence = 'high' | 'medium' | 'low';
export type DetectionEvidence =
  'container' | 'content' | 'signature' | 'extension' | 'mime' | 'family';

export interface DetectionCandidate {
  format: Format;
  score: number;
}

export interface DetectionResult {
  format: Format | null;
  confidence: DetectionConfidence | null;
  evidence: DetectionEvidence[];
  /** Normalized extension from the file name (handles double extensions like `tar.gz`). */
  extension: string | null;
  /** Set when the extension points to a different format than the detected content. */
  extensionMismatch: { extension: string; expected: Format[] } | null;
  /** Content-matched candidates, strongest first (at most five). */
  candidates: DetectionCandidate[];
  isText: boolean;
  empty: boolean;
}

/**
 * Formats whose content can legitimately look identical. Within a family the file extension
 * decides (e.g. an `.m4a` file with an `isom` brand is still M4A).
 */
const FAMILIES: readonly (readonly string[])[] = [
  ['mp4', 'm4v', 'm4a', 'm4r', 'alac', 'mov', '3gp', '3g2'],
  ['mkv', 'mka', 'webm'],
  ['ogg', 'opus', 'ogv'],
  ['wma', 'wmv', 'asf'],
  ['mpg', 'vob'],
  ['ts', 'm2ts'],
  ['tiff', 'dng', 'nef', 'arw', 'pef', 'srw', 'cr2'],
  ['heic', 'heif'],
  ['zip', 'cbz'],
  ['rar', 'cbr'],
  ['gz', 'tgz'],
  ['bz2', 'tbz2'],
  ['xz', 'txz'],
  ['pdf', 'ai'],
  ['ps', 'eps'],
  ['doc', 'xls', 'ppt'],
  ['pptx', 'ppsx'],
  ['pages', 'numbers', 'key'],
  ['mobi', 'azw', 'azw3'],
  ['ttml', 'dfxp'],
  ['json', 'gltf', 'jsonl', 'ndjson'],
  ['xml', 'svg', 'ttml', 'dfxp', 'fb2', 'dae', 'xmp'],
];

const familyIndex = new Map<string, Set<string>>();
for (const family of FAMILIES) {
  for (const id of family) {
    const set = familyIndex.get(id) ?? new Set<string>();
    for (const member of family) set.add(member);
    familyIndex.set(id, set);
  }
}

export function sameFamily(a: string, b: string): boolean {
  return a === b || (familyIndex.get(a)?.has(b) ?? false);
}

// Content score levels. Signature scores are their byte length (≈ 2–16).
const SCORE = {
  zipSniffBase: 100,
  oleSniff: 100,
  tarInGzip: 90,
  xmlRootNamespace: 80,
  xmlRoot: 70,
  jsonKeys: 60,
  textPattern: 50,
  ndjson: 45,
  xmlGeneric: 40,
  jsonParsed: 35,
  jsonPrefix: 25,
  /** A signature that its own container sniff contradicts. */
  weak: 1,
} as const;

/** Content matches below this score need extension agreement to be accepted. */
const MEANINGFUL = 2;
const HIGH_CONFIDENCE = 8;

/** Extracts the extension, preferring known double extensions such as `tar.gz`. */
export function extractExtension(
  name: string | null | undefined,
  registry: Registry,
): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  const parts = base.split('.');
  if (parts.length < 2) return null;
  if (parts.length >= 3) {
    const double = parts.slice(-2).join('.');
    if (registry.formatsByExtension(double).length > 0) return double;
  }
  const single = parts[parts.length - 1] ?? '';
  return single.length > 0 && single.length <= 16 ? single : null;
}

interface TextView {
  text: string;
  /** The whole file is contained in `text`. */
  complete: boolean;
}

function xmlRoot(text: string): { name: string; tag: string } | null {
  let rest = stripBom(text).trimStart();
  for (let guard = 0; guard < 64; guard++) {
    if (rest.startsWith('<?')) {
      const end = rest.indexOf('?>');
      if (end < 0) return null;
      rest = rest.slice(end + 2).trimStart();
    } else if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->');
      if (end < 0) return null;
      rest = rest.slice(end + 3).trimStart();
    } else if (/^<!doctype/i.test(rest)) {
      // Skip a DOCTYPE, including an internal subset in brackets.
      let depth = 0;
      let i = 0;
      for (; i < rest.length; i++) {
        const ch = rest[i];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
      }
      rest = rest.slice(i + 1).trimStart();
    } else {
      break;
    }
  }
  const match = /^<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?=[\s/>])/.exec(rest);
  if (!match?.[1]) return null;
  const end = rest.indexOf('>');
  return { name: match[1], tag: end > 0 ? rest.slice(0, end + 1) : rest.slice(0, 2048) };
}

function localName(qualified: string): string {
  const colon = qualified.indexOf(':');
  return colon >= 0 ? qualified.slice(colon + 1) : qualified;
}

function jsonScore(view: TextView, requireKeys: readonly string[] | undefined): number {
  const trimmed = stripBom(view.text).trim();
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return 0;
  if (view.complete) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (requireKeys && requireKeys.length > 0) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return 0;
        return requireKeys.every((key) => key in value) ? SCORE.jsonKeys : 0;
      }
      return SCORE.jsonParsed;
    } catch {
      return 0;
    }
  }
  if (requireKeys && requireKeys.length > 0) {
    if (first !== '{') return 0;
    return requireKeys.every((key) =>
      new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`).test(trimmed),
    )
      ? SCORE.jsonKeys
      : 0;
  }
  return /^[[{]\s*(?:["{[\]}\d-]|true|false|null)/.test(trimmed) ? SCORE.jsonPrefix : 0;
}

function ndjsonScore(view: TextView): number {
  const lines = stripBom(view.text).split(/\r?\n/);
  if (!view.complete) lines.pop(); // the last line may be truncated
  const records = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 20);
  if (records.length < 2) return 0;
  for (const line of records) {
    if (line[0] !== '{' && line[0] !== '[') return 0;
    try {
      JSON.parse(line);
    } catch {
      return 0;
    }
  }
  return SCORE.ndjson;
}

const patternCache = new Map<string, RegExp>();
function textPattern(pattern: string, flags: string | undefined): RegExp {
  const key = `${flags ?? ''}/${pattern}`;
  let regex = patternCache.get(key);
  if (!regex) {
    regex = new RegExp(pattern, flags);
    patternCache.set(key, regex);
  }
  return regex;
}

interface SniffContext {
  head: Uint8Array;
  tail: Uint8Array | undefined;
  size: number | undefined;
  inflatedHead: Uint8Array | null;
  zip: ZipListing | null;
  ole: boolean;
  text: TextView | null;
}

/** Returns the content score of a sniffer, or `null` when the sniffer does not apply. */
function sniffScore(sniff: Sniff, ctx: SniffContext): number | null {
  switch (sniff.type) {
    case 'zip': {
      if (!ctx.zip) return null;
      const names = ctx.zip.entries;
      let conditions = 0;
      if (sniff.mimetype !== undefined) {
        conditions++;
        if (ctx.zip.mimetype !== sniff.mimetype) return 0;
      }
      for (const entry of sniff.entries ?? []) {
        conditions++;
        if (!names.includes(entry)) return 0;
      }
      for (const prefix of sniff.entryPrefixes ?? []) {
        conditions++;
        if (!names.some((name) => name.startsWith(prefix))) return 0;
      }
      return conditions > 0 ? SCORE.zipSniffBase + conditions * 10 : 0;
    }
    case 'ole':
      if (!ctx.ole) return null;
      return sniff.streams.some((stream) => oleHasStream(stream, ctx.head, ctx.tail))
        ? SCORE.oleSniff
        : 0;
    case 'tar-in':
      if (!ctx.inflatedHead) return null;
      return startsWith(ctx.inflatedHead, asciiToBytes('ustar'), 257) ? SCORE.tarInGzip : 0;
    case 'text':
      if (!ctx.text) return null;
      return textPattern(sniff.pattern, sniff.flags).test(ctx.text.text.slice(0, 16384))
        ? SCORE.textPattern
        : 0;
    case 'json':
      if (!ctx.text) return null;
      return jsonScore(ctx.text, sniff.requireKeys);
    case 'ndjson':
      if (!ctx.text) return null;
      return ndjsonScore(ctx.text);
    case 'xml': {
      if (!ctx.text) return null;
      const root = xmlRoot(ctx.text.text);
      if (!root) return 0;
      if (sniff.root === undefined) return SCORE.xmlGeneric;
      if (localName(root.name).toLowerCase() !== sniff.root.toLowerCase()) return 0;
      if (sniff.namespace !== undefined)
        return root.tag.includes(sniff.namespace) ? SCORE.xmlRootNamespace : SCORE.xmlRoot;
      return SCORE.xmlRoot;
    }
  }
}

function contentScore(format: Format, ctx: SniffContext): number {
  const signature = format.signatures.length > 0 ? matchSignatures(format.signatures, ctx) : 0;
  if (!format.sniff) return signature;
  const sniffed = sniffScore(format.sniff, ctx);
  if (sniffed === null) {
    // The sniffer could not run (e.g. not a ZIP): rely on the signature alone.
    return signature;
  }
  if (sniffed > 0) return Math.max(sniffed, signature);
  // A shared container signature (e.g. OLE2) contradicted by the sniffer is weak evidence.
  return signature > 0 ? SCORE.weak : 0;
}

function byPopularity(a: Format, b: Format): number {
  return b.popularity - a.popularity || a.id.localeCompare(b.id);
}

export function detectFormat(input: DetectInput, registry: Registry): DetectionResult {
  const extension = extractExtension(input.name, registry);
  const extFormats = extension ? [...registry.formatsByExtension(extension)] : [];
  const mimeFormats = input.mimeType ? [...registry.formatsByMime(input.mimeType)] : [];
  const empty = input.size === 0 || input.head.length === 0;
  const head = input.head;
  const complete = input.size !== undefined && input.size <= head.length;
  const tail = input.tail ?? (complete ? head : undefined);

  const base: Omit<DetectionResult, 'format' | 'confidence' | 'evidence' | 'extensionMismatch'> = {
    extension,
    candidates: [],
    isText: false,
    empty,
  };
  if (empty) {
    return { ...base, format: null, confidence: null, evidence: [], extensionMismatch: null };
  }

  const isText = looksLikeText(head, { truncated: !complete });
  const ctx: SniffContext = {
    head,
    tail,
    size: input.size,
    inflatedHead: input.inflatedHead ?? null,
    zip: isZip(head) ? listZip(head, tail, input.size) : null,
    ole: isOle(head),
    text: isText ? { text: decodeText(head, { truncated: !complete }).text, complete } : null,
  };

  const scored: DetectionCandidate[] = [];
  for (const format of registry.formats) {
    const score = contentScore(format, ctx);
    if (score > 0) scored.push({ format, score });
  }
  scored.sort((a, b) => b.score - a.score || byPopularity(a.format, b.format));
  const candidates = scored.slice(0, 5);
  const top = scored[0]?.score ?? 0;

  const mismatch = (chosen: Format): DetectionResult['extensionMismatch'] =>
    extension && extFormats.length > 0 && !chosen.extensions.includes(extension)
      ? { extension, expected: extFormats }
      : null;

  if (top >= MEANINGFUL) {
    const best = scored.filter((c) => c.score === top).map((c) => c.format);
    const extInBest = best.filter((f) => extFormats.includes(f));
    if (extInBest.length > 0) {
      const format = [...extInBest].sort(byPopularity)[0]!;
      return {
        ...base,
        candidates,
        isText,
        format,
        confidence: top >= HIGH_CONFIDENCE ? 'high' : 'medium',
        evidence: [scoreEvidence(top), 'extension'],
        extensionMismatch: null,
      };
    }
    const bestFormat = best.sort(byPopularity)[0]!;
    const familyMatch = extFormats
      .filter((f) => sameFamily(f.id, bestFormat.id))
      .sort(byPopularity)[0];
    if (familyMatch) {
      return {
        ...base,
        candidates,
        isText,
        format: familyMatch,
        confidence: 'medium',
        evidence: ['family', 'extension'],
        extensionMismatch: null,
      };
    }
    return {
      ...base,
      candidates,
      isText,
      format: bestFormat,
      confidence: top >= HIGH_CONFIDENCE && extFormats.length === 0 ? 'high' : 'medium',
      evidence: [scoreEvidence(top)],
      extensionMismatch: mismatch(bestFormat),
    };
  }

  // No meaningful content evidence: fall back to the extension when the content does not
  // contradict it.
  const weakIds = new Set(scored.map((c) => c.format.id));
  const compatible = extFormats.filter((format) => {
    if (weakIds.has(format.id)) return true;
    const hasMagic =
      format.signatures.length > 0 || (format.sniff !== null && format.sniff.type !== 'text');
    const textual = format.traits.includes('text');
    if (hasMagic) return false; // its magic bytes should have matched
    return textual ? isText : !isText;
  });
  const fromExtension = compatible.sort(byPopularity)[0];
  if (fromExtension) {
    return {
      ...base,
      candidates,
      isText,
      format: fromExtension,
      confidence: isText && fromExtension.traits.includes('text') ? 'medium' : 'low',
      evidence: weakIds.has(fromExtension.id) ? ['signature', 'extension'] : ['extension'],
      extensionMismatch: null,
    };
  }

  const fromMime = mimeFormats
    .filter(
      (f) => f.signatures.length === 0 && f.sniff === null && f.traits.includes('text') === isText,
    )
    .sort(byPopularity)[0];
  if (fromMime && extFormats.length === 0) {
    return {
      ...base,
      candidates,
      isText,
      format: fromMime,
      confidence: 'low',
      evidence: ['mime'],
      extensionMismatch: null,
    };
  }

  if (isText) {
    const txt = registry.format('txt');
    if (txt) {
      return {
        ...base,
        candidates,
        isText,
        format: txt,
        confidence: 'low',
        evidence: ['content'],
        extensionMismatch: mismatch(txt),
      };
    }
  }
  return {
    ...base,
    candidates,
    isText,
    format: null,
    confidence: null,
    evidence: [],
    extensionMismatch:
      extension && extFormats.length > 0 ? { extension, expected: extFormats } : null,
  };
}

function scoreEvidence(score: number): DetectionEvidence {
  if (score >= SCORE.tarInGzip) return 'container';
  if (score >= SCORE.jsonPrefix) return 'content';
  return 'signature';
}
