/**
 * Browser image engine: conversion between raster formats, SVG rasterization, images → PDF,
 * and the compress / resize / rotate tools.
 *
 * Decoding uses the browser's decoders (with EXIF orientation applied); encoding uses the
 * canvas for PNG/JPEG/WebP and TypeScript encoders for BMP, ICO, TIFF and PDF. Pixel limits
 * are checked from file headers before decoding.
 */
import { readImageDimensions, readJpegInfo, VanillateError, type Registry } from '@vanillate/core';

import type {
  BrowserEngine,
  BrowserInputFile,
  BrowserOutputFile,
  BrowserTask,
  TaskContext,
} from '../types.ts';
import { throwIfAborted } from '../types.ts';
import { makeOutput, onlyInput } from '../util.ts';
import {
  decodeBitmap,
  decodeSvg,
  draw,
  encodeCanvas,
  rgbaOf,
  targetSize,
  type Drawable,
  type Size,
} from './canvas.ts';
import { encodeBmp } from './encoders/bmp.ts';
import { buildIco, icoSizes } from './encoders/ico.ts';
import { buildPdf, type PageLayout, type PdfImage } from './encoders/pdf.ts';
import { encodeTiff } from './encoders/tiff.ts';

const CANVAS_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
/** Formats whose output has no alpha channel and needs a background fill. */
const OPAQUE_TARGETS = new Set(['jpg']);

