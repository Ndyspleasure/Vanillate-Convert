/**
 * Shared helpers for engine adapters.
 */
import { chown, mkdir, mkdtemp, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parsePageRange, VanillateError, type ErrorCode } from '@vanillate/core';

import type { RunOptions, RunResult } from './runner.ts';
import type { EngineContext, EngineFile, EngineRequest } from './types.ts';

/** Default run options for an engine invocation inside the job directory. */
export function runOptions(ctx: EngineContext, extra: Partial<RunOptions> = {}): RunOptions {
  const remaining = Math.max(1000, ctx.deadline - Date.now());
  return {
    cwd: ctx.workDir,
    homeDir: join(ctx.workDir, 'home'),
    tmpDir: join(ctx.workDir, 'tmp'),
    timeoutMs: remaining,
    signal: ctx.signal,
    writable: [ctx.workDir],
    cpuSeconds: Math.ceil(remaining / 1000) * 2 + 10,
    fileSizeLimit: Math.max(ctx.limits.maxOutputBytes * 2, 64 * 1024 * 1024),
    ...extra,
  };
}

/** Turns a failed run into a typed error (timeouts and cancellation are recognized). */
export function assertSuccess(
  result: RunResult,
  engine: string,
  patterns: [RegExp, ErrorCode][] = [],
): void {
  if (result.aborted) throw new DOMException('cancelled', 'AbortError');
  if (result.timedOut)
    throw new VanillateError('conversion-timeout', { detail: `${engine} timed out` });
  if (result.exitCode === 0 && result.signal === null) return;
  const text = `${result.stderr}\n${result.stdout}`;
  for (const [pattern, code] of patterns) {
    if (pattern.test(text))
      throw new VanillateError(code, { detail: `${engine}: ${result.stderr.slice(-2000)}` });
  }
  if (result.signal === 'SIGXFSZ' || /File size limit exceeded/i.test(text)) {
    throw new VanillateError('output-too-large', { detail: `${engine} hit the file size limit` });
  }
  if (result.signal === 'SIGXCPU' || result.signal === 'SIGKILL') {
    throw new VanillateError('conversion-timeout', {
      detail: `${engine} was killed (${result.signal})`,
    });
  }
  // Some tools (7-Zip) report errors on stdout; keep the tail of both for diagnostics.
  const output = result.stderr.trim() || result.stdout.trim();
  throw new VanillateError('conversion-failed', {
    detail: `${engine} exited with ${result.exitCode ?? result.signal}: ${output.slice(-2000)}`,
  });
}

export async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => join(dir, e.name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export async function requireFile(path: string, engine: string): Promise<string> {
  try {
    const info = await stat(path);
    if (info.isFile() && info.size > 0) return path;
  } catch {
    // fall through
  }
  throw new VanillateError('conversion-failed', { detail: `${engine} produced no output` });
}

export function onlyInput(request: EngineRequest): EngineFile {
  const [input] = request.inputs;
  if (!input || request.inputs.length !== 1)
    throw new VanillateError('bad-request', { detail: 'expected one input' });
  return input;
}

export function extensionOf(ctx: EngineContext, formatId: string): string {
  return ctx.registry.requireFormat(formatId).extensions[0] ?? 'bin';
}

export function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Runs `binary --version`-style probes and returns the first line. */
export function firstLine(text: string): string | null {
  return (
    text
      .split(/\r?\n/)
      .find((line) => line.trim() !== '')
      ?.trim()
      .slice(0, 200) ?? null
  );
}

/** Groups sorted page numbers into contiguous runs: `[1,2,3,5]` → `[[1,3],[5,5]]`. */
export function pageRuns(pages: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const page of pages) {
    const last = runs.at(-1);
    if (last && page === last[1] + 1) last[1] = page;
    else runs.push([page, page]);
  }
  return runs;
}

/** qpdf-style range text: `[1,2,3,5]` → `1-3,5`. */
export function rangeText(pages: readonly number[]): string {
  return pageRuns(pages)
    .map(([a, b]) => (a === b ? String(a) : `${a}-${b}`))
    .join(',');
}

/**
 * Pages selected by the `pageRange` option (all pages when empty), enforcing the page limit.
 */
export function selectedPages(option: unknown, pageCount: number, maxPages: number): number[] {
  if (pageCount < 1) throw new VanillateError('input-corrupt', { detail: 'document has no pages' });
  const text = typeof option === 'string' ? option.trim() : '';
  const pages =
    text === ''
      ? Array.from({ length: pageCount }, (_, i) => i + 1)
      : parsePageRange(text, pageCount);
  if (!pages || pages.length === 0) throw new VanillateError('page-range-invalid');
  if (pages.length > maxPages) {
    throw new VanillateError('too-many-pages', { detail: `${pages.length} > ${maxPages}` });
  }
  return pages;
}

/** Path of a sibling executable, e.g. `/opt/x/bin/ffmpeg` → `/opt/x/bin/ffprobe`. */
export function sibling(binary: string, name: string): string {
  const slash = binary.lastIndexOf('/');
  return slash >= 0 ? `${binary.slice(0, slash + 1)}${name}` : name;
}

/** Output files of a multi-file run, ordered by the number in their name. */
export async function numberedFiles(dir: string, pattern: RegExp): Promise<string[]> {
  const files = (await listFiles(dir)).filter((file) => pattern.test(file));
  const number = (file: string): number => Number(/(\d+)(?=\.[^.]+$)/.exec(file)?.[1] ?? 0);
  return files.sort((a, b) => number(a) - number(b));
}

/** Gives a path to the engine user (when engines run as a separate user). */
export async function grant(ctx: EngineContext, path: string): Promise<void> {
  const user = ctx.runner.user;
  if (user) await chown(path, user.uid, user.gid);
}

/** Creates a directory (and missing parents) that engine processes can write to. */
export async function ensureDir(ctx: EngineContext, path: string): Promise<string> {
  const first = await mkdir(path, { recursive: true });
  if (first !== undefined && ctx.runner.user) {
    const created: string[] = [];
    for (let dir = path; dir.length >= first.length; dir = dirname(dir)) {
      created.push(dir);
      if (dir === first) break;
    }
    for (const dir of created.reverse()) await grant(ctx, dir);
  }
  return path;
}

/**
 * A fresh, empty directory for one engine run inside the job's temporary directory. Never
 * reuse fixed names: a job converting several files would otherwise mix their leftovers.
 */
export async function scratchDir(ctx: EngineContext, prefix: string): Promise<string> {
  const base = await ensureDir(ctx, join(ctx.workDir, 'tmp'));
  const dir = await mkdtemp(join(base, `${prefix}-`));
  await grant(ctx, dir);
  return dir;
}
