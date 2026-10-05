/**
 * librsvg adapter (`rsvg-convert`): SVG to PNG, PDF, EPS and PS.
 *
 * librsvg never fetches network resources and only loads local files next to the SVG; the
 * sandbox leaves nothing else visible. Raster output size is computed from the SVG's declared
 * size first and capped, so a tiny file declaring a gigantic canvas cannot exhaust memory.
 */
import { open } from 'node:fs/promises';
import { join } from 'node:path';

import { decodeText, VanillateError, type ErrorCode } from '@vanillate/core';

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
  onlyInput,
  requireFile,
  runOptions,
} from '../util.ts';

const FAILURES: [RegExp, ErrorCode][] = [
  [/larger than \d+ pixels|cannot render to images bigger/i, 'image-too-large'],
  [/Error reading SVG|XML parse error|Error loading SVG|not well-formed/i, 'input-corrupt'],
];

/** Largest raster edge produced from an SVG. */
const MAX_EDGE = 16384;

const UNITS: Record<string, number> = {
  '': 1,
  px: 1,
  pt: 4 / 3,
  pc: 16,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
  em: 16,
  ex: 8,
};

function length(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^\s*([\d.]+(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(value);
  const unit = match ? UNITS[(match[2] ?? '').toLowerCase()] : undefined;
  const number = Number(match?.[1]);
  return unit !== undefined && Number.isFinite(number) && number > 0 ? number * unit : null;
}

/** Declared size of the root `<svg>` element in CSS pixels (width/height, else viewBox). */
export function svgSize(text: string): { width: number; height: number } | null {
  const tag = /<svg\b([^>]*)>/i.exec(text)?.[1];
  if (tag === undefined) return null;
  const attr = (name: string): string | undefined =>
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
      .exec(tag)
      ?.slice(1)
      .find((v) => v !== undefined);
  const viewBox = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const vbWidth = viewBox?.[2];
  const vbHeight = viewBox?.[3];
  let width = length(attr('width'));
  let height = length(attr('height'));
  if (vbWidth && vbHeight && vbWidth > 0 && vbHeight > 0) {
    if (width === null && height === null) {
      width = vbWidth;
      height = vbHeight;
    } else if (width === null && height !== null) {
      width = (height * vbWidth) / vbHeight;
    } else if (height === null && width !== null) {
      height = (width * vbHeight) / vbWidth;
    }
  }
  return width !== null && height !== null ? { width, height } : null;
}

/** Output size for raster targets: requested box (aspect kept), capped by edge and pixel limits. */
export function rasterSize(
  declared: { width: number; height: number } | null,
  requested: { width: number; height: number },
  maxPixels: number,
): { width: number; height: number } {
  const base = declared ?? { width: 512, height: 512 };
  let scale = 1;
  if (requested.width && requested.height) {
    scale = Math.min(requested.width / base.width, requested.height / base.height);
  } else if (requested.width) {
    scale = requested.width / base.width;
  } else if (requested.height) {
    scale = requested.height / base.height;
  }
  let width = base.width * scale;
  let height = base.height * scale;
  const shrink = Math.min(
    1,
    MAX_EDGE / width,
    MAX_EDGE / height,
    Math.sqrt(maxPixels / (width * height)),
  );
  width = Math.max(1, Math.floor(width * shrink));
  height = Math.max(1, Math.floor(height * shrink));
  return { width, height };
}

async function head(path: string): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const buffer = new Uint8Array(65536);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return decodeText(buffer.subarray(0, bytesRead), { truncated: true }).text;
  } finally {
    await handle.close();
  }
}

async function convert(
  input: EngineFile,
  to: string,
  options: Record<string, unknown>,
  out: string,
  ctx: EngineContext,
): Promise<void> {
  const format = { png: 'png', pdf: 'pdf', eps: 'eps', ps: 'ps' }[to];
  if (!format)
    throw new VanillateError('conversion-unsupported', { detail: `rsvg cannot write ${to}` });
  const size: string[] = [];
  if (to === 'png') {
    const { width, height } = rasterSize(
      svgSize(await head(input.path)),
      { width: num(options.width, 0), height: num(options.height, 0) },
      ctx.limits.maxPixels,
    );
    size.push('--width', String(width), '--height', String(height));
  } else if (num(options.width, 0) || num(options.height, 0)) {
    if (num(options.width, 0)) size.push('--width', String(num(options.width, 0)));
    if (num(options.height, 0)) size.push('--height', String(num(options.height, 0)));
  }
  const result = await ctx.runner.run(
    ctx.binaries.rsvg ?? 'rsvg-convert',
    ['--format', format, ...size, '--keep-aspect-ratio', '--output', out, input.path],
    runOptions(ctx),
  );
  assertSuccess(result, 'rsvg', FAILURES);
  await requireFile(out, 'rsvg');
}

async function probe(runner: ProcessRunner): Promise<EngineProbe> {
  try {
    const result = await runner.run('rsvg-convert', ['--version'], {
      cwd: '/',
      timeoutMs: 10_000,
      writable: [],
    });
    if (result.exitCode === 0)
      return { available: true, version: firstLine(result.stdout), binary: 'rsvg-convert' };
  } catch {
    // not installed
  }
  return { available: false, version: null, binary: null };
}

async function run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]> {
  if (request.kind !== 'convert') {
    throw new VanillateError('conversion-unsupported', { detail: `rsvg ${request.operation}` });
  }
  const input = onlyInput(request);
  const out = join(request.outDir, `output.${extensionOf(ctx, request.to)}`);
  await convert(input, request.to, request.options, out, ctx);
  return [{ path: out, format: request.to }];
}

export const rsvg: ServerEngine = { id: 'rsvg', probe, run };
