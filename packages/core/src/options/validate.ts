/**
 * Strict validation of user-supplied conversion options against a route's option
 * definitions.
 *
 * Only declared options are accepted; values are type-checked, range-checked and matched
 * against enum choices or anchored patterns. Engines receive the returned `values` object
 * only, so no raw user string ever reaches a command line unchecked.
 */
import type { OptionDef, OptionValue } from '../registry/types.ts';

export type OptionErrorCode =
  'unknown' | 'type' | 'range' | 'choice' | 'pattern' | 'length' | 'required';

export interface OptionError {
  id: string;
  code: OptionErrorCode;
}

export type OptionValues = Record<string, OptionValue>;

export type OptionValidation =
  { ok: true; values: OptionValues } | { ok: false; errors: OptionError[] };

const COLOR = /^#[0-9a-f]{6}$/i;

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return null;
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/** Validates one value. Returns the normalized value or an error code. */
export function validateOptionValue(
  def: OptionDef,
  raw: unknown,
): { value: OptionValue } | { error: OptionErrorCode } {
  switch (def.type) {
    case 'boolean': {
      const value = coerceBoolean(raw);
      return value === null ? { error: 'type' } : { value };
    }
    case 'integer':
    case 'number': {
      const value = coerceNumber(raw);
      if (value === null) return { error: 'type' };
      if (def.type === 'integer' && !Number.isInteger(value)) return { error: 'type' };
      if ((def.min !== null && value < def.min) || (def.max !== null && value > def.max))
        return { error: 'range' };
      return { value };
    }
    case 'enum': {
      const choice = def.choices?.find(
        (c) => c.value === raw || (typeof c.value === 'number' && coerceNumber(raw) === c.value),
      );
      return choice ? { value: choice.value } : { error: 'choice' };
    }
    case 'color': {
      if (typeof raw !== 'string' || !COLOR.test(raw)) return { error: 'type' };
      return { value: raw.toLowerCase() };
    }
    case 'text': {
      if (typeof raw !== 'string') return { error: 'type' };
      if (def.maxLength !== null && raw.length > def.maxLength) return { error: 'length' };
      if (def.pattern !== null && !new RegExp(def.pattern).test(raw)) return { error: 'pattern' };
      return { value: raw };
    }
  }
}

function isBlank(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

/**
 * Validates an options object. Missing or blank values fall back to the option default;
 * options without a default (e.g. width) are simply omitted.
 */
export function validateOptions(defs: readonly OptionDef[], input: unknown): OptionValidation {
  if (
    input !== undefined &&
    input !== null &&
    (typeof input !== 'object' || Array.isArray(input))
  ) {
    return { ok: false, errors: [{ id: '*', code: 'type' }] };
  }
  const raw = (input ?? {}) as Record<string, unknown>;
  const byId = new Map(defs.map((d) => [d.id, d]));
  const errors: OptionError[] = [];
  for (const key of Object.keys(raw)) {
    if (!byId.has(key)) errors.push({ id: key, code: 'unknown' });
  }
  const values: OptionValues = {};
  for (const def of defs) {
    const value = raw[def.id];
    if (isBlank(value)) {
      if (def.default !== null) values[def.id] = def.default;
      continue;
    }
    const result = validateOptionValue(def, value);
    if ('error' in result) errors.push({ id: def.id, code: result.error });
    else values[def.id] = result.value;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** The defaults of a set of options, as the initial state of a settings form. */
export function defaultOptionValues(defs: readonly OptionDef[]): OptionValues {
  const values: OptionValues = {};
  for (const def of defs) if (def.default !== null) values[def.id] = def.default;
  return values;
}

/**
 * Parses a page range such as `1-3, 5` into sorted, de-duplicated 1-based page numbers,
 * clamped to `pageCount` when given. Returns null when the range selects no valid page.
 */
export function parsePageRange(range: string, pageCount?: number): number[] | null {
  const pages = new Set<number>();
  for (const part of range.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const match = /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(trimmed);
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] !== undefined ? Number(match[2]) : start;
    if (start < 1 || end < start) return null;
    const last = pageCount !== undefined ? Math.min(end, pageCount) : end;
    if (last - start > 100_000) return null;
    for (let page = start; page <= last; page++) pages.add(page);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  return sorted.length > 0 ? sorted : null;
}
