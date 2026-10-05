/**
 * ImageMagick adapter (IM7 `magick` or IM6 `convert`).
 *
 * Security: inputs are read with an explicit coder prefix (`PNG:/path`) so content sniffing
 * can never select a dangerous coder; the Vanillate policy disables delegates and script,
 * URL, PostScript, PDF and SVG coders; image size is checked from the header (`-ping`)
 * before any pixel is decoded; and resource limits apply to every command.
 * Privacy: EXIF orientation is applied, then every profile except ICC is removed.
 */
import { open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { icoSizes } from '@vanillate/browser-engines/ico';
import { buildPdf, compressRgba, type PdfImage } from '@vanillate/browser-engines/pdf';
import {
  readImageDimensions,
  readJpegInfo,
  VanillateError,
  type ErrorCode,
  type ImageDimensions,
} from '@vanillate/core';

import type {
  EngineContext,
  EngineFile,
  EngineOutput,
  EngineProbe,
  EngineRequest,
  ProcessRunner,
  ServerEngine,
} from '../types.ts';
import { assertSuccess, extensionOf, firstLine, num, runOptions, str } from '../util.ts';

export const POLICY_DIR = join(import.meta.dirname, '..', '..', 'config', 'imagemagick');

const CODERS: Record<string, string> = {
  jpg: 'JPEG',
  png: 'PNG',
  webp: 'WEBP',
  avif: 'AVIF',
  heic: 'HEIC',
  heif: 'HEIC',
  gif: 'GIF',
  bmp: 'BMP',
  tiff: 'TIFF',
  ico: 'ICO',
  jp2: 'JP2',
  tga: 'TGA',
  dds: 'DDS',
  hdr: 'HDR',
  psd: 'PSD',
  psb: 'PSB',
  xcf: 'XCF',
  dng: 'DNG',
  cr2: 'CR2',
  cr3: 'CR3',
  nef: 'NEF',
  arw: 'ARW',
  orf: 'ORF',
  rw2: 'RW2',
  raf: 'RAF',
  pef: 'PEF',
  srw: 'SRW',
  dicom: 'DCM',
  fits: 'FITS',
};

/** Targets that keep every frame/page; all others take the first frame. */
const MULTI_FRAME_TARGETS = new Set(['gif', 'tiff']);
/** Targets without an alpha channel. */
const OPAQUE_TARGETS = new Set(['jpg']);

const FAILURES: [RegExp, ErrorCode][] = [
  [
    /width or height exceeds limit|area exceeds|cache resources exhausted|exceeds limit|too large/i,
    'image-too-large',
  ],
  [
    /no decode delegate|improper image header|corrupt|unexpected end-of-file|insufficient image data|not a .* file|negative or zero image size|unable to read|decode/i,
    'input-corrupt',
  ],
];

async function probe(runner: ProcessRunner): Promise<EngineProbe> {
  for (const binary of ['magick', 'convert']) {
    try {
      const result = await runner.run(binary, ['-version'], {
        cwd: '/',
        timeoutMs: 10_000,
        writable: [],
      });
      if (result.exitCode === 0 && /ImageMagick/i.test(result.stdout)) {
        return { available: true, version: firstLine(result.stdout), binary };
      }
    } catch {
      // try the next binary
    }
  }
  return { available: false, version: null, binary: null };
}

function coder(format: string): string {
  const name = CODERS[format];
  if (!name) {
    throw new VanillateError('conversion-unsupported', {
      detail: `imagemagick: no coder for ${format}`,
    });
  }
  return name;
}

async function magick(ctx: EngineContext, args: string[]): Promise<string> {
  const binary = ctx.binaries.imagemagick ?? 'convert';
  const seconds = Math.max(10, Math.floor((ctx.deadline - Date.now()) / 1000));
  const result = await ctx.runner.run(
    binary,
    [
      '-limit',
      'memory',
      '1GiB',
      '-limit',
      'map',
      '2GiB',
      '-limit',
      'time',
      String(seconds),
      ...args,
    ],
    runOptions(ctx, {
      env: { MAGICK_CONFIGURE_PATH: POLICY_DIR, MAGICK_THREAD_LIMIT: '2' },
      readable: [POLICY_DIR],
    }),
  );
  assertSuccess(result, 'imagemagick', FAILURES);
  return result.stdout;
}

function inputSpec(input: EngineFile, allFrames: boolean): string {
  return `${coder(input.format)}:${input.path}${allFrames ? '' : '[0]'}`;
}

/** First-frame dimensions from the header: parsed directly when possible, else `-ping`. */
async function dimensions(input: EngineFile, ctx: EngineContext): Promise<ImageDimensions> {
  const handle = await open(input.path, 'r');
  let head: Uint8Array;
  try {
    const buffer = new Uint8Array(65536);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    head = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  let size: ImageDimensions | null = readImageDimensions(head);
  if (!size) {
    const out = await magick(ctx, [
      '-ping',
      inputSpec(input, false),
      '-format',
      '%w %h\n',
      'info:',
    ]);
    const [width = 0, height = 0] = out.trim().split(/\s+/).map(Number);
    size = { width, height };
  }
  if (!size.width || !size.height) {
    throw new VanillateError('input-corrupt', { detail: 'image has no dimensions' });
  }
  if (size.width * size.height > ctx.limits.maxPixels) {
    throw new VanillateError('image-too-large', { detail: `${size.width}×${size.height}` });
  }
  return size;
}

function resizeArgs(options: Record<string, unknown>): string[] {
  const width = num(options.width, 0);
  const height = num(options.height, 0);
  if (!width && !height) return [];
  // `>` only shrinks: images are never enlarged beyond their original size.
  return ['-resize', `${width || ''}x${height || ''}>`];
}

async function convertOne(
  input: EngineFile,
  to: string,
  options: Record<string, unknown>,
  out: string,
  ctx: EngineContext,
): Promise<void> {
  const size = await dimensions(input, ctx);
  const allFrames = MULTI_FRAME_TARGETS.has(to);
  const args = [inputSpec(input, allFrames), '-auto-orient', '+profile', '!icc,*'];
  if (allFrames) args.push('-coalesce');
  args.push(...resizeArgs(options));
  if (OPAQUE_TARGETS.has(to)) {
    args.push(
      '-background',
      str(options.background, '#ffffff'),
      '-alpha',
      'remove',
      '-alpha',
      'off',
    );
  }
  if (to === 'jpg' || to === 'webp' || to === 'jp2') {
    args.push('-quality', String(num(options.quality, 85)));
  }
  if (to === 'webp' && options.lossless === true) args.push('-define', 'webp:lossless=true');
  if (to === 'png') args.push('-define', 'png:exclude-chunks=date,time');
  if (to === 'tiff') args.push('-compress', 'zip');
  if (to === 'ico') {
    args.push(
      '-background',
      'none',
      '-define',
      `icon:auto-resize=${icoSizes(size.width, size.height).join(',')}`,
    );
  }
  if (to === 'gif') args.push('-layers', 'optimize');
  args.push(`${coder(to)}:${out}`);
  await magick(ctx, args);
}

/** Parses a PAM (P7) header; returns the pixel data offset. */
export function parsePam(bytes: Uint8Array): { width: number; height: number; offset: number } {
  const limit = Math.min(bytes.length, 512);
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, limit));
  const end = header.indexOf('ENDHDR\n');
  if (!header.startsWith('P7\n') || end < 0) {
    throw new VanillateError('conversion-failed', { detail: 'invalid PAM header' });
  }
  const field = (name: string): number =>
    Number(new RegExp(`^${name} (\\d+)$`, 'm').exec(header)?.[1]);
  const width = field('WIDTH');
  const height = field('HEIGHT');
  if (field('DEPTH') !== 4 || field('MAXVAL') !== 255 || !width || !height) {
    throw new VanillateError('conversion-failed', { detail: 'unexpected PAM layout' });
  }
  return { width, height, offset: end + 'ENDHDR\n'.length };
}

