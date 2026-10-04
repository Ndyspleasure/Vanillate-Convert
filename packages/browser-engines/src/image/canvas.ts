/**
 * Canvas helpers for the browser image engine. Works in Web Workers (OffscreenCanvas,
 * createImageBitmap) and on the main thread (needed for SVG, which workers cannot decode).
 */
import { VanillateError } from '@vanillate/core';

export type Drawable = ImageBitmap | HTMLImageElement;

export interface Size {
  width: number;
  height: number;
}

export type Canvas2D = OffscreenCanvas | HTMLCanvasElement;

export function createCanvas(width: number, height: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new VanillateError('browser-unsupported', { detail: 'no canvas implementation available' });
}

export function context2d(
  canvas: Canvas2D,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: false }) as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new VanillateError('browser-unsupported', { detail: '2d context unavailable' });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Target size: fit inside width × height when both are given, keep the aspect ratio. */
export function targetSize(source: Size, width?: number, height?: number): Size {
  if (!width && !height) return source;
  const scale =
    width && height
      ? Math.min(width / source.width, height / source.height)
      : width
        ? width / source.width
        : (height ?? source.height) / source.height;
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export interface DrawOptions {
  size: Size;
  /** Fill color drawn under the image (for formats without transparency). */
  background?: string | null;
  /** Clockwise rotation in degrees. */
  rotate?: 0 | 90 | 180 | 270;
}

export function draw(source: Drawable, options: DrawOptions): Canvas2D {
  const quarter = options.rotate === 90 || options.rotate === 270;
  const out = quarter ? { width: options.size.height, height: options.size.width } : options.size;
  const canvas = createCanvas(out.width, out.height);
  const ctx = context2d(canvas);
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  if (options.rotate) {
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((options.rotate * Math.PI) / 180);
    ctx.drawImage(
      source,
      -options.size.width / 2,
      -options.size.height / 2,
      options.size.width,
      options.size.height,
    );
  } else {
    ctx.drawImage(source, 0, 0, options.size.width, options.size.height);
  }
  return canvas;
}

export function rgbaOf(canvas: Canvas2D): Uint8ClampedArray {
  return context2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
}

export async function encodeCanvas(
  canvas: Canvas2D,
  mimeType: string,
  quality?: number,
): Promise<Uint8Array> {
  let blob: Blob | null;
  if ('convertToBlob' in canvas) {
    blob = await canvas.convertToBlob({
      type: mimeType,
      ...(quality !== undefined ? { quality } : {}),
    });
  } else {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
  }
  // Browsers silently fall back to PNG for unsupported types; never deliver the wrong format.
  if (!blob || blob.type !== mimeType) {
    throw new VanillateError('browser-unsupported', { detail: `canvas cannot encode ${mimeType}` });
  }
  return new Uint8Array(await blob.arrayBuffer());
}

export async function decodeBitmap(bytes: Uint8Array, mimeType: string): Promise<ImageBitmap> {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
  try {
    return await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      premultiplyAlpha: 'none',
    });
  } catch (error) {
    throw new VanillateError('input-corrupt', {
      detail: `decode failed: ${(error as Error).message}`,
      cause: error,
    });
  }
}

const SVG_FALLBACK_WIDTH = 1024;

function svgIntrinsicSize(svg: string): Size | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const length = (name: string): number | null => {
    const match = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(root);
    return match?.[1] ? Number(match[1]) : null;
  };
  const width = length('width');
  const height = length('height');
  const viewBox = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(
    root,
  );
  const vbW = viewBox?.[1] ? Number(viewBox[1]) : null;
  const vbH = viewBox?.[2] ? Number(viewBox[2]) : null;
  if (width && height) return { width, height };
  if (vbW && vbH) {
    if (width) return { width, height: (width * vbH) / vbW };
    if (height) return { width: (height * vbW) / vbH, height };
    return { width: vbW, height: vbH };
  }
  return null;
}

/** Decodes an SVG on the main thread via an <img> element (scripts and external resources never load). */
export async function decodeSvg(
  bytes: Uint8Array,
): Promise<{ image: HTMLImageElement; size: Size }> {
  if (typeof document === 'undefined') {
    throw new VanillateError('browser-unsupported', {
      detail: 'SVG rendering needs the main thread',
    });
  }
  const text = new TextDecoder().decode(bytes);
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/svg+xml' }),
  );
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const intrinsic = svgIntrinsicSize(text);
    let size: Size = intrinsic ?? { width: image.naturalWidth, height: image.naturalHeight };
    if (!size.width || !size.height)
      size = { width: SVG_FALLBACK_WIDTH, height: SVG_FALLBACK_WIDTH };
    return {
      image,
      size: {
        width: Math.max(1, Math.round(size.width)),
        height: Math.max(1, Math.round(size.height)),
      },
    };
  } catch (error) {
    throw new VanillateError('input-corrupt', {
      detail: `SVG decode failed: ${(error as Error).message}`,
      cause: error,
    });
  } finally {
    // Revoke after decode: the decoded image stays usable for drawing.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
