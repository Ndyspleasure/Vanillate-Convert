import { describe, expect, it } from 'vitest';

import { parseCsv, sniffDelimiter, stringifyCsv } from '../src/data/csv.ts';
import { inferCell, valueToTable } from '../src/data/model.ts';
import { convert, text, tool } from './helpers.ts';

describe('CSV codec', () => {
  it('parses quoted fields with delimiters, quotes and newlines', () => {
    const csv = 'name,note\r\n"Doe, Jane","She said ""hi""\nthen left"\r\nBob,\r\n';
    expect(parseCsv(csv, ',')).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'She said "hi"\nthen left'],
      ['Bob', ''],
    ]);
  });

  it('round-trips through stringify', () => {
    const rows = [
      ['a', 'b c', ' padded '],
      ['x"y', 'line\nbreak', ''],
    ];
    expect(parseCsv(stringifyCsv(rows, ';'), ';')).toEqual(rows);
  });

  it('rejects unterminated quotes', () => {
    expect(() => parseCsv('a,"b\n', ',')).toThrow('unterminated');
  });

  it('sniffs semicolon and tab delimiters', () => {
    expect(sniffDelimiter('nama;umur;kota\nAni;21;Bandung\nBudi;30;Medan\n')).toBe(';');
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t');
    expect(sniffDelimiter('a,b\n"1,5",2\n')).toBe(',');
  });

  it('infers numbers and booleans conservatively', () => {
    expect(inferCell('42')).toBe(42);
    expect(inferCell('-3.5')).toBe(-3.5);
    expect(inferCell('007')).toBe('007');
    expect(inferCell('true')).toBe(true);
    expect(inferCell('12345678901234567890')).toBe('12345678901234567890');
    expect(inferCell('')).toBe('');
  });

  it('flattens nested records into dotted columns', () => {
    expect(
      valueToTable([
        { a: 1, b: { c: 2 } },
        { a: 3, d: [1, 2] },
      ]),
    ).toEqual({
      headers: ['a', 'b.c', 'd'],
      rows: [
        [1, 2, null],
        [3, null, [1, 2]],
      ],
    });
  });
});

