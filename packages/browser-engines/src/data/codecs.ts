/**
 * Readers and writers for every data format handled by the browser data engine.
 * Readers produce the neutral `Value` model; writers serialize it.
 */
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { parseAllDocuments, stringify as stringifyYaml } from 'yaml';

import { parseCsv, sniffDelimiter, stringifyCsv, type Delimiter } from './csv.ts';
import {
  cellText,
  flattenRecord,
  isRecord,
  rowsToValue,
  tableToStrings,
  toValue,
  valueToTable,
  type Record_,
  type Value,
} from './model.ts';

// ------------------------------------------------------------------- JSON

export function readJson(text: string): Value {
  return toValue(JSON.parse(text) as unknown);
}

export type JsonIndent = '2' | '4' | 'tab' | 'minify';

export function writeJson(value: Value, indent: JsonIndent = '2'): string {
  const space = indent === 'minify' ? undefined : indent === 'tab' ? '\t' : Number(indent);
  return `${JSON.stringify(value, null, space)}\n`;
}

// --------------------------------------------------------- NDJSON / JSONL

export function readNdjson(text: string): Value[] {
  const out: Value[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    try {
      out.push(toValue(JSON.parse(line) as unknown));
    } catch (error) {
      throw new Error(`line ${index + 1}: ${(error as Error).message}`, { cause: error });
    }
  });
  return out;
}

export function writeNdjson(value: Value): string {
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => JSON.stringify(item)).join('\n') + (items.length > 0 ? '\n' : '');
}

// ------------------------------------------------------------------- YAML

export function readYaml(text: string): Value {
  const documents = parseAllDocuments(text, { uniqueKeys: true });
  // `parseAllDocuments` returns an EmptyStream (not an array) for empty input.
  const docs = Array.isArray(documents) ? documents : [];
  for (const doc of docs) {
    if (doc.errors.length > 0) throw doc.errors[0] ?? new Error('invalid YAML');
  }
  const values = docs.map((doc) => toValue(doc.toJS({ maxAliasCount: 100 })));
  if (values.length === 0) return null;
  return values.length === 1 ? (values[0] ?? null) : values;
}

export function writeYaml(value: Value): string {
  return stringifyYaml(value, { lineWidth: 0, aliasDuplicateObjects: false });
}

// ------------------------------------------------------------------- TOML

export function readToml(text: string): Value {
  return toValue(parseToml(text));
}

/** TOML has no null and needs a table at the root (see the `toml-root-table` limitation). */
function stripNulls(value: Value): Value {
  if (Array.isArray(value)) return value.filter((item) => item !== null).map(stripNulls);
  if (isRecord(value)) {
    const out: Record_ = {};
    for (const [key, item] of Object.entries(value)) if (item !== null) out[key] = stripNulls(item);
    return out;
  }
  return value;
}

export function writeToml(value: Value): string {
  const root = isRecord(value) ? value : { items: value };
  return `${stringifyToml(stripNulls(root))}\n`;
}

// -------------------------------------------------------------------- XML

const XML_LIMITS = {
  enabled: true,
  maxEntitySize: 1000,
  maxEntityCount: 50,
  maxTotalExpansions: 1000,
  maxExpandedLength: 100_000,
};

export function readXml(text: string): Value {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
    allowBooleanAttributes: true,
    processEntities: XML_LIMITS,
    htmlEntities: false,
  });
  return toValue(parser.parse(text, true));
}

/** Makes a string usable as an XML element name. */
export function xmlName(key: string): string {
  let name = key.replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!/^[A-Za-z_]/.test(name)) name = `_${name}`;
  if (/^xml/i.test(name)) name = `_${name}`;
  return name;
}

/** Strips characters that are not allowed in XML 1.0 documents. */
export function xmlSafeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
}

function toXmlTree(value: Value): unknown {
  if (Array.isArray(value)) return { item: value.map(toXmlTree) };
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith('@') && !isRecord(item) && !Array.isArray(item)) {
        out[`@${xmlName(key.slice(1))}`] = xmlSafeText(cellText(item));
      } else if (key === '#text') {
        out['#text'] = xmlSafeText(cellText(item));
      } else {
        const name = xmlName(key);
        out[name] = Array.isArray(item) ? item.map(toXmlTree) : toXmlTree(item);
      }
    }
    return out;
  }
  return value === null ? '' : xmlSafeText(cellText(value));
}

