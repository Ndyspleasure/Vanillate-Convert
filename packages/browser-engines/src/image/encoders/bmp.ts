/**
 * BMP encoder: 24-bit BI_RGB for opaque images, 32-bit BI_BITFIELDS (BITMAPV4HEADER) with an
 * alpha mask otherwise. Input is RGBA (as from ImageData).
 */
export function isOpaque(rgba: Uint8Array | Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false;
  return true;
}

export function encodeBmp(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const opaque = isOpaque(rgba);
  const bytesPerPixel = opaque ? 3 : 4;
  const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const headerSize = opaque ? 40 : 108;
  const dataOffset = 14 + headerSize;
  const fileSize = dataOffset + rowSize * height;
  const out = new Uint8Array(fileSize);
  const view = new DataView(out.buffer);
  out[0] = 0x42; // B
  out[1] = 0x4d; // M
  view.setUint32(2, fileSize, true);
  view.setUint32(10, dataOffset, true);
  view.setUint32(14, headerSize, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive: bottom-up rows
  view.setUint16(26, 1, true);
  view.setUint16(28, bytesPerPixel * 8, true);
  view.setUint32(30, opaque ? 0 : 3, true); // BI_RGB or BI_BITFIELDS
  view.setUint32(34, rowSize * height, true);
  view.setInt32(38, 2835, true); // 72 DPI
  view.setInt32(42, 2835, true);
  if (!opaque) {
    view.setUint32(54, 0x00ff0000, true); // red mask
    view.setUint32(58, 0x0000ff00, true); // green
    view.setUint32(62, 0x000000ff, true); // blue
    view.setUint32(66, 0xff000000, true); // alpha
    view.setUint32(70, 0x73524742, true); // LCS_sRGB ('sRGB')
  }
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    let dst = dataOffset + y * rowSize;
    for (let x = 0; x < width; x++) {
      const s = src + x * 4;
      out[dst++] = rgba[s + 2] ?? 0;
      out[dst++] = rgba[s + 1] ?? 0;
      out[dst++] = rgba[s] ?? 0;
      if (!opaque) out[dst++] = rgba[s + 3] ?? 0;
    }
  }
  return out;
}
