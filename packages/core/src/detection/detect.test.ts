import { describe, expect, it } from 'vitest';

import { getRegistry } from '../registry/default.ts';
import { asciiToBytes, concatBytes, hexToBytes } from '../util/bytes.ts';
import { detectFormat, extractExtension, type DetectInput } from './detect.ts';
import { decodeText, looksLikeText } from './text.ts';

const registry = getRegistry();
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function detect(bytes: Uint8Array, name?: string, extra: Partial<DetectInput> = {}) {
  return detectFormat({ name, size: bytes.length, head: bytes, ...extra }, registry);
}

function pad(bytes: Uint8Array, length = 64): Uint8Array {
  const out = new Uint8Array(Math.max(length, bytes.length));
  out.set(bytes);
  return out;
}

/** Builds a minimal stored ZIP archive (no compression) for container sniffing tests. */
function zip(entries: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cview = new DataView(central.buffer);
    cview.setUint32(0, 0x02014b50, true);
    cview.setUint32(20, data.length, true);
    cview.setUint32(24, data.length, true);
    cview.setUint16(28, nameBytes.length, true);
    cview.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = concatBytes(centrals);
  const eocd = new Uint8Array(22);
  const eview = new DataView(eocd.buffer);
  eview.setUint32(0, 0x06054b50, true);
  eview.setUint16(8, centrals.length, true);
  eview.setUint16(10, centrals.length, true);
  eview.setUint32(12, cd.length, true);
  eview.setUint32(16, offset, true);
  return concatBytes([...locals, cd, eocd]);
}

describe('signature detection', () => {
  it.each([
    ['jpg', hexToBytes('FFD8FFE000104A464946')],
    ['png', hexToBytes('89504E470D0A1A0A0000000D49484452')],
    ['gif', asciiToBytes('GIF89a\x01\x00\x01\x00')],
    ['webp', concatBytes([asciiToBytes('RIFF'), hexToBytes('24000000'), asciiToBytes('WEBPVP8 ')])],
    ['wav', concatBytes([asciiToBytes('RIFF'), hexToBytes('24000000'), asciiToBytes('WAVEfmt ')])],
    ['avi', concatBytes([asciiToBytes('RIFF'), hexToBytes('24000000'), asciiToBytes('AVI LIST')])],
    ['pdf', asciiToBytes('%PDF-1.7\n%\xE2\xE3\xCF\xD3')],
    ['flac', asciiToBytes('fLaC\x00\x00\x00\x22')],
    ['7z', hexToBytes('377ABCAF271C0004')],
    [
      'heic',
      concatBytes([hexToBytes('00000018'), asciiToBytes('ftypheic'), hexToBytes('00000000')]),
    ],
    [
      'avif',
      concatBytes([hexToBytes('0000001C'), asciiToBytes('ftypavif'), hexToBytes('00000000')]),
    ],
    [
      'mp4',
      concatBytes([hexToBytes('00000020'), asciiToBytes('ftypisom'), hexToBytes('00000200')]),
    ],
    [
      'mkv',
      concatBytes([
        hexToBytes('1A45DFA3A34286810142F7810142F2810442F381084282'),
        asciiToBytes('matroska'),
      ]),
    ],
    [
      'webm',
      concatBytes([
        hexToBytes('1A45DFA39F4286810142F7810142F2810442F381084282'),
        asciiToBytes('webm'),
      ]),
    ],
    ['mp3', concatBytes([asciiToBytes('ID3'), hexToBytes('04000000000F')])],
    ['woff2', asciiToBytes('wOF2\x00\x01\x00\x00')],
    ['dicom', concatBytes([new Uint8Array(128), asciiToBytes('DICM')])],
  ])('detects %s', (expected, bytes) => {
    const result = detect(pad(bytes));
    expect(result.format?.id).toBe(expected);
    expect(result.evidence).toContain('signature');
  });

  it('prefers the more specific signature (APNG over PNG, EPS over PS)', () => {
    const apng = concatBytes([
      hexToBytes('89504E470D0A1A0A0000000D49484452'),
      new Uint8Array(17),
      asciiToBytes('acTL'),
    ]);
    expect(detect(pad(apng, 128)).format?.id).toBe('apng');
    expect(detect(pad(asciiToBytes('%!PS-Adobe-3.0 EPSF-3.0\n'))).format?.id).toBe('eps');
    expect(detect(pad(asciiToBytes('%!PS-Adobe-3.0\n'))).format?.id).toBe('ps');
  });

  it('detects ISO 9660 images by the volume descriptor at 32 KiB', () => {
    const iso = new Uint8Array(32769 + 16);
    iso.set(asciiToBytes('CD001'), 32769);
    expect(detect(iso).format?.id).toBe('iso');
  });

  it('matches signatures relative to the end of the file (DMG koly trailer)', () => {
    const tail = new Uint8Array(1024);
    tail.set(asciiToBytes('koly'), tail.length - 512);
    const result = detectFormat(
      { name: 'x', size: 10_000_000, head: new Uint8Array(64).fill(7), tail },
      registry,
    );
    expect(result.format?.id).toBe('dmg');
  });

  it('uses the extension to pick among formats sharing a signature', () => {
    const tiffHeader = pad(hexToBytes('49492A0008000000'));
    expect(detect(tiffHeader, 'photo.nef').format?.id).toBe('nef');
    expect(detect(tiffHeader, 'scan.tif').format?.id).toBe('tiff');
    expect(detect(tiffHeader).format?.id).toBe('tiff');
    const gzip = pad(hexToBytes('1F8B0800000000000003'));
    expect(detect(gzip, 'backup.tar.gz').format?.id).toBe('tgz');
    expect(detect(gzip, 'data.gz').format?.id).toBe('gz');
  });

  it('trusts the extension within a container family', () => {
    const isom = pad(concatBytes([hexToBytes('00000020'), asciiToBytes('ftypisom')]));
    const result = detect(isom, 'song.m4a');
    expect(result.format?.id).toBe('m4a');
    expect(result.evidence).toContain('family');
    expect(result.extensionMismatch).toBeNull();
  });

  it('reports content that contradicts the extension', () => {
    const png = pad(hexToBytes('89504E470D0A1A0A0000000D49484452'));
    const result = detect(png, 'holiday.jpg');
    expect(result.format?.id).toBe('png');
    expect(result.extensionMismatch?.extension).toBe('jpg');
    expect(result.extensionMismatch?.expected.map((f) => f.id)).toEqual(['jpg']);
  });

  it('does not trust a binary extension when the magic bytes are missing', () => {
    const result = detect(text('this is not really a picture'), 'fake.png');
    expect(result.format?.id).toBe('txt');
    expect(result.extensionMismatch?.extension).toBe('png');
    const binary = detect(pad(hexToBytes('0102030405060708')), 'fake.pdf');
    expect(binary.format).toBeNull();
    expect(binary.extensionMismatch?.extension).toBe('pdf');
  });

  it('recognizes TAR inside gzip from the inflated head', () => {
    const inflated = new Uint8Array(512);
    inflated.set(asciiToBytes('ustar'), 257);
    const result = detect(pad(hexToBytes('1F8B0800000000000003')), undefined, {
      inflatedHead: inflated,
    });
    expect(result.format?.id).toBe('tgz');
  });
});

