/**
 * RFC 4180 CSV/TSV parsing and serialization.
 *
 * Handles quoted fields with embedded delimiters, quotes and newlines, CRLF/LF/CR line
 * endings and a trailing newline. Also sniffs the delimiter for "auto" input.
 */
export type Delimiter = ',' | ';' | '\t' | '|';

export interface CsvLimits {
  maxRows: number;
  maxColumns: number;
}

const DEFAULT_LIMITS: CsvLimits = { maxRows: 1_048_576, maxColumns: 16_384 };

export class CsvError extends Error {
  override name = 'CsvError';
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

export function parseCsv(
  text: string,
  delimiter: Delimiter,
  limits: CsvLimits = DEFAULT_LIMITS,
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;
  let line = 1;
  const pushField = (): void => {
    row.push(field);
    if (row.length > limits.maxColumns) throw new CsvError('too many columns', line);
    field = '';
    fieldStarted = false;
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    if (rows.length > limits.maxRows) throw new CsvError('too many rows', line);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted && field === '') {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      line++;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (inQuotes) throw new CsvError('unterminated quoted field', line);
  if (field !== '' || row.length > 0 || fieldStarted) pushRow();
  return rows;
}

function needsQuotes(value: string, delimiter: string): boolean {
  return (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    /^\s|\s$/.test(value)
  );
}

export function stringifyCsv(rows: readonly (readonly string[])[], delimiter: Delimiter): string {
  return (
    rows
      .map((row) =>
        row
          .map((value) =>
            needsQuotes(value, delimiter) ? `"${value.replace(/"/g, '""')}"` : value,
          )
          .join(delimiter),
      )
      .join('\r\n') + (rows.length > 0 ? '\r\n' : '')
  );
}

/**
 * Picks the delimiter that splits the first lines into the most consistent number of
 * columns (ignoring delimiters inside quotes).
 */
export function sniffDelimiter(text: string): Delimiter {
  const sample = text.slice(0, 64 * 1024);
  const candidates: Delimiter[] = [',', ';', '\t', '|'];
  let best: Delimiter = ',';
  let bestScore = -1;
  for (const delimiter of candidates) {
    let rows: string[][];
    try {
      rows = parseCsv(sample, delimiter, { maxRows: 50, maxColumns: 5000 }).slice(0, 20);
    } catch {
      continue;
    }
    if (sample.length >= 64 * 1024) rows = rows.slice(0, -1); // last row may be cut off
    const counts = rows.map((r) => r.length).filter((n) => n > 1);
    if (counts.length === 0) continue;
    const mode =
      counts.sort(
        (a, b) => counts.filter((n) => n === b).length - counts.filter((n) => n === a).length,
      )[0] ?? 0;
    const consistency = counts.filter((n) => n === mode).length / rows.length;
    const score = consistency * 100 + Math.min(mode, 50);
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}
