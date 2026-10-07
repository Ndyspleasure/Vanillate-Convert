/**
 * Reads image dimensions from headers without decoding pixels, so oversized images
 * ("decompression bombs") are rejected before any decoder allocates memory.
 * Also exposes JPEG details needed to embed JPEGs in PDFs without re-encoding.
 */
import { readUint16LE, readUint32LE } from '../util/bytes.ts';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface JpegInfo extends ImageDimensions {
  components: number;
  /** EXIF orientation (1–8); 1 when absent. */
  orientation: number;
  /** Adobe APP14 marker present (common for CMYK JPEGs with inverted values). */
  adobe: boolean;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return readUint16BE(bytes, offset) * 0x10000 + readUint16BE(bytes, offset + 2);
}

function exifOrientation(bytes: Uint8Array, start: number, length: number): number {
  // "Exif\0\0" then a TIFF header.
  if (String.fromCharCode(...bytes.subarray(start, start + 4)) !== 'Exif') return 1;
  const tiff = start + 6;
  const little = bytes[tiff] === 0x49;
  const u16 = (o: number): number => (little ? readUint16LE(bytes, o) : readUint16BE(bytes, o));
  const u32 = (o: number): number => (little ? readUint32LE(bytes, o) : readUint32BE(bytes, o));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > start + length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > start + length) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let orientation = 1;
  let adobe = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const length = readUint16BE(bytes, offset + 2);
    if (length < 2) return null;
    if (marker === 0xe1) orientation = exifOrientation(bytes, offset + 4, length - 2);
    if (
      marker === 0xee &&
      String.fromCharCode(...bytes.subarray(offset + 4, offset + 9)) === 'Adobe'
    )
      adobe = true;
    // SOF markers (excluding DHT C4, JPG C8, DAC CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: readUint16BE(bytes, offset + 5),
        width: readUint16BE(bytes, offset + 7),
        components: bytes[offset + 9] ?? 0,
        orientation,
        adobe,
      };
    }
    if (marker === 0xda) return null; // start of scan before a frame header
    offset += 2 + length;
  }
  return null;
}

/** Dimensions of PNG, JPEG, GIF, BMP, WebP and ICO images from their headers. */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  // PNG: IHDR
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const info = readJpegInfo(bytes);
    return info ? { width: info.width, height: info.height } : null;
  }
  // GIF: logical screen
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) };
  }
  // BMP
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const headerSize = readUint32LE(bytes, 14);
    if (headerSize === 12)
      return { width: readUint16LE(bytes, 18), height: readUint16LE(bytes, 20) };
    const height = readUint32LE(bytes, 22);
    return {
      width: readUint32LE(bytes, 18),
      height: height > 0x7fffffff ? 0x100000000 - height : height,
    };
  }
  // WebP (RIFF....WEBP)
  if (readUint32LE(bytes, 0) === 0x46464952 && readUint32LE(bytes, 8) === 0x50424557) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') {
      return {
        width: 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16)),
        height: 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16)),
      };
    }
    if (chunk === 'VP8 ')
      return { width: readUint16LE(bytes, 26) & 0x3fff, height: readUint16LE(bytes, 28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = readUint32LE(bytes, 21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  // ICO: largest entry
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) {
    const count = readUint16LE(bytes, 4);
    let best: ImageDimensions | null = null;
    for (let i = 0; i < count && 6 + i * 16 + 16 <= bytes.length; i++) {
      const w = bytes[6 + i * 16] || 256;
      const h = bytes[7 + i * 16] || 256;
      if (!best || w * h > best.width * best.height) best = { width: w, height: h };
    }
    return best;
  }
  return null;
}
