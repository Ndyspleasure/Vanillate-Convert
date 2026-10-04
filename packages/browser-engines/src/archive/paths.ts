/**
 * Archive entry path normalization. Rejects traversal (`..`) and keeps paths relative, so
 * re-packed archives never carry dangerous paths to the user's own extraction tools.
 */
export class UnsafeEntryError extends Error {
  override name = 'UnsafeEntryError';
}

export function normalizeEntryPath(raw: string, maxLength: number): string | null {
  let path = raw.replace(/\\/g, '/');
  path = path.replace(/^[a-zA-Z]:\//, ''); // drive letters
  path = path.replace(/^\/+/, ''); // absolute paths become relative
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') throw new UnsafeEntryError(`entry "${raw}" escapes the archive`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(segment))
      throw new UnsafeEntryError(`entry "${raw}" contains control characters`);
    segments.push(segment);
  }
  const normalized = segments.join('/');
  if (normalized.length > maxLength)
    throw new UnsafeEntryError(`entry path is longer than ${maxLength} characters`);
  return normalized === '' ? null : normalized;
}

/** Makes paths unique within an archive: `a.txt`, `a (2).txt`, ... */
export function uniquePaths(): (path: string) => string {
  const used = new Set<string>();
  return (path: string) => {
    if (!used.has(path.toLowerCase())) {
      used.add(path.toLowerCase());
      return path;
    }
    const slash = path.lastIndexOf('/');
    const dir = path.slice(0, slash + 1);
    const file = path.slice(slash + 1);
    const dot = file.lastIndexOf('.');
    const stem = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : '';
    for (let n = 2; ; n++) {
      const candidate = `${dir}${stem} (${n})${ext}`;
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase());
        return candidate;
      }
    }
  };
}
