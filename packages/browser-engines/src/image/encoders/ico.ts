/**
 * ICO container with PNG-compressed images (supported since Windows Vista and by all
 * browsers). Sizes must be at most 256 × 256.
 */
export interface IcoImage {
  width: number;
  height: number;
  png: Uint8Array;
}

/** Icon sizes to generate for a source image, largest first. */
export function icoSizes(width: number, height: number): number[] {
  const largest = Math.min(256, Math.max(width, height));
  const sizes = [256, 128, 64, 48, 32, 16].filter((size) => size <= largest);
  return sizes.length > 0 ? sizes : [16];
}

export function buildIco(images: readonly IcoImage[]): Uint8Array {
  const headerSize = 6 + 16 * images.length;
  const total = headerSize + images.reduce((n, img) => n + img.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true); // icon
  view.setUint16(4, images.length, true);
  let offset = headerSize;
  images.forEach((image, i) => {
    if (image.width > 256 || image.height > 256)
      throw new RangeError('ICO images are limited to 256 × 256');
    const entry = 6 + i * 16;
    out[entry] = image.width === 256 ? 0 : image.width;
    out[entry + 1] = image.height === 256 ? 0 : image.height;
    out[entry + 2] = 0; // palette size
    out[entry + 3] = 0;
    view.setUint16(entry + 4, 1, true); // planes
    view.setUint16(entry + 6, 32, true); // bits per pixel
    view.setUint32(entry + 8, image.png.length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(image.png, offset);
    offset += image.png.length;
  });
  return out;
}
