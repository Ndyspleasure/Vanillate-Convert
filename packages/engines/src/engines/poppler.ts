/**
 * Poppler adapter: PDF (and PDF-compatible Illustrator files) to images, SVG, text and HTML.
 *
 * The page count, page sizes and encryption are read with `pdfinfo` first, so page limits,
 * rendered pixel limits and password protection are reported before rendering starts.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  pageRuns,
  requireFile,
  runOptions,
  selectedPages,
  sibling,
} from '../util.ts';

const FAILURES: [RegExp, ErrorCode][] = [
  [/Incorrect password|password/i, 'password-protected'],
  [
    /May not be a PDF file|Couldn't find trailer|Couldn't read xref|PDF file is damaged/i,
    'input-corrupt',
  ],
];

export interface PdfInfo {
  pages: number;
  /** Page sizes in points, by page number (only for requested pages). */
  sizes: Map<number, { width: number; height: number }>;
}

export function parsePdfInfo(text: string): PdfInfo {
  const pages = Number(/^Pages:\s+(\d+)/m.exec(text)?.[1] ?? NaN);
  if (!Number.isInteger(pages)) {
    throw new VanillateError('input-corrupt', { detail: 'pdfinfo reported no page count' });
  }
  const sizes = new Map<number, { width: number; height: number }>();
  for (const match of text.matchAll(/^Page\s+(\d+)\s+size:\s+([\d.]+) x ([\d.]+) pts/gm)) {
    sizes.set(Number(match[1]), { width: Number(match[2]), height: Number(match[3]) });
  }
  return { pages, sizes };
}

function bin(ctx: EngineContext, name: string): string {
  return sibling(ctx.binaries.poppler ?? 'pdftoppm', name);
}

async function runPoppler(ctx: EngineContext, name: string, args: string[]): Promise<string> {
  const result = await ctx.runner.run(bin(ctx, name), args, runOptions(ctx));
  assertSuccess(result, `poppler ${name}`, FAILURES);
  return result.stdout;
}

/** Page count (and sizes for `first`..`last` when given). */
async function pdfInfo(
  ctx: EngineContext,
  path: string,
  range?: [number, number],
): Promise<PdfInfo> {
  const args = range ? ['-f', String(range[0]), '-l', String(range[1]), path] : [path];
  return parsePdfInfo(await runPoppler(ctx, 'pdfinfo', args));
}

/** A PDF holding exactly `pages` (the original when they are all pages, in order). */
async function selection(
  ctx: EngineContext,
  input: string,
  pages: readonly number[],
  pageCount: number,
): Promise<string> {
  const runs = pageRuns(pages);
  if (runs.length === 1 && runs[0]?.[0] === 1 && runs[0][1] === pageCount) return input;
  const dir = join(ctx.workDir, 'tmp', 'pages');
  await mkdir(dir, { recursive: true });
  const parts: string[] = [];
  for (const page of pages) {
    const part = join(dir, `page-${page}.pdf`);
    await runPoppler(ctx, 'pdfseparate', ['-f', String(page), '-l', String(page), input, part]);
    parts.push(part);
  }
  if (parts.length === 1) return parts[0] ?? input;
  const merged = join(dir, 'selection.pdf');
  await runPoppler(ctx, 'pdfunite', [...parts, merged]);
  return merged;
}

async function rasterize(
  input: EngineFile,
  to: 'png' | 'jpg' | 'tiff',
  options: Record<string, unknown>,
  outDir: string,
  ctx: EngineContext,
): Promise<EngineOutput[]> {
  const { pages: count } = await pdfInfo(ctx, input.path);
  const pages = selectedPages(options.pageRange, count, ctx.limits.maxPages);
  const dpi = num(options.dpi, 150);
  const info = await pdfInfo(ctx, input.path, [pages[0] ?? 1, pages.at(-1) ?? 1]);
  for (const page of pages) {
    const size = info.sizes.get(page);
    if (size && (size.width / 72) * dpi * ((size.height / 72) * dpi) > ctx.limits.maxPixels) {
      throw new VanillateError('image-too-large', { detail: `page ${page} at ${dpi} dpi` });
    }
  }
  const format =
    to === 'png'
      ? ['-png']
      : to === 'jpg'
        ? ['-jpeg', '-jpegopt', `quality=${num(options.quality, 85)},optimize=y`]
        : ['-tiff', '-tiffcompression', 'deflate'];
  const dir = join(ctx.workDir, 'tmp', 'raster');
  await mkdir(dir, { recursive: true });
  const runs = pageRuns(pages);
  for (const [i, [first, last]] of runs.entries()) {
    await runPoppler(ctx, 'pdftoppm', [
      ...format,
      '-r',
      String(dpi),
      '-f',
      String(first),
      '-l',
      String(last),
      input.path,
      join(dir, 'page'),
    ]);
    ctx.progress(0.1 + (0.85 * (i + 1)) / runs.length);
  }
  const files = await numberedFiles(dir, /page-\d+\.(png|jpg|tif)$/);
  if (files.length !== pages.length) {
    throw new VanillateError('conversion-failed', {
      detail: `pdftoppm wrote ${files.length} of ${pages.length} pages`,
    });
  }
  const ext = extensionOf(ctx, to);
  const outputs: EngineOutput[] = [];
  for (const [i, file] of files.entries()) {
    const out = join(outDir, `page-${pages[i] ?? i + 1}.${ext}`);
    await copyFile(file, out);
    outputs.push({ path: out, format: to, part: { index: i + 1, total: files.length } });
  }
  return outputs;
}

