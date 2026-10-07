/**
 * Baseline little-endian TIFF encoder: 8-bit RGB or RGBA (unassociated alpha), Adobe Deflate
 * compression per strip.
 */
import { deflateZlib } from '../../archive/gzip.ts';
import { isOpaque } from './bmp.ts';

interface Tag {
  id: number;
  type: 3 | 4; // SHORT | LONG
  values: number[];
}

const SHORT = 3;
const LONG = 4;

export async function encodeTiff(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const alpha = !isOpaque(rgba);
  const samples = alpha ? 4 : 3;
  const rowBytes = width * samples;
  const rowsPerStrip = Math.max(1, Math.floor(65536 / Math.max(1, rowBytes)));
  const strips: Uint8Array[] = [];
  for (let y = 0; y < height; y += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, height - y);
    const raw = new Uint8Array(rows * rowBytes);
    let dst = 0;
    for (let r = 0; r < rows; r++) {
      const src = (y + r) * width * 4;
      for (let x = 0; x < width; x++) {
        const s = src + x * 4;
        raw[dst++] = rgba[s] ?? 0;
        raw[dst++] = rgba[s + 1] ?? 0;
        raw[dst++] = rgba[s + 2] ?? 0;
        if (alpha) raw[dst++] = rgba[s + 3] ?? 0;
      }
    }
    strips.push(await deflateZlib(raw));
  }

  const tags: Tag[] = [
    { id: 256, type: LONG, values: [width] },
    { id: 257, type: LONG, values: [height] },
    { id: 258, type: SHORT, values: Array<number>(samples).fill(8) },
    { id: 259, type: SHORT, values: [8] }, // Adobe Deflate
    { id: 262, type: SHORT, values: [2] }, // RGB
    { id: 273, type: LONG, values: [] }, // StripOffsets (filled below)
    { id: 277, type: SHORT, values: [samples] },
    { id: 278, type: LONG, values: [rowsPerStrip] },
    { id: 279, type: LONG, values: strips.map((s) => s.length) },
    { id: 284, type: SHORT, values: [1] }, // chunky
    ...(alpha ? [{ id: 338, type: SHORT, values: [2] } as Tag] : []), // unassociated alpha
  ];

  const ifdOffset = 8;
  const ifdSize = 2 + tags.length * 12 + 4;
  // Out-of-line values (arrays that do not fit in 4 bytes) follow the IFD.
  let extraOffset = ifdOffset + ifdSize;
  const extraOffsets = new Map<number, number>();
  for (const tag of tags) {
    const count = tag.id === 273 ? strips.length : tag.values.length;
    const size = count * (tag.type === SHORT ? 2 : 4);
    if (size > 4) {
      extraOffsets.set(tag.id, extraOffset);
      extraOffset += size + (size % 2);
    }
  }
  let dataOffset = extraOffset;
  const stripOffsets = strips.map((strip) => {
    const offset = dataOffset;
    dataOffset += strip.length;
    return offset;
  });
  const stripTag = tags.find((t) => t.id === 273);
  if (stripTag) stripTag.values = stripOffsets;

  const out = new Uint8Array(dataOffset);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49, 0x2a, 0x00]);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, tags.length, true);
  tags.forEach((tag, i) => {
    const entry = ifdOffset + 2 + i * 12;
    view.setUint16(entry, tag.id, true);
    view.setUint16(entry + 2, tag.type, true);
    view.setUint32(entry + 4, tag.values.length, true);
    const outOfLine = extraOffsets.get(tag.id);
    const write = (base: number): void => {
      tag.values.forEach((value, j) => {
        if (tag.type === SHORT) view.setUint16(base + j * 2, value, true);
        else view.setUint32(base + j * 4, value, true);
      });
    };
    if (outOfLine !== undefined) {
      view.setUint32(entry + 8, outOfLine, true);
      write(outOfLine);
    } else {
      write(entry + 8);
    }
  });
  view.setUint32(ifdOffset + 2 + tags.length * 12, 0, true); // no next IFD
  strips.forEach((strip, i) => out.set(strip, stripOffsets[i] ?? 0));
  return out;
}
