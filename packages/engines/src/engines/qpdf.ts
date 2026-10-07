/**
 * qpdf adapter: merge, split, page extraction and rotation. Structure-preserving: pages are
 * copied, never re-rendered, so quality and text are unchanged.
 */
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
  firstLine,
  numberedFiles,
  onlyInput,
  rangeText,
  requireFile,
  runOptions,
  scratchDir,
  selectedPages,
} from '../util.ts';

const FAILURES: [RegExp, ErrorCode][] = [
  [/invalid password/i, 'password-protected'],
  [/not a PDF file|unable to find trailer|can't find PDF header|file is damaged/i, 'input-corrupt'],
];

async function qpdf(ctx: EngineContext, args: string[]): Promise<string> {
  const result = await ctx.runner.run(
    ctx.binaries.qpdf ?? 'qpdf',
    ['--warning-exit-0', '--no-warn', ...args],
    runOptions(ctx),
  );
  assertSuccess(result, 'qpdf', FAILURES);
  return result.stdout;
}

async function pageCount(ctx: EngineContext, input: EngineFile): Promise<number> {
  const count = Number((await qpdf(ctx, ['--show-npages', input.path])).trim());
  if (!Number.isInteger(count) || count < 1) {
    throw new VanillateError('input-corrupt', { detail: 'qpdf reported no pages' });
  }
  return count;
}

async function merge(
  inputs: readonly EngineFile[],
  out: string,
  ctx: EngineContext,
): Promise<void> {
  if (inputs.length < 2)
    throw new VanillateError('bad-request', { detail: 'merge needs two or more PDFs' });
  let total = 0;
  for (const input of inputs) total += await pageCount(ctx, input);
  if (total > ctx.limits.maxPages) {
    throw new VanillateError('too-many-pages', { detail: `${total} pages` });
  }
  const [first, ...rest] = inputs as [EngineFile, ...EngineFile[]];
  await qpdf(ctx, [first.path, '--pages', '.', ...rest.map((f) => f.path), '--', out]);
}

async function run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]> {
  if (request.kind !== 'operation') {
    throw new VanillateError('conversion-unsupported', { detail: 'qpdf has no conversions' });
  }
  const options = request.options as Record<string, unknown>;
  const out = join(request.outDir, 'output.pdf');
  switch (request.operation) {
    case 'merge':
      await merge(request.inputs, out, ctx);
      return [{ path: await requireFile(out, 'qpdf'), format: 'pdf' }];
    case 'select-pages': {
      const input = onlyInput(request);
      if (typeof options.pageRange !== 'string' || options.pageRange.trim() === '') {
        throw new VanillateError('page-range-invalid', { detail: 'no pages selected' });
      }
      const pages = selectedPages(
        options.pageRange,
        await pageCount(ctx, input),
        ctx.limits.maxPages,
      );
      await qpdf(ctx, [input.path, '--pages', '.', rangeText(pages), '--', out]);
      return [{ path: await requireFile(out, 'qpdf'), format: 'pdf' }];
    }
    case 'rotate': {
      const input = onlyInput(request);
      const count = await pageCount(ctx, input);
      const pages = selectedPages(options.pageRange, count, Math.max(count, ctx.limits.maxPages));
      const angle = [90, 180, 270].includes(Number(options.rotate)) ? Number(options.rotate) : 90;
      await qpdf(ctx, [input.path, out, `--rotate=+${angle}:${rangeText(pages)}`]);
      return [{ path: await requireFile(out, 'qpdf'), format: 'pdf' }];
    }
    case 'split': {
      const input = onlyInput(request);
      const pages = selectedPages(
        options.pageRange,
        await pageCount(ctx, input),
        ctx.limits.maxPages,
      );
      const dir = await scratchDir(ctx, 'split');
      await qpdf(ctx, [
        input.path,
        '--pages',
        '.',
        rangeText(pages),
        '--',
        '--split-pages',
        join(dir, 'part-%d.pdf'),
      ]);
      const files = await numberedFiles(dir, /part-\d+\.pdf$/);
      if (files.length !== pages.length) {
        throw new VanillateError('conversion-failed', {
          detail: `split wrote ${files.length} files`,
        });
      }
      return files.map((path, i) => ({
        path,
        format: 'pdf',
        part: { index: i + 1, total: files.length },
        label: `page-${pages[i] ?? i + 1}`,
      }));
    }
    default:
      throw new VanillateError('conversion-unsupported', { detail: `qpdf ${request.operation}` });
  }
}

async function probe(runner: ProcessRunner): Promise<EngineProbe> {
  try {
    const result = await runner.run('qpdf', ['--version'], {
      cwd: '/',
      timeoutMs: 10_000,
      writable: [],
    });
    if (result.exitCode === 0)
      return { available: true, version: firstLine(result.stdout), binary: 'qpdf' };
  } catch {
    // not installed
  }
  return { available: false, version: null, binary: null };
}

export const qpdfEngine: ServerEngine = { id: 'qpdf', probe, run };