interface Decoded {
  source: Drawable;
  size: Size;
  close(): void;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function checkPixels(size: Size, registry: Registry): void {
  if (size.width * size.height > registry.mediaLimits.maxPixels) {
    throw new VanillateError('image-too-large', { detail: `${size.width}×${size.height}` });
  }
}

async function decode(input: BrowserInputFile, ctx: TaskContext): Promise<Decoded> {
  if (input.format === 'svg') {
    const { image, size } = await decodeSvg(input.bytes);
    return { source: image, size, close: () => undefined };
  }
  const header = readImageDimensions(input.bytes);
  if (header) checkPixels(header, ctx.registry);
  const mime = ctx.registry.format(input.format)?.mimeTypes[0] ?? 'application/octet-stream';
  const bitmap = await decodeBitmap(input.bytes, mime);
  const size = { width: bitmap.width, height: bitmap.height };
  checkPixels(size, ctx.registry);
  return { source: bitmap, size, close: () => bitmap.close() };
}

async function encode(
  decoded: Decoded,
  to: string,
  options: Record<string, unknown>,
  ctx: TaskContext,
  rotate: 0 | 90 | 180 | 270 = 0,
): Promise<Uint8Array> {
  const size = targetSize(decoded.size, num(options.width), num(options.height));
  checkPixels(size, ctx.registry);
  const background = OPAQUE_TARGETS.has(to)
    ? typeof options.background === 'string'
      ? options.background
      : '#ffffff'
    : null;
  if (to === 'ico') {
    const square = Math.max(size.width, size.height);
    const images = [];
    for (const edge of icoSizes(size.width, size.height)) {
      const scale = edge / square;
      const iconSize = {
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
      };
      const canvas = draw(decoded.source, { size: iconSize, rotate });
      images.push({
        width: canvas.width,
        height: canvas.height,
        png: await encodeCanvas(canvas, 'image/png'),
      });
    }
    return buildIco(images);
  }
  const canvas = draw(decoded.source, { size, background, rotate });
  throwIfAborted(ctx.signal);
  const mime = CANVAS_TYPES[to];
  if (mime) {
    const quality = to === 'png' ? undefined : (num(options.quality) ?? 85) / 100;
    return encodeCanvas(canvas, mime, quality);
  }
  if (to === 'bmp') return encodeBmp(rgbaOf(canvas), canvas.width, canvas.height);
  if (to === 'tiff') return encodeTiff(rgbaOf(canvas), canvas.width, canvas.height);
  throw new VanillateError('conversion-unsupported', {
    detail: `browser-image cannot write ${to}`,
  });
}

function layoutFrom(options: Record<string, unknown>): PageLayout {
  const pageSize =
    options.pageSize === 'a4' || options.pageSize === 'letter' ? options.pageSize : 'fit';
  const orientation =
    options.pageOrientation === 'portrait' || options.pageOrientation === 'landscape'
      ? options.pageOrientation
      : 'auto';
  const margin = options.margin === 'small' || options.margin === 'large' ? options.margin : 'none';
  return { pageSize, orientation, margin };
}

async function imagesToPdf(
  inputs: readonly BrowserInputFile[],
  options: Record<string, unknown>,
  ctx: TaskContext,
): Promise<Uint8Array> {
  if (inputs.length === 0) throw new VanillateError('bad-request', { detail: 'no images' });
  const pages: PdfImage[] = [];
  for (const [index, input] of inputs.entries()) {
    throwIfAborted(ctx.signal);
    const jpeg = input.format === 'jpg' ? readJpegInfo(input.bytes) : null;
    if (jpeg && (jpeg.components === 1 || jpeg.components === 3) && jpeg.orientation === 1) {
      checkPixels(jpeg, ctx.registry);
      // Embed the original JPEG: no re-encoding, no quality loss.
      pages.push({
        kind: 'jpeg',
        bytes: input.bytes,
        width: jpeg.width,
        height: jpeg.height,
        components: jpeg.components,
      });
    } else {
      const decoded = await decode(input, ctx);
      try {
        const canvas = draw(decoded.source, { size: decoded.size });
        pages.push({
          kind: 'rgba',
          rgba: rgbaOf(canvas),
          width: canvas.width,
          height: canvas.height,
        });
      } finally {
        decoded.close();
      }
    }
    ctx.progress((0.6 * (index + 1)) / inputs.length);
  }
  return buildPdf(pages, layoutFrom(options), (fraction) => ctx.progress(0.6 + 0.4 * fraction));
}

async function convert(
  task: Extract<BrowserTask, { kind: 'conversion' }>,
  ctx: TaskContext,
): Promise<BrowserOutputFile[]> {
  if (task.to === 'pdf') {
    const first = task.inputs[0];
    if (!first) throw new VanillateError('bad-request');
    return [
      makeOutput(ctx.registry, first, 'pdf', await imagesToPdf(task.inputs, task.options, ctx)),
    ];
  }
  const outputs: BrowserOutputFile[] = [];
  for (const [index, input] of task.inputs.entries()) {
    const decoded = await decode(input, ctx);
    try {
      outputs.push(
        makeOutput(ctx.registry, input, task.to, await encode(decoded, task.to, task.options, ctx)),
      );
    } finally {
      decoded.close();
    }
    ctx.progress((index + 1) / task.inputs.length);
  }
  return outputs;
}

async function runTool(
  task: Extract<BrowserTask, { kind: 'tool' }>,
  ctx: TaskContext,
): Promise<BrowserOutputFile[]> {
  if (task.operation === 'images-to-pdf') {
    const first = task.inputs[0];
    if (!first) throw new VanillateError('bad-request');
    const name = task.inputs.length === 1 ? first.name : 'images';
    return [
      makeOutput(ctx.registry, { name }, 'pdf', await imagesToPdf(task.inputs, task.options, ctx)),
    ];
  }
  const input = onlyInput(task.inputs);
  const decoded = await decode(input, ctx);
  try {
    let options = task.options;
    let rotate: 0 | 90 | 180 | 270 = 0;
    switch (task.operation) {
      case 'compress':
      case 'resize':
        break;
      case 'rotate': {
        const value = Number(task.options.rotate);
        rotate = value === 180 ? 180 : value === 270 ? 270 : 90;
        options = task.options.quality === undefined ? {} : { quality: task.options.quality };
        break;
      }
      default:
        throw new VanillateError('conversion-unsupported', { detail: task.operation });
    }
    const bytes = await encode(decoded, input.format, options, ctx, rotate);
    if (task.operation === 'compress' && bytes.length >= input.bytes.length) {
      // Never hand back a "compressed" file that is larger than the original.
      return [{ ...makeOutput(ctx.registry, input, input.format, input.bytes), name: input.name }];
    }
    return [{ ...makeOutput(ctx.registry, input, input.format, bytes), name: input.name }];
  } finally {
    decoded.close();
  }
}

export const imageEngine: BrowserEngine = (task, ctx) =>
  task.kind === 'conversion' ? convert(task, ctx) : runTool(task, ctx);

// --------------------------------------------------------- feature support

const PROBES: Record<string, string> = {
  webp: 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
  avif: 'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=',
};

export interface ImageSupport {
  decode: string[];
  encode: string[];
}

async function canDecode(base64: string, mime: string): Promise<boolean> {
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

/** Detects which image formats this browser can decode and encode. */
export async function detectImageSupport(): Promise<ImageSupport> {
  if (typeof createImageBitmap === 'undefined') return { decode: [], encode: [] };
  const decodeList = ['jpg', 'png', 'gif', 'bmp', 'ico'];
  if (await canDecode(PROBES.webp ?? '', 'image/webp')) decodeList.push('webp');
  if (await canDecode(PROBES.avif ?? '', 'image/avif')) decodeList.push('avif');
  if (typeof document !== 'undefined') decodeList.push('svg');
  const encodeList = ['png', 'jpg', 'bmp', 'ico', 'tiff', 'pdf'];
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : null;
    if (canvas) {
      canvas.getContext('2d');
      const blob = await canvas.convertToBlob({ type: 'image/webp' });
      if (blob.type === 'image/webp') encodeList.push('webp');
    }
  } catch {
    // WebP encoding unsupported.
  }
  return { decode: decodeList, encode: encodeList };
}
