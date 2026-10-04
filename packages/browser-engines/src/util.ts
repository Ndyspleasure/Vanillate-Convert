import { decodeText, outputFilename, VanillateError, type Registry } from '@vanillate/core';

import type { BrowserInputFile, BrowserOutputFile } from './types.ts';

const encoder = new TextEncoder();

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Decodes a text input (BOM, UTF-16 and Windows-1252 aware) and strips the BOM. */
export function readText(file: BrowserInputFile): string {
  const { text } = decodeText(file.bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function knownExtensions(registry: Registry): string[] {
  return registry.formats.flatMap((f) => f.extensions);
}

/** Builds an output file for `format`, named after the input. */
export function makeOutput(
  registry: Registry,
  input: Pick<BrowserInputFile, 'name'>,
  formatId: string,
  bytes: Uint8Array,
  part?: { index: number; total: number },
): BrowserOutputFile {
  const format = registry.requireFormat(formatId);
  return {
    name: outputFilename(input.name, format, part, knownExtensions(registry)),
    bytes,
    format: format.id,
    mimeType: format.mimeTypes[0] ?? 'application/octet-stream',
  };
}

export function textOutput(
  registry: Registry,
  input: Pick<BrowserInputFile, 'name'>,
  formatId: string,
  text: string,
): BrowserOutputFile {
  return makeOutput(registry, input, formatId, encodeUtf8(text));
}

/** Wraps parser failures in a user-facing error while keeping the detail for logs. */
export function corrupt(error: unknown, fields?: Record<string, string>): VanillateError {
  if (error instanceof VanillateError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new VanillateError('input-corrupt', {
    detail,
    ...(fields ? { fields } : {}),
    cause: error,
  });
}

export function onlyInput(inputs: readonly BrowserInputFile[]): BrowserInputFile {
  const [input] = inputs;
  if (!input || inputs.length !== 1)
    throw new VanillateError('bad-request', { detail: 'expected exactly one input' });
  return input;
}

/** Line and column (1-based) of a character offset, for helpful parse errors. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}
