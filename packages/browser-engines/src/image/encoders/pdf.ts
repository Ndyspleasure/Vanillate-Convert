/**
 * Minimal PDF writer for image pages.
 *
 * JPEG images are embedded as-is (DCTDecode) — no re-encoding, no quality loss. Other images
 * are embedded as Flate-compressed RGB with an optional soft mask for transparency.
 */
import { deflateZlib } from '../../archive/gzip.ts';

export type PdfImage =
  | { kind: 'jpeg'; bytes: Uint8Array; width: number; height: number; components: 1 | 3 }
  | { kind: 'rgba'; rgba: Uint8Array | Uint8ClampedArray; width: number; height: number }
  /** Pre-compressed pixels (see `compressRgba`), so callers can free RGBA buffers early. */
  | { kind: 'flate'; rgb: Uint8Array; alpha: Uint8Array | null; width: number; height: number };

export type PageSize = 'fit' | 'a4' | 'letter';
export type PageOrientation = 'auto' | 'portrait' | 'landscape';
export type PageMargin = 'none' | 'small' | 'large';

export interface PageLayout {
  pageSize: PageSize;
  orientation: PageOrientation;
  margin: PageMargin;
}

const SIZES: Record<Exclude<PageSize, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};
const MARGINS: Record<PageMargin, number> = { none: 0, small: 36, large: 72 };
/** CSS pixels to points (96 dpi). */
const PX_TO_PT = 0.75;
/** PDF viewers limit page dimensions to 200 inches. */
const MAX_PAGE_PT = 14_400;

export interface Placement {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function placeImage(width: number, height: number, layout: PageLayout): Placement {
  const margin = MARGINS[layout.margin];
  if (layout.pageSize === 'fit') {
    let w = width * PX_TO_PT;
    let h = height * PX_TO_PT;
    const scale = Math.min(1, (MAX_PAGE_PT - 2 * margin) / w, (MAX_PAGE_PT - 2 * margin) / h);
    w *= scale;
    h *= scale;
    return {
      pageWidth: w + 2 * margin,
      pageHeight: h + 2 * margin,
      x: margin,
      y: margin,
      width: w,
      height: h,
    };
  }
  let [pw, ph] = SIZES[layout.pageSize];
  const landscape =
    layout.orientation === 'landscape' || (layout.orientation === 'auto' && width > height);
  if (landscape) [pw, ph] = [ph, pw];
  const availableW = pw - 2 * margin;
  const availableH = ph - 2 * margin;
  const scale = Math.min(availableW / width, availableH / height);
  const w = width * scale;
  const h = height * scale;
  return { pageWidth: pw, pageHeight: ph, x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h };
}

const encoder = new TextEncoder();

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
}

class PdfBuilder {
  private readonly chunks: Uint8Array[] = [];
  private readonly offsets: number[] = [];
  private length = 0;

  constructor() {
    this.raw(encoder.encode('%PDF-1.7\n%âãÏÓ\n'));
  }

  private raw(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  /** Reserves an object number. */
  reserve(): number {
    this.offsets.push(-1);
    return this.offsets.length;
  }

  object(id: number, body: string, stream?: Uint8Array): void {
    this.offsets[id - 1] = this.length;
    if (stream) {
      this.raw(encoder.encode(`${id} 0 obj\n${body}\nstream\n`));
      this.raw(stream);
      this.raw(encoder.encode('\nendstream\nendobj\n'));
    } else {
      this.raw(encoder.encode(`${id} 0 obj\n${body}\nendobj\n`));
    }
  }

  finish(rootId: number, infoId: number): Uint8Array {
    const xrefOffset = this.length;
    const lines = [`xref\n0 ${this.offsets.length + 1}\n0000000000 65535 f \n`];
    for (const offset of this.offsets) {
      if (offset < 0) throw new Error('unwritten PDF object');
      lines.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
    }
    lines.push(
      `trailer\n<< /Size ${this.offsets.length + 1} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    );
    this.raw(encoder.encode(lines.join('')));
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/** Splits RGBA pixels into zlib-compressed RGB and (when not opaque) alpha streams. */
export async function compressRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Promise<{ rgb: Uint8Array; alpha: Uint8Array | null }> {
  const pixels = width * height;
  const rgb = new Uint8Array(pixels * 3);
  const alpha = new Uint8Array(pixels);
  let opaque = true;
  for (let i = 0; i < pixels; i++) {
    rgb[i * 3] = rgba[i * 4] ?? 0;
    rgb[i * 3 + 1] = rgba[i * 4 + 1] ?? 0;
    rgb[i * 3 + 2] = rgba[i * 4 + 2] ?? 0;
    const a = rgba[i * 4 + 3] ?? 255;
    alpha[i] = a;
    if (a !== 255) opaque = false;
  }
  return { rgb: await deflateZlib(rgb), alpha: opaque ? null : await deflateZlib(alpha) };
}

export async function buildPdf(
  images: readonly PdfImage[],
  layout: PageLayout,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  const pdf = new PdfBuilder();
  const catalogId = pdf.reserve();
  const pagesId = pdf.reserve();
  const infoId = pdf.reserve();
  const pageIds: number[] = [];
  for (const [index, image] of images.entries()) {
    const pageId = pdf.reserve();
    const imageId = pdf.reserve();
    const contentId = pdf.reserve();
    pageIds.push(pageId);
    const place = placeImage(image.width, image.height, layout);
    if (image.kind === 'jpeg') {
      const colorSpace = image.components === 1 ? '/DeviceGray' : '/DeviceRGB';
      pdf.object(
        imageId,
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>`,
        image.bytes,
      );
    } else {
      const { rgb, alpha } =
        image.kind === 'flate' ? image : await compressRgba(image.rgba, image.width, image.height);
      let smask = '';
      if (alpha) {
        const maskId = pdf.reserve();
        pdf.object(
          maskId,
          `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${alpha.length} >>`,
          alpha,
        );
        smask = ` /SMask ${maskId} 0 R`;
      }
      pdf.object(
        imageId,
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask} /Length ${rgb.length} >>`,
        rgb,
      );
    }
    const content = encoder.encode(
      `q ${num(place.width)} 0 0 ${num(place.height)} ${num(place.x)} ${num(place.y)} cm /Im0 Do Q`,
    );
    pdf.object(contentId, `<< /Length ${content.length} >>`, content);
    pdf.object(
      pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(place.pageWidth)} ${num(place.pageHeight)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    onProgress?.((index + 1) / images.length);
  }
  pdf.object(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  pdf.object(
    pagesId,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
  );
  pdf.object(infoId, '<< /Producer (Vanillate Convert) >>');
  return pdf.finish(catalogId, infoId);
}
