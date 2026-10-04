import { describe, expect, it } from 'vitest';

import { base64ToBytes, bytesToBase64 } from '../src/text/engine.ts';
import { decoder, encoder, text, tool } from './helpers.ts';

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);

describe('Base64', () => {
  it('encodes and decodes both alphabets and data URIs', () => {
    const bytes = new Uint8Array([251, 255, 0, 1, 62, 63]);
    expect(bytesToBase64(bytes)).toBe('+/8AAT4/');
    expect(bytesToBase64(bytes, 'url')).toBe('-_8AAT4_');
    expect(base64ToBytes('-_8AAT4_').bytes).toEqual(bytes);
    expect(base64ToBytes(' +/8A\nAT4/ ').bytes).toEqual(bytes);
    expect(base64ToBytes('data:image/png;base64,iVBORw0KGgo=')).toMatchObject({
      mimeType: 'image/png',
    });
  });

  it('rejects invalid input', () => {
    expect(() => base64ToBytes('abc$')).toThrow();
    expect(() => base64ToBytes('a')).toThrow();
  });

  it('round-trips a binary file and detects its format', async () => {
    const [encoded] = await tool(
      'base64-encode',
      [{ name: 'logo.png', content: PNG, format: 'png' }],
      { base64DataUri: true },
    );
    expect(text(encoded)).toBe(`data:image/png;base64,${bytesToBase64(PNG)}\n`);
    expect(encoded!.name).toBe('logo.b64');
    const [decoded] = await tool('base64-decode', [
      { name: 'logo.b64', content: text(encoded), format: 'base64' },
    ]);
    expect(decoded!.bytes).toEqual(PNG);
    expect(decoded!.format).toBe('png');
    expect(decoded!.name).toBe('logo-decoded.png');
  });

  it('labels undetectable binary output as BIN', async () => {
    const [decoded] = await tool('base64-decode', [
      { name: 'x.txt', content: bytesToBase64(new Uint8Array([1, 2, 0, 4])), format: 'txt' },
    ]);
    expect(decoded!.format).toBe('bin');
  });
});

describe('URL encoding', () => {
  it('encodes components and full URLs', async () => {
    const [component] = await tool('url-encode', [
      { name: 'q.txt', content: 'kota=Bandung & sekitarnya', format: 'txt' },
    ]);
    expect(text(component)).toBe('kota%3DBandung%20%26%20sekitarnya');
    const [uri] = await tool(
      'url-encode',
      [{ name: 'q.txt', content: 'https://x.id/cari?q=a b', format: 'txt' }],
      { urlMode: 'uri' },
    );
    expect(text(uri)).toBe('https://x.id/cari?q=a%20b');
  });

  it('decodes leniently', async () => {
    const [out] = await tool('url-decode', [
      { name: 'q.txt', content: 'a%20b%ZZ%E2%9C%93', format: 'txt' },
    ]);
    expect(text(out)).toBe('a b%ZZ✓');
  });
});

describe('file inspector', () => {
  it('reports the detected format, mismatch and checksum', async () => {
    const [report] = await tool('file-inspector', [
      { name: 'photo.jpg', content: PNG, format: 'png' },
    ]);
    const data = JSON.parse(decoder.decode(report!.bytes)) as Record<string, unknown>;
    expect(data).toMatchObject({
      name: 'photo.jpg',
      size: PNG.length,
      detected: { format: 'png', category: 'image' },
      extension: 'jpg',
      extensionMatches: false,
    });
    expect(data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report!.name).toBe('photo-info.json');
    expect(encoder.encode('x')).toBeInstanceOf(Uint8Array);
  });
});
