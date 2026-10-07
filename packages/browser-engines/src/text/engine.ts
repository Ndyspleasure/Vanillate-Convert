/**
 * Text utilities: Base64, URL encoding and file inspection.
 */
import {
  decodeText,
  detectFormat,
  fileStem,
  outputFilename,
  sha256Hex,
  VanillateError,
  type Registry,
} from '@vanillate/core';

import type { BrowserEngine, BrowserInputFile, BrowserOutputFile, TaskContext } from '../types.ts';
import { encodeUtf8, knownExtensions, onlyInput, readText } from '../util.ts';

const BASE64_CHARS = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64URL_CHARS = /^[A-Za-z0-9_-]*={0,2}$/;
const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array, variant: 'standard' | 'url' = 'standard'): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);
  return variant === 'url'
    ? base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    : base64;
}

/** Decodes Base64 or Base64URL text, optionally wrapped in a data URI. Whitespace is ignored. */
export function base64ToBytes(text: string): { bytes: Uint8Array; mimeType: string | null } {
  let body = text.trim();
  let mimeType: string | null = null;
  const dataUri = /^data:([^;,]*)(?:;[^,]*)?;base64,/i.exec(body);
  if (dataUri) {
    mimeType = dataUri[1] || null;
    body = body.slice(dataUri[0].length);
  }
  body = body.replace(/\s+/g, '');
  const isUrl = /[-_]/.test(body);
  if (!(isUrl ? BASE64URL_CHARS : BASE64_CHARS).test(body)) throw new Error('not valid Base64');
  let standard = isUrl ? body.replace(/-/g, '+').replace(/_/g, '/') : body;
  standard = standard.replace(/=+$/, '');
  if (standard.length % 4 === 1) throw new Error('Base64 has an invalid length');
  standard += '='.repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(standard);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mimeType };
}

function lenientUrlDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    // Decode valid percent sequences one by one and leave malformed ones as they are.
    return text.replace(/(%[0-9A-Fa-f]{2})+/g, (sequence) => {
      try {
        return decodeURIComponent(sequence);
      } catch {
        return sequence;
      }
    });
  }
}

function named(
  registry: Registry,
  input: BrowserInputFile,
  formatId: string,
  bytes: Uint8Array,
  suffix = '',
): BrowserOutputFile {
  const format = registry.requireFormat(formatId);
  const stem = fileStem(input.name, knownExtensions(registry));
  return {
    name: outputFilename(`${stem}${suffix}.x`, format),
    bytes,
    format: format.id,
    mimeType: format.mimeTypes[0] ?? 'text/plain',
  };
}

async function inspect(input: BrowserInputFile, ctx: TaskContext): Promise<BrowserOutputFile> {
  const head = input.bytes.subarray(0, 65536);
  const tail = input.bytes.subarray(Math.max(0, input.bytes.length - 65536));
  const detection = detectFormat(
    { name: input.name, size: input.bytes.length, head, tail },
    ctx.registry,
  );
  ctx.progress(0.3);
  const report = {
    name: input.name,
    size: input.bytes.length,
    sha256: await sha256Hex(input.bytes),
    detected: detection.format
      ? {
          format: detection.format.id,
          name: detection.format.name.en,
          category: detection.format.category,
          mimeType: detection.format.mimeTypes[0],
          confidence: detection.confidence,
          evidence: detection.evidence,
        }
      : null,
    extension: detection.extension,
    extensionMatches: detection.extensionMismatch === null,
    text: detection.isText
      ? { encoding: decodeText(head, { truncated: input.bytes.length > head.length }).encoding }
      : null,
  };
  return named(
    ctx.registry,
    input,
    'json',
    encodeUtf8(`${JSON.stringify(report, null, 2)}\n`),
    '-info',
  );
}

export const textEngine: BrowserEngine = async (task, ctx) => {
  if (task.kind !== 'tool')
    throw new VanillateError('conversion-unsupported', { detail: 'text engine runs tools only' });
  const input = onlyInput(task.inputs);
  switch (task.operation) {
    case 'base64-encode': {
      const variant = task.options.base64Variant === 'url' ? 'url' : 'standard';
      let encoded = bytesToBase64(input.bytes, variant);
      if (task.options.base64DataUri === true) {
        const mime = ctx.registry.format(input.format)?.mimeTypes[0] ?? 'application/octet-stream';
        encoded = `data:${mime};base64,${variant === 'url' ? bytesToBase64(input.bytes) : encoded}`;
      }
      return [named(ctx.registry, input, 'base64', encodeUtf8(`${encoded}\n`))];
    }
    case 'base64-decode': {
      let decoded: { bytes: Uint8Array; mimeType: string | null };
      try {
        decoded = base64ToBytes(readText(input));
      } catch (error) {
        throw new VanillateError('input-corrupt', { detail: (error as Error).message });
      }
      if (decoded.bytes.length === 0) throw new VanillateError('file-empty');
      const detection = detectFormat(
        {
          size: decoded.bytes.length,
          head: decoded.bytes.subarray(0, 65536),
          tail: decoded.bytes.subarray(Math.max(0, decoded.bytes.length - 65536)),
          mimeType: decoded.mimeType,
        },
        ctx.registry,
      );
      const formatId = detection.format?.id ?? (detection.isText ? 'txt' : 'bin');
      return [named(ctx.registry, input, formatId, decoded.bytes, '-decoded')];
    }
    case 'url-encode': {
      const text = readText(input);
      const encoded = task.options.urlMode === 'uri' ? encodeURI(text) : encodeURIComponent(text);
      return [{ ...named(ctx.registry, input, 'txt', encodeUtf8(encoded), '-encoded') }];
    }
    case 'url-decode':
      return [
        named(
          ctx.registry,
          input,
          'txt',
          encodeUtf8(lenientUrlDecode(readText(input))),
          '-decoded',
        ),
      ];
    case 'inspect':
      return [await inspect(input, ctx)];
    default:
      throw new VanillateError('conversion-unsupported', { detail: task.operation });
  }
};
