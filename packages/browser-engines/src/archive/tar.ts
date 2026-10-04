/**
 * TAR (ustar + GNU long names + pax path/size) reader and ustar/pax writer.
 * Only regular files are returned; links, devices and FIFOs are skipped and counted.
 */
const BLOCK = 512;
const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const encoder = new TextEncoder();

export interface TarEntry {
  path: string;
  data: Uint8Array;
}

export interface TarReadResult {
  entries: TarEntry[];
  skipped: number;
}

function cstring(bytes: Uint8Array, start: number, length: number): string {
  const slice = bytes.subarray(start, start + length);
  const end = slice.indexOf(0);
  const raw = end >= 0 ? slice.subarray(0, end) : slice;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return latin1.decode(raw);
  }
}

function readNumber(bytes: Uint8Array, start: number, length: number): number {
  const first = bytes[start] ?? 0;
  if (first & 0x80) {
    // GNU base-256 encoding for large values.
    let value = 0;
    for (let i = start + 1; i < start + length; i++) value = value * 256 + (bytes[i] ?? 0);
    return value;
  }
  const text = latin1
    .decode(bytes.subarray(start, start + length))
    .replace(/\0.*$/, '')
    .trim();
  return text === '' ? 0 : Number.parseInt(text, 8);
}

function checksumOk(header: Uint8Array): boolean {
  const stored = readNumber(header, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : (header[i] ?? 0);
  return sum === stored;
}

function parsePax(data: Uint8Array): Record<string, string> {
  const text = utf8.decode(data);
  const out: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(' ', i);
    if (space < 0) break;
    const length = Number(text.slice(i, space));
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, i + length - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += length;
  }
  return out;
}

export interface TarLimits {
  maxEntries: number;
  maxBytes: number;
}

export function readTar(bytes: Uint8Array, limits: TarLimits): TarReadResult {
  const entries: TarEntry[] = [];
  let skipped = 0;
  let offset = 0;
  let total = 0;
  let longName: string | null = null;
  let pax: Record<string, string> = {};
  while (offset + BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;
    if (!checksumOk(header)) throw new Error(`invalid TAR header at byte ${offset}`);
    const type = String.fromCharCode(header[156] ?? 0);
    let size = readNumber(header, 124, 12);
    if (pax.size !== undefined) size = Number(pax.size);
    const dataStart = offset + BLOCK;
    if (!Number.isFinite(size) || size < 0 || dataStart + size > bytes.length)
      throw new Error('truncated TAR archive');
    const data = bytes.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {
      longName = cstring(data, 0, data.length);
      continue;
    }
    if (type === 'x') {
      pax = parsePax(data);
      continue;
    }
    if (type === 'g') continue;

    const magic = latin1.decode(header.subarray(257, 262));
    const prefix = magic === 'ustar' ? cstring(header, 345, 155) : '';
    const name = cstring(header, 0, 100);
    const path = pax.path ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    pax = {};
    if (type === '0' || type === '\0' || type === '7') {
      if (entries.length >= limits.maxEntries) throw new RangeError('too many entries');
      total += size;
      if (total > limits.maxBytes) throw new RangeError('archive expands beyond the limit');
      entries.push({ path, data });
    } else if (type !== '5') {
      skipped++;
    }
  }
  return { entries, skipped };
}

function writeString(header: Uint8Array, value: string, start: number, length: number): void {
  header.set(encoder.encode(value).subarray(0, length), start);
}

function writeOctal(header: Uint8Array, value: number, start: number, length: number): void {
  writeString(header, `${value.toString(8).padStart(length - 1, '0')}\0`, start, length);
}

function headerBlock(
  name: string,
  size: number,
  type: string,
  mtime: number,
  prefix = '',
): Uint8Array {
  const header = new Uint8Array(BLOCK);
  writeString(header, name, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, mtime, 136, 12);
  header.fill(32, 148, 156);
  writeString(header, type, 156, 1);
  writeString(header, 'ustar\0', 257, 6);
  writeString(header, '00', 263, 2);
  writeString(header, prefix, 345, 155);
  let sum = 0;
  for (const byte of header) sum += byte;
  writeString(header, `${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return header;
}

function padded(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(data.length / BLOCK) * BLOCK);
  out.set(data);
  return out;
}

/** A pax extended-header record: "<length> <key>=<value>\n", where length counts itself. */
function paxRecord(key: string, value: string): Uint8Array {
  const body = encoder.encode(` ${key}=${value}\n`).length;
  let total = body + String(body).length;
  if (String(total).length !== String(body).length) total = body + String(total).length;
  return encoder.encode(`${total} ${key}=${value}\n`);
}

export function writeTar(entries: readonly TarEntry[], mtime = 946684800): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    let name = entry.path;
    let prefix = '';
    if (nameBytes.length > 100) {
      const slash = entry.path.lastIndexOf('/', entry.path.length - 1);
      const head = slash > 0 ? entry.path.slice(0, slash) : '';
      const tail = slash > 0 ? entry.path.slice(slash + 1) : entry.path;
      if (slash > 0 && encoder.encode(head).length <= 155 && encoder.encode(tail).length <= 100) {
        prefix = head;
        name = tail;
      } else {
        const record = paxRecord('path', entry.path);
        chunks.push(headerBlock('PaxHeader', record.length, 'x', mtime), padded(record));
        name = tail.slice(0, 100);
      }
    }
    chunks.push(headerBlock(name, entry.data.length, '0', mtime, prefix), padded(entry.data));
  }
  chunks.push(new Uint8Array(BLOCK * 2));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
