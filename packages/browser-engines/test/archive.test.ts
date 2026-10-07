import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { gzip, gzipOriginalName } from '../src/archive/gzip.ts';
import { normalizeEntryPath, uniquePaths } from '../src/archive/paths.ts';
import { readTar, writeTar } from '../src/archive/tar.ts';
import { convert, decoder, tool } from './helpers.ts';
import { hasBinary, runOn } from './tools.ts';

const files = {
  'readme.txt': 'halo',
  'data/table.csv': 'a,b\n1,2\n',
  'data/deep/x.json': '{"a":1}',
};

function zipOf(entries: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));
}

describe('entry paths', () => {
  it('normalizes and rejects traversal', () => {
    expect(normalizeEntryPath('/abs/path.txt', 1024)).toBe('abs/path.txt');
    expect(normalizeEntryPath('C:\\win\\file.txt', 1024)).toBe('win/file.txt');
    expect(normalizeEntryPath('./a//b/./c.txt', 1024)).toBe('a/b/c.txt');
    expect(normalizeEntryPath('dir/', 1024)).toBe('dir');
    expect(() => normalizeEntryPath('../etc/passwd', 1024)).toThrow('escapes');
    expect(() => normalizeEntryPath('a/../../b', 1024)).toThrow('escapes');
    expect(() => normalizeEntryPath('a'.repeat(30), 10)).toThrow('longer');
  });

  it('de-duplicates names case-insensitively', () => {
    const unique = uniquePaths();
    expect(['a.txt', 'A.txt', 'a.txt', 'b'].map(unique)).toEqual([
      'a.txt',
      'A (2).txt',
      'a (3).txt',
      'b',
    ]);
  });
});

describe('TAR codec', () => {
  it('round-trips files, including long paths via pax/prefix', () => {
    const long = `${'folder/'.repeat(20)}file.txt`;
    const entries = [
      { path: 'a.txt', data: strToU8('hello') },
      { path: long, data: strToU8('deep') },
      { path: `${'x'.repeat(150)}.txt`, data: strToU8('pax') },
    ];
    const read = readTar(writeTar(entries), { maxEntries: 10, maxBytes: 1e6 });
    expect(read.entries.map((e) => [e.path, decoder.decode(e.data)])).toEqual(
      entries.map((e) => [e.path, decoder.decode(e.data)]),
    );
  });

  it.skipIf(!hasBinary('tar'))('writes archives GNU tar can list', () => {
    const tar = writeTar([{ path: 'dir/file.txt', data: strToU8('x') }]);
    expect(runOn(tar, 'x.tar', 'tar', (p) => ['-tf', p]).trim()).toBe('dir/file.txt');
  });

  it('enforces entry and size limits', () => {
    const tar = writeTar([
      { path: 'a', data: new Uint8Array(10) },
      { path: 'b', data: new Uint8Array(10) },
    ]);
    expect(() => readTar(tar, { maxEntries: 1, maxBytes: 1e6 })).toThrow('too many entries');
    expect(() => readTar(tar, { maxEntries: 10, maxBytes: 15 })).toThrow('beyond the limit');
  });
});

describe('archive conversions and tools', () => {
  it('ZIP → TAR.GZ → ZIP keeps every file', async () => {
    const [tgz] = await convert('zip', 'tgz', zipOf(files));
    expect(tgz!.name).toBe('input.tar.gz');
    const [zip] = await convert('tgz', 'zip', tgz!.bytes, { zipLevel: 'max' }, 'input.tar.gz');
    const extracted = await tool('archive-extractor', [
      { name: 'input.zip', content: zip!.bytes, format: 'zip' },
    ]);
    expect(Object.fromEntries(extracted.map((f) => [f.path, decoder.decode(f.bytes)]))).toEqual(
      files,
    );
    expect(extracted.find((f) => f.path === 'data/table.csv')?.format).toBe('csv');
  });

  it('rejects path traversal in ZIP entries', async () => {
    const evil = zipOf({ '../../evil.sh': 'rm -rf ~', 'ok.txt': 'ok' });
    await expect(
      tool('archive-extractor', [{ name: 'evil.zip', content: evil, format: 'zip' }]),
    ).rejects.toMatchObject({
      code: 'archive-unsafe',
    });
  });

  it('rejects zip bombs by compression ratio', async () => {
    const bomb = zipSync({ 'zeros.bin': [new Uint8Array(150 * 1024 * 1024), { level: 9 }] });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    await expect(
      tool('archive-extractor', [{ name: 'bomb.zip', content: bomb, format: 'zip' }]),
    ).rejects.toMatchObject({
      code: 'archive-too-large',
    });
  });

  it('extracts gzip files using the stored original name', async () => {
    const gz = await gzip(strToU8('x,y\n1,2\n'));
    // Patch in an FNAME header field: set FLG.FNAME and insert "data.csv\0" after the 10-byte header.
    const name = strToU8('data.csv\0');
    const withName = new Uint8Array(gz.length + name.length);
    withName.set(gz.subarray(0, 10));
    withName[3] = (withName[3] ?? 0) | 0x08;
    withName.set(name, 10);
    withName.set(gz.subarray(10), 10 + name.length);
    expect(gzipOriginalName(withName)).toBe('data.csv');
    const [out] = await tool('archive-extractor', [
      { name: 'whatever.gz', content: withName, format: 'gz' },
    ]);
    expect(out!.name).toBe('data.csv');
    expect(out!.format).toBe('csv');
  });

  it('creates a ZIP from several files with unique names', async () => {
    const [zip] = await tool('zip-creator', [
      { name: 'a.txt', content: 'one', format: 'txt' },
      { name: 'a.txt', content: 'two', format: 'txt' },
    ]);
    expect(zip!.name).toBe('files.zip');
    const extracted = await tool('archive-extractor', [
      { name: 'files.zip', content: zip!.bytes, format: 'zip' },
    ]);
    expect(extracted.map((f) => f.path)).toEqual(['a.txt', 'a (2).txt']);
  });
});
