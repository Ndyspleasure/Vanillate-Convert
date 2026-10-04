/**
 * Browser archive engine: repack ZIP/TAR/TAR.GZ, extract ZIP/TAR/TAR.GZ/GZ and create ZIP.
 *
 * Safety: entry count, total extracted size, archive-wide compression ratio, path length and
 * traversal are checked; ZIP entries are only inflated after their declared sizes pass the
 * limits and fflate never writes past the declared size.
 */
import {
  detectFormat,
  fileStem,
  sanitizeFilename,
  VanillateError,
  type Registry,
} from '@vanillate/core';
import { unzipSync, zipSync, type Zippable } from 'fflate';

import type {
  BrowserEngine,
  BrowserInputFile,
  BrowserOutputFile,
  BrowserTask,
  TaskContext,
} from '../types.ts';
import { knownExtensions, makeOutput, onlyInput } from '../util.ts';
import { gunzip, gzip, gzipOriginalName, SizeLimitError } from './gzip.ts';
import { normalizeEntryPath, uniquePaths, UnsafeEntryError } from './paths.ts';
import { readTar, writeTar, type TarEntry } from './tar.ts';

/** Browsers hold everything in memory, so extraction is capped below the server limit. */
const BROWSER_EXTRACT_CAP = 512 * 1024 * 1024;
/** Archives that expand by more than this ratio are treated as archive bombs (above 100 MB). */
const RATIO_THRESHOLD_BYTES = 100 * 1024 * 1024;

interface Limits {
  maxEntries: number;
  maxBytes: number;
  maxRatio: number;
  maxPathLength: number;
}

function limitsFor(registry: Registry): Limits {
  const archive = registry.archiveLimits;
  return {
    maxEntries: archive.maxEntries,
    maxBytes: Math.min(archive.maxExtractedBytes, BROWSER_EXTRACT_CAP),
    maxRatio: archive.maxCompressionRatio,
    maxPathLength: archive.maxPathLength,
  };
}

const ZIP_LEVEL: Record<string, 0 | 1 | 6 | 9> = { store: 0, fast: 1, balanced: 6, max: 9 };

function checkRatio(compressed: number, expanded: number, limits: Limits): void {
  if (expanded > RATIO_THRESHOLD_BYTES && expanded / Math.max(1, compressed) > limits.maxRatio) {
    throw new VanillateError('archive-too-large', {
      detail: `ratio ${Math.round(expanded / compressed)}:1`,
    });
  }
}

function readZip(bytes: Uint8Array, limits: Limits): TarEntry[] {
  let declared = 0;
  let count = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      if (file.name.endsWith('/')) return false;
      count++;
      if (count > limits.maxEntries)
        throw new VanillateError('archive-too-large', { detail: 'too many entries' });
      declared += file.originalSize;
      if (declared > limits.maxBytes)
        throw new VanillateError('archive-too-large', { detail: 'declared size too large' });
      if (file.compression !== 0 && file.compression !== 8) {
        throw new VanillateError('conversion-failed', {
          detail: `unsupported ZIP compression ${file.compression}`,
        });
      }
      return true;
    },
  });
  checkRatio(bytes.length, declared, limits);
  return Object.entries(files).map(([path, data]) => ({ path, data }));
}

async function readEntries(input: BrowserInputFile, limits: Limits): Promise<TarEntry[]> {
  try {
    let raw: TarEntry[];
    switch (input.format) {
      case 'zip':
        raw = readZip(input.bytes, limits);
        break;
      case 'tar':
        raw = readTar(input.bytes, {
          maxEntries: limits.maxEntries,
          maxBytes: limits.maxBytes,
        }).entries;
        break;
      case 'tgz': {
        const tar = await gunzip(input.bytes, limits.maxBytes + 1024 * 1024);
        checkRatio(input.bytes.length, tar.length, limits);
        raw = readTar(tar, { maxEntries: limits.maxEntries, maxBytes: limits.maxBytes }).entries;
        break;
      }
      default:
        throw new VanillateError('conversion-unsupported', {
          detail: `cannot read ${input.format} archives`,
        });
    }
    const unique = uniquePaths();
    const out: TarEntry[] = [];
    for (const entry of raw) {
      const path = normalizeEntryPath(entry.path, limits.maxPathLength);
      if (path !== null) out.push({ path: unique(path), data: entry.data });
    }
    return out;
  } catch (error) {
    throw archiveError(error);
  }
}