export function writeXml(value: Value, rootName = 'root'): string {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    textNodeName: '#text',
    format: true,
    indentBy: '  ',
    suppressEmptyNode: true,
    processEntities: true,
  });
  // A single top-level key becomes the root element when no explicit root is wanted.
  const tree = { [xmlName(rootName)]: toXmlTree(value) };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(tree).trimEnd()}\n`;
}

// -------------------------------------------------------------------- INI

export function readIni(text: string): Value {
  const root: Record_ = {};
  let section: Record_ = root;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith(';') || line.startsWith('#')) return;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header?.[1]) {
      const name = header[1].trim();
      const existing = root[name];
      section = isRecord(existing) ? existing : {};
      root[name] = section;
      return;
    }
    const eq = line.search(/[=:]/);
    if (eq <= 0) throw new Error(`line ${index + 1}: expected key = value`);
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted = /^"(.*)"$|^'(.*)'$/.exec(value);
    if (quoted) value = quoted[1] ?? quoted[2] ?? '';
    else value = value.replace(/\s+[;#].*$/, '');
    section[key] = value;
  });
  return root;
}

function iniValue(value: Value): string {
  const text = cellText(value);
  return /[;#="']|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

export function writeIni(value: Value): string {
  const root = isRecord(value) ? value : { items: value };
  const lines: string[] = [];
  const sections: [string, Record_][] = [];
  for (const [key, item] of Object.entries(root)) {
    if (isRecord(item)) sections.push([key, flattenRecord(item)]);
    else lines.push(`${key} = ${iniValue(item)}`);
  }
  for (const [name, record] of sections) {
    if (lines.length > 0) lines.push('');
    lines.push(`[${name.replace(/[[\]]/g, '_')}]`);
    for (const [key, item] of Object.entries(record)) lines.push(`${key} = ${iniValue(item)}`);
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- CSV/TSV

export function delimiterFor(option: unknown, fallback: Delimiter): Delimiter {
  if (option === 'tab') return '\t';
  if (option === ',' || option === ';' || option === '|') return option;
  return fallback;
}

export function readDelimited(
  text: string,
  delimiterOption: unknown,
  header: boolean,
  tsv: boolean,
): Value[] {
  const delimiter: Delimiter = tsv
    ? '\t'
    : delimiterOption === 'auto' || delimiterOption === undefined
      ? sniffDelimiter(text)
      : delimiterFor(delimiterOption, ',');
  return rowsToValue(parseCsv(text, delimiter), header);
}

export function writeDelimited(value: Value, delimiter: Delimiter, header: boolean): string {
  return stringifyCsv(tableToStrings(valueToTable(value), header), delimiter);
}

// -------------------------------------------------------------------- SQL

export type SqlDialect = 'standard' | 'postgresql' | 'mysql' | 'sqlite';

function quoteIdentifier(name: string, dialect: SqlDialect): string {
  return dialect === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;
}

function sqlLiteral(value: Value, dialect: SqlDialect): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean')
    return dialect === 'sqlite' || dialect === 'mysql'
      ? value
        ? '1'
        : '0'
      : value
        ? 'TRUE'
        : 'FALSE';
  let text = cellText(value).replace(/'/g, "''");
  if (dialect === 'mysql') text = text.replace(/\\/g, '\\\\');
  return `'${text}'`;
}

function columnType(values: readonly Value[], dialect: SqlDialect): string {
  const present = values.filter((v) => v !== null && v !== '');
  if (present.length > 0 && present.every((v) => typeof v === 'number' && Number.isInteger(v)))
    return 'INTEGER';
  if (present.length > 0 && present.every((v) => typeof v === 'number'))
    return dialect === 'postgresql' ? 'DOUBLE PRECISION' : 'REAL';
  if (present.length > 0 && present.every((v) => typeof v === 'boolean'))
    return dialect === 'sqlite' ? 'INTEGER' : 'BOOLEAN';
  return 'TEXT';
}

export function writeSql(value: Value, table: string, dialect: SqlDialect): string {
  const data = valueToTable(value);
  const headers = data.headers ?? (data.rows[0] ?? []).map((_, i) => `column_${i + 1}`);
  const tableName = quoteIdentifier(table, dialect);
  const columns = headers.map((h) => quoteIdentifier(h, dialect));
  const lines: string[] = [];
  const definitions = headers.map(
    (_, i) =>
      `  ${columns[i]} ${columnType(
        data.rows.map((r) => r[i] ?? null),
        dialect,
      )}`,
  );
  lines.push(`CREATE TABLE ${tableName} (\n${definitions.join(',\n')}\n);`, '');
  const batch = 100;
  for (let start = 0; start < data.rows.length; start += batch) {
    const chunk = data.rows.slice(start, start + batch);
    const values = chunk.map(
      (row) => `  (${headers.map((_, i) => sqlLiteral(row[i] ?? null, dialect)).join(', ')})`,
    );
    lines.push(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES\n${values.join(',\n')};`);
  }
  return `${lines.join('\n')}\n`;
}

// ------------------------------------------------------- HTML / Markdown

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function writeHtmlTable(value: Value, title: string): string {
  const data = valueToTable(value);
  const head = data.headers
    ? `<thead><tr>${data.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`
    : '';
  const body = data.rows
    .map(
      (row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cellText(cell))}</td>`).join('')}</tr>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>table{border-collapse:collapse;font-family:system-ui,sans-serif}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f3f3f3}</style>
</head>
<body>
<table>
${head}
<tbody>
${body}
</tbody>
</table>
</body>
</html>
`;
}

function markdownCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

export function writeMarkdownTable(value: Value): string {
  const data = valueToTable(value);
  const width = Math.max(data.headers?.length ?? 0, ...data.rows.map((r) => r.length), 1);
  const headers = data.headers ?? Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const line = (cells: readonly string[]): string => `| ${cells.map(markdownCell).join(' | ')} |`;
  const rows = data.rows.map((row) =>
    line(Array.from({ length: width }, (_, i) => cellText(row[i]))),
  );
  return `${[line(headers), `|${headers.map(() => ' --- ').join('|')}|`, ...rows].join('\n')}\n`;
}