describe('container detection', () => {
  it('distinguishes OOXML documents by their parts', () => {
    expect(
      detect(zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w/>' })).format?.id,
    ).toBe('docx');
    expect(
      detect(zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<x/>' })).format?.id,
    ).toBe('xlsx');
    expect(
      detect(
        zip({
          '[Content_Types].xml': '<Types/>',
          'xl/workbook.xml': '<x/>',
          'xl/vbaProject.bin': 'x',
        }),
      ).format?.id,
    ).toBe('xlsm');
    expect(
      detect(zip({ '[Content_Types].xml': '<Types/>', 'ppt/presentation.xml': '<p/>' })).format?.id,
    ).toBe('pptx');
  });

  it('reads the stored mimetype entry of ODF and EPUB files', () => {
    expect(
      detect(zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<x/>' }))
        .format?.id,
    ).toBe('odt');
    expect(
      detect(zip({ mimetype: 'application/epub+zip', 'META-INF/container.xml': '<c/>' })).format
        ?.id,
    ).toBe('epub');
  });

  it('flags a document renamed to .zip and keeps plain archives as ZIP', () => {
    const docx = detect(
      zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w/>' }),
      'report.zip',
    );
    expect(docx.format?.id).toBe('docx');
    expect(docx.extensionMismatch?.extension).toBe('zip');
    expect(detect(zip({ 'a.txt': 'hello', 'b/c.txt': 'world' }), 'files.zip').format?.id).toBe(
      'zip',
    );
    expect(detect(zip({ '001.jpg': 'x', '002.jpg': 'y' }), 'comic.cbz').format?.id).toBe('cbz');
  });

  it('identifies legacy Office files by OLE2 stream names', () => {
    const name = 'WordDocument';
    const stream = new Uint8Array(name.length * 2 + 2);
    for (let i = 0; i < name.length; i++) stream[i * 2] = name.charCodeAt(i);
    const ole = concatBytes([
      hexToBytes('D0CF11E0A1B11AE1'),
      new Uint8Array(1024),
      stream,
      new Uint8Array(64),
    ]);
    expect(detect(ole).format?.id).toBe('doc');
    expect(detect(ole, 'legacy.doc').confidence).toBe('high');
    // An unknown OLE file (e.g. Outlook .msg) is not mistaken for a Word document.
    const unknown = concatBytes([hexToBytes('D0CF11E0A1B11AE1'), new Uint8Array(1024)]);
    expect(detect(unknown, 'mail.msg').format).toBeNull();
    expect(detect(unknown, 'sheet.xls').format?.id).toBe('xls');
  });
});

describe('text detection', () => {
  it.each([
    ['json', '{"name": "Vanillate", "formats": [1, 2, 3]}'],
    // JSON Lines and NDJSON are the same format; without an extension the more common name wins.
    ['jsonl', '{"a":1}\n{"a":2}\n{"a":3}\n'],
    ['xml', '<?xml version="1.0"?>\n<catalog><item/></catalog>'],
    [
      'svg',
      '<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" width="10"/>',
    ],
    ['html', '<!DOCTYPE html>\n<html lang="en"><body>Hi</body></html>'],
    ['srt', '1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n'],
    ['vtt', 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n'],
    ['ass', '[Script Info]\nTitle: x\nScriptType: v4.00+\n\n[Events]\n'],
    ['ssa', '[Script Info]\nScriptType: v4.00\n'],
    ['sbv', '0:00:01.000,0:00:02.000\nHello\n'],
    ['sub', '{10}{50}Hello|World\n'],
    ['ttml', '<tt xmlns="http://www.w3.org/ns/ttml"><body/></tt>'],
    ['rtf', '{\\rtf1\\ansi Hello}'],
    ['tex', '\\documentclass{article}\n\\begin{document}Hi\\end{document}'],
    ['sql', '-- dump\nCREATE TABLE t (id int);\nINSERT INTO t VALUES (1);'],
    ['gltf', '{"asset":{"version":"2.0"},"scenes":[]}'],
  ])('detects %s from content', (expected, content) => {
    expect(detect(text(content)).format?.id).toBe(expected);
  });

  it('uses the extension for text formats without a reliable sniffer', () => {
    expect(detect(text('a,b\n1,2\n'), 'table.csv').format?.id).toBe('csv');
    expect(detect(text('a\tb\n1\t2\n'), 'table.tsv').format?.id).toBe('tsv');
    expect(detect(text('name: test\nlist:\n  - a\n'), 'config.yml').format?.id).toBe('yaml');
    expect(detect(text('# Title\n\nSome *text*.'), 'notes.md').format?.id).toBe('md');
    expect(detect(text('just words'), 'notes.md').confidence).toBe('medium');
  });

  it('falls back to plain text', () => {
    const result = detect(text('Just some notes.\nSecond line.'));
    expect(result.format?.id).toBe('txt');
    expect(result.confidence).toBe('low');
  });

  it('keeps the extension within the JSON family', () => {
    expect(detect(text('{"a":1}\n'), 'one.jsonl').format?.id).toBe('jsonl');
    expect(detect(text('{"asset":{"version":"2.0"}}'), 'data.json').format?.id).toBe('json');
  });

  it('handles truncated heads of large JSON files', () => {
    const head = text(`[${'{"id":1,"name":"x"},'.repeat(4000)}`);
    const result = detectFormat({ name: 'big', size: head.length * 10, head }, registry);
    expect(result.format?.id).toBe('json');
  });

  it('decodes UTF-16 subtitles with a BOM', () => {
    const body = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHalo\r\n';
    const utf16 = new Uint8Array(2 + body.length * 2);
    utf16[0] = 0xff;
    utf16[1] = 0xfe;
    for (let i = 0; i < body.length; i++) utf16[2 + i * 2] = body.charCodeAt(i);
    expect(looksLikeText(utf16)).toBe(true);
    expect(detect(utf16).format?.id).toBe('srt');
  });

  it('decodes legacy Windows-1252 text', () => {
    const bytes = new Uint8Array([0x43, 0x61, 0x66, 0xe9]); // "Café" in Windows-1252
    expect(decodeText(bytes)).toEqual({ text: 'Café', encoding: 'windows-1252', bom: false });
    expect(decodeText(text('Café')).encoding).toBe('utf-8');
  });
});

describe('edge cases', () => {
  it('reports empty files', () => {
    const result = detect(new Uint8Array(0), 'empty.png');
    expect(result.empty).toBe(true);
    expect(result.format).toBeNull();
  });

  it('extracts single and double extensions', () => {
    expect(extractExtension('Archive.TAR.GZ', registry)).toBe('tar.gz');
    expect(extractExtension('my.photo.JPG', registry)).toBe('jpg');
    expect(extractExtension('C:\\Users\\a\\file.docx', registry)).toBe('docx');
    expect(extractExtension('README', registry)).toBeNull();
    expect(extractExtension('.env', registry)).toBe('env');
  });

  it('uses the MIME type only as a last resort', () => {
    const result = detect(text('a,b\n1,2'), 'export', { mimeType: 'text/csv' });
    expect(result.format?.id).toBe('csv');
    expect(result.evidence).toEqual(['mime']);
  });
});
