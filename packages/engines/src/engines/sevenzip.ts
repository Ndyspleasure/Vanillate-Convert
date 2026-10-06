/**
 * 7-Zip adapter: archive extraction, repacking and comic-book (CBZ) creation.
 *
 * Archives are untrusted in three ways, and each is checked twice — on the listing before
 * extraction and on the extracted tree afterwards:
 *   - paths: absolute paths, `..` segments, control characters and over-long names;
 *   - links and special files: symbolic/hard links, devices and FIFOs are refused;
 *   - size: entry count, total expanded size and compression ratio ("zip bombs"). A watchdog
 *     also measures the output while 7-Zip runs, because headers can lie about sizes.
 */
import { copyFile, lstat, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { VanillateError, type ErrorCode } from '@vanillate/core';

import type {
  EngineContext,
  EngineFile,
  EngineOutput,
  EngineProbe,
  EngineRequest,
  ProcessRunner,
  ServerEngine,
} from '../types.ts';
import {
  assertSuccess,
  ensureDir,
  firstLine,
  onlyInput,
  requireFile,
  runOptions,
  scratchDir,
} from '../util.ts';

/** Ratio checks start above this expanded size (small archives compress text very well). */
const RATIO_THRESHOLD_BYTES = 100 * 1024 * 1024;
/** Placeholder password: encrypted archives fail fast instead of prompting. */
const NO_PASSWORD = '-p_vanillate_no_password_';
/** Formats that are a compressed TAR: 7-Zip unpacks one layer at a time. */
const TAR_LAYERED = new Set(['tgz', 'tbz2', 'txz']);

const FAILURES: [RegExp, ErrorCode][] = [
  [/Wrong password|encrypted|Can not open encrypted archive/i, 'password-protected'],
  [
    /Can not open the file as archive|Unexpected end of archive|Data Error|CRC Failed|Headers Error|is not archive/i,
    'input-corrupt',
  ],
];

export interface ArchiveEntry {
  path: string;
  folder: boolean;
  size: number;
  encrypted: boolean;
  /** Symbolic/hard link or special file. */
  unsafeType: boolean;
}

/** Parses `7z l -slt -ba` output (blank-line separated `Key = Value` blocks). */
export function parseListing(text: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const fields = new Map<string, string>();
    for (const line of block.split(/\r?\n/)) {
      const eq = line.indexOf(' = ');
      if (eq > 0) fields.set(line.slice(0, eq), line.slice(eq + 3));
      else if (line.endsWith(' =')) fields.set(line.slice(0, -2), '');
    }
    const path = fields.get('Path');
    if (path === undefined) continue;
    const mode = fields.get('Mode') ?? '';
    const attributes = fields.get('Attributes') ?? '';
    const unixMode = /\s([-dlcbps])[-rwxsStT]{9}\b/.exec(` ${attributes}`)?.[1] ?? mode.charAt(0);
    entries.push({
      path,
      folder: fields.get('Folder') === '+' || unixMode === 'd' || /^D/.test(attributes),
      size: Number(fields.get('Size') || 0) || 0,
      encrypted: fields.get('Encrypted') === '+',
      unsafeType:
        Boolean(fields.get('Symbolic Link')) ||
        Boolean(fields.get('Hard Link')) ||
        ['l', 'c', 'b', 'p', 's'].includes(unixMode),
    });
  }
  return entries;
}

/** Normalized relative path, or an error for traversal and control characters. */
export function safeEntryPath(raw: string, maxLength: number): string {
  const segments: string[] = [];
  const path = raw
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:\//, '')
    .replace(/^\/+/, '');
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    // eslint-disable-next-line no-control-regex
    if (segment === '..' || /[\u0000-\u001f]/.test(segment)) {
      throw new VanillateError('archive-unsafe', { detail: `entry "${raw}"` });
    }
    segments.push(segment);
  }
  const normalized = segments.join('/');
  if (normalized.length > maxLength) {
    throw new VanillateError('archive-unsafe', { detail: 'entry path too long' });
  }
  return normalized;
}

