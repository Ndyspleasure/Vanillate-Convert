/**
 * The neutral value model shared by all data formats (JSON-compatible values), plus helpers
 * to turn values into tables and tables into values.
 */
export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export type Record_ = { [key: string]: Value };

export function isRecord(value: Value | undefined): value is Record_ {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalizes library output (Dates, BigInts, TOML dates, undefined) to plain JSON values. */
export function toValue(input: unknown, depth = 0): Value {
  if (depth > 256) throw new Error('data is nested too deeply');
  if (input === null || input === undefined) return null;
  if (typeof input === 'boolean' || typeof input === 'string') return input;
  if (typeof input === 'number') return Number.isFinite(input) ? input : String(input);
  if (typeof input === 'bigint')
    return Number.isSafeInteger(Number(input)) ? Number(input) : input.toString();
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.toISOString();
  if (Array.isArray(input)) return input.map((item) => toValue(item, depth + 1));
  if (typeof input === 'object') {
    // TOML date/time objects and similar expose a meaningful toString / toISOString.
    const maybe = input as { toISOString?: () => string };
    if (typeof maybe.toISOString === 'function' && !Object.keys(input).length)
      return maybe.toISOString();
    const out: Record_ = {};
    for (const [key, value] of Object.entries(input)) out[key] = toValue(value, depth + 1);
    return out;
  }
  return null; // functions and symbols have no data representation
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Infers JSON types for a CSV cell: numbers (no leading zeros, within safe integer range),
 * `true`/`false`; everything else stays a string. Empty cells stay empty strings.
 */
export function inferCell(cell: string): Value {
  if (cell === 'true') return true;
  if (cell === 'false') return false;
  if (NUMBER.test(cell)) {
    const value = Number(cell);
    if (
      Number.isFinite(value) &&
      (cell.includes('.') ||
        cell.includes('e') ||
        cell.includes('E') ||
        Number.isSafeInteger(value))
    ) {
      return value;
    }
  }
  return cell;
}

/** Makes header names unique and non-empty: ["a", "", "a"] → ["a", "column_2", "a_2"]. */
export function uniqueHeaders(headers: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((raw, index) => {
    const base = raw.trim() === '' ? `column_${index + 1}` : raw.trim();
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

/** Converts parsed CSV rows into records (header row) or arrays (no header). */
export function rowsToValue(rows: readonly string[][], header: boolean): Value[] {
  if (!header) return rows.map((row) => row.map(inferCell));
  const [first, ...rest] = rows;
  if (!first) return [];
  const headers = uniqueHeaders(first);
  return rest.map((row) => {
    const record: Record_ = {};
    headers.forEach((name, i) => {
      record[name] = inferCell(row[i] ?? '');
    });
    // Extra cells beyond the header are kept under generated names.
    for (let i = headers.length; i < row.length; i++)
      record[`column_${i + 1}`] = inferCell(row[i] ?? '');
    return record;
  });
}

/** Text representation of a scalar for table cells; objects and arrays become JSON text. */
export function cellText(value: Value | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Flattens nested objects into dotted keys (arrays become JSON text). */
export function flattenRecord(record: Record_, prefix = '', depth = 0, out: Record_ = {}): Record_ {
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value) && depth < 5 && Object.keys(value).length > 0)
      flattenRecord(value, path, depth + 1, out);
    else out[path] = value;
  }
  return out;
}

export interface Table {
  headers: string[] | null;
  rows: Value[][];
}

/**
 * Turns any value into a table:
 *   - array of objects → one row per object, columns = union of flattened keys;
 *   - array of arrays → rows as-is;
 *   - array of scalars → single "value" column;
 *   - object → one row; a scalar → one cell.
 */
export function valueToTable(value: Value): Table {
  const items: Value[] = Array.isArray(value) ? value : [value];
  if (items.length > 0 && items.every((item) => Array.isArray(item))) {
    return { headers: null, rows: items.filter((item): item is Value[] => Array.isArray(item)) };
  }
  if (items.some((item) => isRecord(item))) {
    const flat = items.map((item) => (isRecord(item) ? flattenRecord(item) : { value: item }));
    const headers: string[] = [];
    const seen = new Set<string>();
    for (const record of flat) {
      for (const key of Object.keys(record)) {
        if (!seen.has(key)) {
          seen.add(key);
          headers.push(key);
        }
      }
    }
    return { headers, rows: flat.map((record) => headers.map((h) => record[h] ?? null)) };
  }
  return { headers: ['value'], rows: items.map((item) => [item]) };
}

export function tableToStrings(table: Table, includeHeader: boolean): string[][] {
  const body = table.rows.map((row) => row.map(cellText));
  return includeHeader && table.headers ? [table.headers, ...body] : body;
}