function archiveError(error: unknown): VanillateError {
  if (error instanceof VanillateError) return error;
  if (error instanceof UnsafeEntryError)
    return new VanillateError('archive-unsafe', { detail: error.message });
  if (error instanceof SizeLimitError || error instanceof RangeError) {
    return new VanillateError('archive-too-large', { detail: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/encrypt/i.test(message))
    return new VanillateError('password-protected', { detail: message });
  return new VanillateError('input-corrupt', { detail: message, cause: error });
}

async function writeArchive(
  format: string,
  entries: readonly TarEntry[],
  level: 0 | 1 | 6 | 9,
): Promise<Uint8Array> {
  switch (format) {
    case 'zip': {
      const zippable: Zippable = {};
      for (const entry of entries) zippable[entry.path] = [entry.data, { level }];
      return zipSync(zippable, { mtime: new Date('2000-01-01T00:00:00Z') });
    }
    case 'tar':
      return writeTar(entries);
    case 'tgz':
      return gzip(writeTar(entries));
    default:
      throw new VanillateError('conversion-unsupported', {
        detail: `cannot write ${format} archives`,
      });
  }
}

function extractedOutput(registry: Registry, path: string, data: Uint8Array): BrowserOutputFile {
  const name = sanitizeFilename(path.split('/').pop());
  const detection = detectFormat(
    {
      name,
      size: data.length,
      head: data.subarray(0, 65536),
      tail: data.subarray(Math.max(0, data.length - 65536)),
    },
    registry,
  );
  const format = detection.format ?? registry.requireFormat(detection.isText ? 'txt' : 'bin');
  return {
    name,
    path,
    bytes: data,
    format: format.id,
    mimeType: format.mimeTypes[0] ?? 'application/octet-stream',
  };
}

async function extract(input: BrowserInputFile, ctx: TaskContext): Promise<BrowserOutputFile[]> {
  const limits = limitsFor(ctx.registry);
  if (input.format === 'gz') {
    let data: Uint8Array;
    try {
      data = await gunzip(input.bytes, limits.maxBytes);
      checkRatio(input.bytes.length, data.length, limits);
    } catch (error) {
      throw archiveError(error);
    }
    const original =
      gzipOriginalName(input.bytes) ?? fileStem(input.name, knownExtensions(ctx.registry));
    return [extractedOutput(ctx.registry, sanitizeFilename(original, 'file'), data)];
  }
  const entries = await readEntries(input, limits);
  if (entries.length === 0)
    throw new VanillateError('input-corrupt', { detail: 'archive contains no files' });
  return entries.map((entry, i) => {
    ctx.progress(0.5 + (0.5 * i) / entries.length);
    return extractedOutput(ctx.registry, entry.path, entry.data);
  });
}

async function convert(
  task: Extract<BrowserTask, { kind: 'conversion' }>,
  ctx: TaskContext,
): Promise<BrowserOutputFile[]> {
  const input = onlyInput(task.inputs);
  const entries = await readEntries({ ...input, format: task.from }, limitsFor(ctx.registry));
  ctx.progress(0.6);
  const level = ZIP_LEVEL[String(task.options.zipLevel ?? 'balanced')] ?? 6;
  return [makeOutput(ctx.registry, input, task.to, await writeArchive(task.to, entries, level))];
}

async function createZip(
  task: Extract<BrowserTask, { kind: 'tool' }>,
  ctx: TaskContext,
): Promise<BrowserOutputFile[]> {
  const unique = uniquePaths();
  const entries = task.inputs.map((input) => ({
    path: unique(sanitizeFilename(input.name)),
    data: input.bytes,
  }));
  const level = ZIP_LEVEL[String(task.options.zipLevel ?? 'balanced')] ?? 6;
  const first = task.inputs[0];
  const name = task.inputs.length === 1 && first ? first.name : 'files';
  return [makeOutput(ctx.registry, { name }, 'zip', await writeArchive('zip', entries, level))];
}

export const archiveEngine: BrowserEngine = async (task, ctx) => {
  if (task.kind === 'conversion') return convert(task, ctx);
  switch (task.operation) {
    case 'extract':
      return extract(onlyInput(task.inputs), ctx);
    case 'create-zip':
      return createZip(task, ctx);
    default:
      throw new VanillateError('conversion-unsupported', { detail: task.operation });
  }
};