export function checkListing(
  entries: readonly ArchiveEntry[],
  archiveSize: number,
  ctx: EngineContext,
): void {
  const { maxEntries, maxExtractedBytes, maxCompressionRatio, maxPathLength } = ctx.limits.archive;
  let files = 0;
  let total = 0;
  for (const entry of entries) {
    if (entry.encrypted) throw new VanillateError('password-protected');
    if (entry.unsafeType)
      throw new VanillateError('archive-unsafe', {
        detail: `link or special file "${entry.path}"`,
      });
    safeEntryPath(entry.path, maxPathLength);
    if (entry.folder) continue;
    files += 1;
    total += entry.size;
  }
  if (files > maxEntries)
    throw new VanillateError('archive-too-large', { detail: `${files} entries` });
  if (total > maxExtractedBytes)
    throw new VanillateError('archive-too-large', { detail: `${total} bytes` });
  if (total > RATIO_THRESHOLD_BYTES && total / Math.max(1, archiveSize) > maxCompressionRatio) {
    throw new VanillateError('archive-too-large', {
      detail: `ratio ${Math.round(total / archiveSize)}:1`,
    });
  }
}

interface TreeFile {
  path: string;
  relative: string;
  size: number;
}

/** Walks an extracted tree; refuses links and special files. */
async function walk(root: string, ctx: EngineContext): Promise<TreeFile[]> {
  const { maxEntries, maxExtractedBytes, maxPathLength } = ctx.limits.archive;
  const files: TreeFile[] = [];
  let total = 0;
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const info = await lstat(path);
      if (info.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!info.isFile() || info.nlink > 1) {
        throw new VanillateError('archive-unsafe', { detail: `special entry ${entry.name}` });
      }
      total += info.size;
      files.push({
        path,
        relative: safeEntryPath(relative(root, path), maxPathLength),
        size: info.size,
      });
      if (files.length > maxEntries || total > maxExtractedBytes) {
        throw new VanillateError('archive-too-large', { detail: 'extracted tree over limits' });
      }
    }
  };
  await visit(root);
  return files.sort((a, b) => a.relative.localeCompare(b.relative, 'en', { numeric: true }));
}

/** Bytes currently under `dir` (best effort; used by the extraction watchdog). */
async function treeSize(dir: string): Promise<number> {
  let total = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) continue;
      try {
        total += (await lstat(join(entry.parentPath, entry.name))).size;
      } catch {
        // removed while measuring
      }
    }
  } catch {
    // directory not created yet
  }
  return total;
}

function binary(ctx: EngineContext): string {
  return ctx.binaries.sevenzip ?? '7zz';
}

async function list(archive: string, ctx: EngineContext): Promise<ArchiveEntry[]> {
  const result = await ctx.runner.run(
    binary(ctx),
    ['l', '-slt', '-ba', NO_PASSWORD, '--', archive],
    { ...runOptions(ctx), stdoutLimit: 64 * 1024 * 1024 },
  );
  assertSuccess(result, '7-zip', FAILURES);
  return parseListing(result.stdout);
}

/** Lists, checks and extracts one archive layer into `dir`; returns the extracted files. */
async function extractLayer(
  archive: string,
  size: number,
  dir: string,
  ctx: EngineContext,
): Promise<TreeFile[]> {
  checkListing(await list(archive, ctx), size, ctx);
  await ensureDir(ctx, dir);
  const limit = ctx.limits.archive.maxExtractedBytes;
  const watchdog = new AbortController();
  let exceeded = false;
  const timer = setInterval(() => {
    void treeSize(dir).then((bytes) => {
      if (bytes > limit && !exceeded) {
        exceeded = true;
        watchdog.abort();
      }
    });
  }, 200);
  try {
    const result = await ctx.runner.run(
      binary(ctx),
      ['x', '-y', '-bd', '-bb0', NO_PASSWORD, `-o${dir}`, '--', archive],
      runOptions(ctx, {
        signal: AbortSignal.any([ctx.signal, watchdog.signal]),
        // No single extracted file may exceed the total budget.
        fileSizeLimit: limit + 1,
      }),
    );
    // The size budget is checked first: a bomb often also ends in a CRC or size error.
    if (exceeded || result.signal === 'SIGXFSZ' || (await treeSize(dir)) > limit) {
      throw new VanillateError('archive-too-large', { detail: 'expanded beyond the limit' });
    }
    assertSuccess(result, '7-zip', FAILURES);
  } finally {
    clearInterval(timer);
  }
  return walk(dir, ctx);
}