async function toSvg(
  input: EngineFile,
  options: Record<string, unknown>,
  outDir: string,
  ctx: EngineContext,
): Promise<EngineOutput[]> {
  const { pages: count } = await pdfInfo(ctx, input.path);
  const pages = selectedPages(options.pageRange, count, ctx.limits.maxPages);
  const outputs: EngineOutput[] = [];
  for (const [i, page] of pages.entries()) {
    const out = join(outDir, `page-${page}.svg`);
    await runPoppler(ctx, 'pdftocairo', [
      '-svg',
      '-f',
      String(page),
      '-l',
      String(page),
      input.path,
      out,
    ]);
    outputs.push({
      path: await requireFile(out, 'pdftocairo'),
      format: 'svg',
      part: { index: i + 1, total: pages.length },
    });
    ctx.progress(0.1 + (0.85 * (i + 1)) / pages.length);
  }
  return outputs;
}

async function toText(
  input: EngineFile,
  options: Record<string, unknown>,
  out: string,
  ctx: EngineContext,
): Promise<void> {
  const { pages: count } = await pdfInfo(ctx, input.path);
  const pages = selectedPages(options.pageRange, count, ctx.limits.maxPages);
  const source = await selection(ctx, input.path, pages, count);
  await runPoppler(ctx, 'pdftotext', ['-enc', 'UTF-8', '-eol', 'unix', source, out]);
  await requireFile(out, 'pdftotext');
}

async function toHtml(
  input: EngineFile,
  options: Record<string, unknown>,
  out: string,
  ctx: EngineContext,
): Promise<void> {
  const { pages: count } = await pdfInfo(ctx, input.path);
  const pages = selectedPages(options.pageRange, count, ctx.limits.maxPages);
  const source = await selection(ctx, input.path, pages, count);
  const dir = join(ctx.workDir, 'tmp', 'html');
  await mkdir(dir, { recursive: true });
  // -s single document, -i no images (they would be separate files), -noframes one file.
  await runPoppler(ctx, 'pdftohtml', [
    '-s',
    '-i',
    '-noframes',
    '-q',
    '-enc',
    'UTF-8',
    source,
    join(dir, 'document'),
  ]);
  const html = await readFile(await requireFile(join(dir, 'document.html'), 'pdftohtml'));
  await writeFile(out, html);
}

async function probe(runner: ProcessRunner): Promise<EngineProbe> {
  try {
    const result = await runner.run('pdftoppm', ['-v'], {
      cwd: '/',
      timeoutMs: 10_000,
      writable: [],
    });
    const info = await runner.run('pdfinfo', ['-v'], { cwd: '/', timeoutMs: 10_000, writable: [] });
    if (result.exitCode === 0 && info.exitCode === 0) {
      return {
        available: true,
        version: firstLine(result.stderr || result.stdout),
        binary: 'pdftoppm',
      };
    }
  } catch {
    // not installed
  }
  return { available: false, version: null, binary: null };
}

async function run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]> {
  if (request.kind !== 'convert') {
    throw new VanillateError('conversion-unsupported', {
      detail: `poppler operation ${request.operation}`,
    });
  }
  const input = onlyInput(request);
  const options = request.options as Record<string, unknown>;
  switch (request.to) {
    case 'png':
    case 'jpg':
    case 'tiff':
      return rasterize(input, request.to, options, request.outDir, ctx);
    case 'svg':
      return toSvg(input, options, request.outDir, ctx);
    case 'txt': {
      const out = join(request.outDir, 'document.txt');
      await toText(input, options, out, ctx);
      return [{ path: out, format: 'txt' }];
    }
    case 'html': {
      const out = join(request.outDir, 'document.html');
      await toHtml(input, options, out, ctx);
      return [{ path: out, format: 'html' }];
    }
    default:
      throw new VanillateError('conversion-unsupported', {
        detail: `poppler cannot write ${request.to}`,
      });
  }
}

export const poppler: ServerEngine = { id: 'poppler', probe, run };