describe('data conversions', () => {
  it('CSV → JSON with type inference and auto-detected delimiter', async () => {
    const [out] = await convert('csv', 'json', 'nama;umur;aktif\nAni;21;true\nBudi;007;false\n');
    expect(JSON.parse(text(out))).toEqual([
      { nama: 'Ani', umur: 21, aktif: true },
      { nama: 'Budi', umur: '007', aktif: false },
    ]);
    expect(out!.name).toBe('input.json');
  });

  it('JSON → CSV flattens objects and uses the chosen delimiter', async () => {
    const [out] = await convert(
      'json',
      'csv',
      JSON.stringify([{ id: 1, user: { name: 'A, B' } }]),
      { csvDelimiter: ';' },
    );
    expect(text(out)).toBe('id;user.name\r\n1;A, B\r\n');
  });

  it('JSON ↔ YAML ↔ TOML round trip', async () => {
    const data = { title: 'Vanillate', tags: ['a', 'b'], nested: { n: 1.5, ok: true } };
    const [yaml] = await convert('json', 'yaml', JSON.stringify(data));
    const [toml] = await convert('yaml', 'toml', text(yaml));
    const [json] = await convert('toml', 'json', text(toml));
    expect(JSON.parse(text(json))).toEqual(data);
  });

  it('wraps top-level arrays for TOML and drops nulls', async () => {
    const [toml] = await convert('json', 'toml', JSON.stringify([{ a: 1, b: null }]));
    expect(text(toml)).toContain('[[items]]');
    expect(text(toml)).not.toContain('b =');
  });

  it('XML ↔ JSON maps attributes and text', async () => {
    const [json] = await convert(
      'xml',
      'json',
      '<?xml version="1.0"?><book id="7"><title>Laskar Pelangi</title></book>',
    );
    expect(JSON.parse(text(json))).toEqual({ book: { '@id': '7', title: 'Laskar Pelangi' } });
    const [xml] = await convert(
      'json',
      'xml',
      JSON.stringify({ book: { '@id': '7', title: 'A & B' } }),
      { xmlRootName: 'library' },
    );
    expect(text(xml)).toContain('<library>');
    expect(text(xml)).toContain('<book id="7">');
    expect(text(xml)).toContain('A &amp; B');
  });

  it('never expands nested XML entities (billion laughs)', async () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">${Array.from(
      { length: 10 },
      (_, i) => `<!ENTITY l${i + 1} "${`&l${i};`.repeat(10)}">`,
    )
      .join('')
      .replace('&l0;', '&lol;')}]><lolz>&l10;</lolz>`;
    const [out] = await convert('xml', 'json', bomb);
    expect(out!.bytes.length).toBeLessThan(1024);
  });

  it('rejects external entities (XXE) and entity floods', async () => {
    const xxe =
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>';
    await expect(convert('xml', 'json', xxe)).rejects.toMatchObject({ code: 'input-corrupt' });
    const flood = `<?xml version="1.0"?><!DOCTYPE r [${Array.from({ length: 60 }, (_, i) => `<!ENTITY e${i} "v">`).join('')}]><r>&e1;</r>`;
    await expect(convert('xml', 'json', flood)).rejects.toMatchObject({ code: 'input-corrupt' });
  });

  it('limits YAML alias expansion (billion laughs)', async () => {
    const levels = ['a: &a ["x","x","x","x","x","x","x","x","x"]'];
    for (let i = 1; i < 12; i++)
      levels.push(
        `${String.fromCharCode(97 + i)}: &${String.fromCharCode(97 + i)} [${Array(9)
          .fill(`*${String.fromCharCode(96 + i)}`)
          .join(',')}]`,
      );
    await expect(convert('yaml', 'json', levels.join('\n'))).rejects.toMatchObject({
      code: 'input-corrupt',
    });
  });

  it('NDJSON ↔ JSON', async () => {
    const [json] = await convert('ndjson', 'json', '{"a":1}\n\n{"a":2}\n');
    expect(JSON.parse(text(json))).toEqual([{ a: 1 }, { a: 2 }]);
    const [lines] = await convert('json', 'jsonl', '[{"a":1},{"a":2}]');
    expect(text(lines)).toBe('{"a":1}\n{"a":2}\n');
  });

  it('INI ↔ JSON', async () => {
    const [json] = await convert(
      'ini',
      'json',
      'name = demo ; comment\n[db]\nhost = "localhost"\nport: 5432\n',
    );
    expect(JSON.parse(text(json))).toEqual({
      name: 'demo',
      db: { host: 'localhost', port: '5432' },
    });
    const [ini] = await convert(
      'json',
      'ini',
      JSON.stringify({ app: 'x', db: { host: 'h', nested: { a: 1 } } }),
    );
    expect(text(ini)).toBe('app = x\n\n[db]\nhost = h\nnested.a = 1\n');
  });

  it('CSV → SQL quotes identifiers and escapes values per dialect', async () => {
    const [sql] = await convert('csv', 'sql', 'id,name\n1,"O\'Brien"\n2,"back\\slash"\n', {
      sqlTable: 'people',
      sqlDialect: 'mysql',
    });
    const out = text(sql);
    expect(out).toContain('CREATE TABLE `people`');
    expect(out).toContain('`id` INTEGER');
    expect(out).toContain("(1, 'O''Brien')");
    expect(out).toContain("(2, 'back\\\\slash')");
  });

  it('CSV → HTML and Markdown tables escape content', async () => {
    const [html] = await convert('csv', 'html', 'a,b\n<script>,x|y\n');
    expect(text(html)).toContain('<td>&lt;script&gt;</td>');
    const [md] = await convert('csv', 'md', 'a,b\n<script>,x|y\n');
    expect(text(md)).toBe('| a | b |\n| --- | --- |\n| <script> | x\\|y |\n');
  });

  it('CSV → XLSX produces a valid OOXML workbook', async () => {
    const [xlsx] = await convert('csv', 'xlsx', 'name,score\nAni,90\nBudi,85.5\n');
    expect(xlsx!.format).toBe('xlsx');
    expect(xlsx!.bytes[0]).toBe(0x50);
  });

  it('reports parse errors with line and column', async () => {
    await expect(convert('json', 'yaml', '{\n  "a": 1,\n  oops\n}')).rejects.toMatchObject({
      code: 'input-corrupt',
      fields: expect.objectContaining({ line: '3' }),
    });
  });
});

describe('data tools', () => {
  it('formats and minifies JSON', async () => {
    const [formatted] = await tool(
      'json-formatter',
      [{ name: 'a.json', content: '{"a":[1,2]}', format: 'json' }],
      { jsonIndent: '4' },
    );
    expect(text(formatted)).toBe('{\n    "a": [\n        1,\n        2\n    ]\n}\n');
    expect(formatted!.name).toBe('a.json');
    const [minified] = await tool('json-minifier', [
      { name: 'a.json', content: '{ "a" : [ 1 , 2 ] }\n', format: 'json' },
    ]);
    expect(text(minified)).toBe('{"a":[1,2]}');
  });

  it('formats and minifies XML while keeping comments and CDATA', async () => {
    const xml =
      '<?xml version="1.0"?><!DOCTYPE note><note><!-- c --><to>Ani</to><body><![CDATA[<b>x</b>]]></body></note>';
    const [formatted] = await tool('xml-formatter', [
      { name: 'n.xml', content: xml, format: 'xml' },
    ]);
    expect(text(formatted)).toBe(
      '<?xml version="1.0"?>\n<!DOCTYPE note>\n<note>\n  <!-- c -->\n  <to>Ani</to>\n  <body>\n    <![CDATA[<b>x</b>]]>\n  </body>\n</note>\n',
    );
    const [minified] = await tool('xml-minifier', [
      { name: 'n.xml', content: text(formatted), format: 'xml' },
    ]);
    expect(text(minified)).toBe(
      '<?xml version="1.0"?><!DOCTYPE note><note><to>Ani</to><body><![CDATA[<b>x</b>]]></body></note>',
    );
  });

  it('reports malformed XML with a position', async () => {
    await expect(
      tool('xml-formatter', [{ name: 'bad.xml', content: '<a><b></a>', format: 'xml' }]),
    ).rejects.toMatchObject({
      code: 'input-corrupt',
      fields: expect.objectContaining({ line: '1' }),
    });
  });
});