/** Fully extracts an archive, unwrapping compressed TARs (`.tar.gz` → `.tar` → files). */
async function extractAll(
  input: EngineFile,
  ctx: EngineContext,
): Promise<{ root: string; files: TreeFile[] }> {
  const root = await scratchDir(ctx, 'extract');
  const files = await extractLayer(input.path, input.size, root, ctx);
  ctx.progress(0.4);
  const [only] = files;
  if (
    TAR_LAYERED.has(input.format) &&
    files.length === 1 &&
    only &&
    /\.tar$/i.test(only.relative)
  ) {
    const inner = await scratchDir(ctx, 'extract-tar');
    return { root: inner, files: await extractLayer(only.path, only.size, inner, ctx) };
  }
  return { root, files };
}

const CREATE_TYPES: Record<string, string[]> = {
  zip: ['-tzip', '-mx=5'],
  cbz: ['-tzip', '-mx=0'],
  '7z': ['-t7z', '-mx=5'],
  tar: ['-ttar'],
};
const COMPRESSED_TAR: Record<string, string> = { tgz: '-tgzip', tbz2: '-tbzip2', txz: '-txz' };

async function create(root: string, to: string, out: string, ctx: EngineContext): Promise<void> {
  const make = async (
    type: string[],
    target: string,
    inputs: string[],
    cwd: string,
  ): Promise<void> => {
    const result = await ctx.runner.run(
      binary(ctx),
      ['a', '-bd', '-bb0', '-y', ...type, '--', target, ...inputs],
      runOptions(ctx, { cwd }),
    );
    assertSuccess(result, '7-zip', FAILURES);
  };
  const compressed = COMPRESSED_TAR[to];
  if (compressed) {
    const dir = await scratchDir(ctx, 'repack');
    const tar = join(dir, 'archive.tar');
    await make(['-ttar'], tar, ['*'], root);
    await make([compressed, '-mx=5'], out, [tar], dir);
  } else {
    const type = CREATE_TYPES[to];
    if (!type)
      throw new VanillateError('conversion-unsupported', { detail: `7-zip cannot write ${to}` });
    await make(type, out, ['*'], root);
  }
  await requireFile(out, '7-zip');
}

async function probe(runner: ProcessRunner): Promise<EngineProbe> {
  for (const name of ['7zz', '7z']) {
    try {
      const result = await runner.run(name, ['i'], { cwd: '/', timeoutMs: 10_000, writable: [] });
      if (result.exitCode === 0 && /7-Zip/i.test(result.stdout)) {
        return { available: true, version: firstLine(result.stdout), binary: name };
      }
    } catch {
      // try the next binary
    }
  }
  return { available: false, version: null, binary: null };
}

async function run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]> {
  const input = onlyInput(request);
  const { root, files } = await extractAll(input, ctx);
  if (files.length === 0)
    throw new VanillateError('input-corrupt', { detail: 'archive has no files' });
  if (request.kind === 'operation') {
    if (request.operation !== 'extract') {
      throw new VanillateError('conversion-unsupported', { detail: `7-zip ${request.operation}` });
    }
    const outputs: EngineOutput[] = [];
    for (const [i, file] of files.entries()) {
      const out = join(request.outDir, `entry-${i + 1}`);
      await copyFile(file.path, out);
      outputs.push({
        path: out,
        format: null,
        entryPath: file.relative,
        part: { index: i + 1, total: files.length },
      });
    }
    return outputs;
  }
  const ext = ctx.registry.requireFormat(request.to).extensions[0] ?? request.to;
  const out = join(request.outDir, `archive.${ext}`);
  ctx.progress(0.6);
  await create(root, request.to, out, ctx);
  return [{ path: out, format: request.to }];
}

export const sevenzip: ServerEngine = { id: 'sevenzip', probe, run };
