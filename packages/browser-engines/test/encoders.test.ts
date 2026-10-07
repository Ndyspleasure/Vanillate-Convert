import { describe, expect, it } from 'vitest';

import { encodeBmp, isOpaque } from '../src/image/encoders/bmp.ts';
import { buildIco, icoSizes } from '../src/image/encoders/ico.ts';
import { buildPdf, placeImage } from '../src/image/encoders/pdf.ts';
import { encodeTiff } from '../src/image/encoders/tiff.ts';
import { writeXlsx } from '../src/data/xlsx.ts';
import { readImageDimensions, readJpegInfo } from '@vanillate/core';
import { hasBinary, runOn } from './tools.ts';

/** 3×2 test image: red, green, blue / white, black, half-transparent gray. */
function sample(alpha = true): Uint8Array {
  const px = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 255, 255],
    [0, 0, 0, 255],
    [128, 128, 128, alpha ? 128 : 255],
  ];
  return new Uint8Array(px.flat());
}

const identify = hasBinary('identify');

describe('BMP encoder', () => {
  it('writes 24-bit BMPs for opaque images and 32-bit otherwise', () => {
    expect(isOpaque(sample(false))).toBe(true);
    const opaque = encodeBmp(sample(false), 3, 2);
    expect(opaque[28]).toBe(24);
    expect(readImageDimensions(opaque)).toEqual({ width: 3, height: 2 });
    const transparent = encodeBmp(sample(), 3, 2);
    expect(transparent[28]).toBe(32);
  });

  it.skipIf(!identify)('produces files ImageMagick reads with the right pixels', () => {
    const out = runOn(encodeBmp(sample(false), 3, 2), 'x.bmp', 'convert', (p) => [
      p,
      '-depth',
      '8',
      'txt:-',
    ]);
    expect(out).toContain('0,0: (255,0,0)');
    expect(out).toContain('2,1: (128,128,128)');
  });
});

describe('TIFF encoder', () => {
  it.skipIf(!identify)('produces deflate-compressed RGBA TIFFs ImageMagick reads', async () => {
    const tiff = await encodeTiff(sample(), 3, 2);
    expect(Array.from(tiff.subarray(0, 4))).toEqual([0x49, 0x49, 0x2a, 0x00]);
    const info = runOn(tiff, 'x.tif', 'identify', (p) => ['-format', '%w %h %[channels] %C', p]);
    expect(info).toBe('3 2 srgba Zip');
    const pixels = runOn(tiff, 'x.tif', 'convert', (p) => [p, '-depth', '8', 'txt:-']);
    expect(pixels).toContain('1,0: (0,255,0,255)');
  });
});

describe('ICO encoder', () => {
  it('picks sizes up to the source size', () => {
    expect(icoSizes(1000, 800)).toEqual([256, 128, 64, 48, 32, 16]);
    expect(icoSizes(40, 40)).toEqual([32, 16]);
    expect(icoSizes(8, 8)).toEqual([16]);
  });

  it('builds the directory and rejects oversize entries', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const ico = buildIco([
      { width: 256, height: 256, png },
      { width: 16, height: 16, png },
    ]);
    expect(Array.from(ico.subarray(0, 6))).toEqual([0, 0, 1, 0, 2, 0]);
    expect(ico[6]).toBe(0); // 256 is stored as 0
    expect(ico[22]).toBe(16);
    expect(() => buildIco([{ width: 300, height: 10, png }])).toThrow('256');
  });
});

describe('PDF writer', () => {
  it('lays out pages for fit, A4 and margins', () => {
    expect(placeImage(800, 600, { pageSize: 'fit', orientation: 'auto', margin: 'none' })).toEqual({
      pageWidth: 600,
      pageHeight: 450,
      x: 0,
      y: 0,
      width: 600,
      height: 450,
    });
    // Landscape A4 with 36 pt margins; a 4:3 image is limited by the page height.
    const a4 = placeImage(4000, 3000, { pageSize: 'a4', orientation: 'auto', margin: 'small' });
    expect(a4.pageWidth).toBeCloseTo(841.89);
    expect(a4.height).toBeCloseTo(595.28 - 72);
    expect(a4.x).toBeCloseTo((841.89 - a4.width) / 2);
  });

  it.skipIf(!hasBinary('qpdf'))(
    'writes structurally valid PDFs with JPEG passthrough and transparency',
    async () => {
      const jpeg = runOnBytes();
      const pdf = await buildPdf(
        [
          { kind: 'rgba', rgba: sample(), width: 3, height: 2 },
          ...(jpeg
            ? [{ kind: 'jpeg' as const, bytes: jpeg, width: 4, height: 4, components: 3 as const }]
            : []),
        ],
        { pageSize: 'a4', orientation: 'auto', margin: 'none' },
      );
      expect(runOn(pdf, 'x.pdf', 'qpdf', (p) => ['--check', p])).toContain(
        'No syntax or stream encoding errors',
      );
      if (hasBinary('pdfinfo')) {
        expect(runOn(pdf, 'x.pdf', 'pdfinfo', (p) => [p])).toMatch(/Pages:\s+2/);
      }
    },
  );
});

/** Generates a small JPEG with ImageMagick (null when unavailable). */
function runOnBytes(): Uint8Array | null {
  if (!identify) return null;
  const base64 = runOn(new Uint8Array([0]), 'seed', 'sh', () => [
    '-c',
    'convert -size 4x4 xc:red jpg:- | base64 -w0',
  ]);
  const jpeg = Uint8Array.from(Buffer.from(base64, 'base64'));
  expect(readJpegInfo(jpeg)).toMatchObject({ width: 4, height: 4, components: 3, orientation: 1 });
  return jpeg;
}

describe('JPEG header parsing', () => {
  it.skipIf(!identify)('reads dimensions, components and orientation', () => {
    const bytes = runOn(new Uint8Array([0]), 'seed', 'sh', (_p, dir) => [
      '-c',
      `convert -size 7x5 xc:blue -set exif:Orientation 6 ${dir}/o.jpg && exiftool -q -overwrite_original -Orientation=6 -n ${dir}/o.jpg 2>/dev/null; base64 -w0 ${dir}/o.jpg`,
    ]);
    const jpeg = Uint8Array.from(Buffer.from(bytes, 'base64'));
    const info = readJpegInfo(jpeg);
    expect(info).toMatchObject({ width: 7, height: 5, components: 3 });
    if (hasBinary('exiftool')) expect(info?.orientation).toBe(6);
  });
});

describe('XLSX writer', () => {
  it.skipIf(!hasBinary('soffice'))(
    'creates workbooks LibreOffice can read back',
    () => {
      const xlsx = writeXlsx([
        { name: 'Ani', score: 90, passed: true },
        { name: 'Budi <b>', score: 85.5, passed: false },
      ]);
      const csv = runOn(xlsx, 'book.xlsx', 'sh', (p, dir) => [
        '-c',
        `soffice -env:UserInstallation=file://${dir}/profile --headless --convert-to csv --outdir ${dir} ${p} >/dev/null 2>&1 && cat ${dir}/book.csv`,
      ]);
      expect(csv.trim().split(/\r?\n/)).toEqual([
        'name,score,passed',
        'Ani,90,TRUE',
        'Budi <b>,85.5,FALSE',
      ]);
    },
    120_000,
  );
});