/** Decodes one image for PDF embedding: JPEG passthrough when possible, else compressed RGBA. */
async function pdfImage(input: EngineFile, index: number, ctx: EngineContext): Promise<PdfImage> {
  await dimensions(input, ctx);
  if (input.format === 'jpg') {
    const bytes = await readFile(input.path);
    const info = readJpegInfo(bytes);
    if (info && (info.components === 1 || info.components === 3) && info.orientation === 1) {
      return {
        kind: 'jpeg',
        bytes,
        width: info.width,
        height: info.height,
        components: info.components,
      };
    }
  }
  const pam = join(ctx.workDir, 'tmp', `pdf-${index}.pam`);
  await magick(ctx, [
    inputSpec(input, false),
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-type',
    'TrueColorAlpha',
    '-depth',
    '8',
    `PAM:${pam}`,
  ]);
  const bytes = await readFile(pam);
  const { width, height, offset } = parsePam(bytes);
  const rgba = bytes.subarray(offset);
  if (rgba.length !== width * height * 4) {
    throw new VanillateError('conversion-failed', { detail: 'unexpected pixel buffer size' });
  }
  // Compress now so only one decoded image is held in memory at a time.
  return { kind: 'flate', width, height, ...(await compressRgba(rgba, width, height)) };
}

async function imagesToPdf(
  inputs: readonly EngineFile[],
  out: string,
  ctx: EngineContext,
): Promise<void> {
  const images: PdfImage[] = [];
  for (const [index, input] of inputs.entries()) {
    images.push(await pdfImage(input, index, ctx));
    ctx.progress((0.8 * (index + 1)) / inputs.length);
  }
  await writeFile(
    out,
    await buildPdf(images, { pageSize: 'fit', orientation: 'auto', margin: 'none' }),
  );
}

async function run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]> {
  if (request.kind !== 'convert') {
    throw new VanillateError('conversion-unsupported', {
      detail: `imagemagick operation ${request.operation}`,
    });
  }
  const options = request.options as Record<string, unknown>;
  if (request.to === 'pdf') {
    const out = join(request.outDir, 'document.pdf');
    await imagesToPdf(request.inputs, out, ctx);
    return [{ path: out, format: 'pdf' }];
  }
  const outputs: EngineOutput[] = [];
  for (const [index, input] of request.inputs.entries()) {
    const out = join(request.outDir, `output-${index + 1}.${extensionOf(ctx, request.to)}`);
    await convertOne(input, request.to, options, out, ctx);
    outputs.push({ path: out, format: request.to });
    ctx.progress((index + 1) / request.inputs.length);
  }
  return outputs;
}

export const imagemagick: ServerEngine = { id: 'imagemagick', probe, run };
