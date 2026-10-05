/**
 * Ghostscript adapter: PDF compression, PDF → PostScript, and PostScript/EPS/Illustrator to
 * PDF or images.
 *
 * Always runs with `-dSAFER` (no file access from PostScript beyond the input/output), inside
 * the process sandbox. Ghostscript is AGPL-licensed; it runs as a separate program and is
 * never linked into the application.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

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
  extensionOf,
  firstLine,
  num,
  numberedFiles,
  onlyInput,
  requireFile,
  runOptions,
} from '../util.ts';

const FAILURES: [RegExp, ErrorCode][] = [
  [/requires a password/i, 'password-protected'],
  [
    /Unrecoverable error|undefined in|syntaxerror|Couldn't initialise file|ioerror|typecheck|rangecheck/i,
    'input-corrupt',
  ],
];

/** `compressionLevel` → pdfwrite preset (image resolution 300 / 150 / 72 dpi). */
const PDF_SETTINGS: Record<string, string> = {
  low: '/printer',
  balanced: '/ebook',
  high: '/screen',
};

async function gs(ctx: EngineContext, args: string[]): Promise<void> {
  const result = await ctx.runner.run(
    ctx.binaries.ghostscript ?? 'gs',
    ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dNOPROMPT', '-dNOINTERPOLATE', ...args],
    runOptions(ctx),
  );
  assertSuccess(result, 'ghostscript', FAILURES);
}

async function compressPdf(
  input: EngineFile,
  options: Record<string, unknown>,
  out: string,
  ctx: EngineContext,
): Promise<void> {
  const preset =
    PDF_SETTINGS[
      typeof options.compressionLevel === 'string' ? options.compressionLevel : 'balanced'
    ] ?? '/ebook';
  const candidate = join(ctx.workDir, 'tmp', 'compressed.pdf');
  await gs(ctx, [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.6',
    `-dPDFSETTINGS=${preset}`,
    '-dDetectDuplicateImages=true',
    '-dAutoRotatePages=/None',
    `-sOutputFile=${candidate}`,
    input.path,
  ]);
  await requireFile(candidate, 'ghostscript');
  // Already-optimized files can grow; never hand back a larger file than the original.
  const [before, after] = await Promise.all([stat(input.path), stat(candidate)]);
  await copyFile(after.size < before.size ? candidate : input.path, out);
}

async function render(
  input: EngineFile,
  to: string,
  options: Record<string, unknown>,
  outDir: string,
  ctx: EngineContext,
): Promise<EngineOutput[]> {
  const eps = input.format === 'eps' ? ['-dEPSCrop'] : [];
  if (to === 'pdf' || to === 'ps') {
    const out = join(outDir, `document.${extensionOf(ctx, to)}`);
    await gs(ctx, [
      to === 'pdf' ? '-sDEVICE=pdfwrite' : '-sDEVICE=ps2write',
      '-dAutoRotatePages=/None',
      ...eps,
      `-sOutputFile=${out}`,
      input.path,
    ]);
    return [{ path: await requireFile(out, 'ghostscript'), format: to }];
  }
  const device =
    to === 'png'
      ? ['-sDEVICE=png16m']
      : to === 'jpg'
        ? ['-sDEVICE=jpeg', `-dJPEGQ=${num(options.quality, 85)}`]
        : to === 'tiff'
          ? ['-sDEVICE=tiff24nc', '-sCompression=lzw']
          : null;
  if (!device) {
    throw new VanillateError('conversion-unsupported', {
      detail: `ghostscript cannot write ${to}`,
    });
  }
  const dir = join(ctx.workDir, 'tmp', 'gs');
  await mkdir(dir, { recursive: true });
  const ext = extensionOf(ctx, to);
  await gs(ctx, [
    ...device,
    `-r${num(options.dpi, 150)}`,
    '-dTextAlphaBits=4',
    '-dGraphicsAlphaBits=4',
    ...eps,
    // PDF input stops early; PostScript ignores LastPage, so the count is checked after.
    `-dLastPage=${ctx.limits.maxPages + 1}`,
    `-sOutputFile=${join(dir, `page-%04d.${ext}`)}`,
    input.path,
  ]);
  const files = await numberedFiles(dir, new RegExp(`page-\\d+\\.${ext}$`));
  if (files.length === 0)
    throw new VanillateError('conversion-failed', { detail: 'no pages rendered' });
  if (files.length > ctx.limits.maxPages) {
    throw new VanillateError('too-many-pages', { detail: `${files.length} pages` });
  }
  const outputs: EngineOutput[] = [];
  for (const [i, file] of files.entries()) {
    const out = join(outDir, `page-${i + 1}.${ext}`);
    await copyFile(file, out);
    outputs.push({ path: out, format: to, part: { index: i + 1, total: files.length } });
  }
  return outputs;
}

async function probe(runner: ProcessRunner): Promise<EngineProbe> {
  try {
    const result = await runner.run('gs', ['--version'], {
      cwd: '/',
      timeoutMs: 10_000,
      writable: [],
    });
    if (result.exitCode === 0) {
      return {
        available: true,
        version: `Ghostscript ${firstLine(result.stdout) ?? ''}`.trim(),
        binary: 'gs',
      };
    }
  } catch {
    // not installed
  }
  return { available: false, version: null, binary: null };
}

async function run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]> {
  const input = onlyInput(request);
  const options = request.options as Record<string, unknown>;
  if (request.kind === 'operation') {
    if (request.operation !== 'compress-pdf') {
      throw new VanillateError('conversion-unsupported', {
        detail: `ghostscript ${request.operation}`,
      });
    }
    const out = join(request.outDir, 'output.pdf');
    await compressPdf(input, options, out, ctx);
    return [{ path: out, format: 'pdf' }];
  }
  return render(input, request.to, options, request.outDir, ctx);
}

export const ghostscript: ServerEngine = { id: 'ghostscript', probe, run };
