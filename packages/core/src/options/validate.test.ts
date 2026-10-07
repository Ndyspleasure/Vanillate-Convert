import { describe, expect, it } from 'vitest';

import { getRegistry } from '../registry/default.ts';
import { defaultOptionValues, parsePageRange, validateOptions } from './validate.ts';

const registry = getRegistry();
const jpgRoute = registry.conversion('png', 'jpg')!.routes.find((r) => r.mode === 'server')!;
const gifRoute = registry.conversion('mp4', 'gif')!.routes[0]!;
const sqlRoute = registry.conversion('csv', 'sql')!.routes[0]!;

describe('validateOptions', () => {
  it('applies defaults and omits optional values without defaults', () => {
    const result = validateOptions(jpgRoute.options, {});
    expect(result).toEqual({ ok: true, values: { quality: 85, background: '#ffffff' } });
  });

  it('accepts and normalizes valid values (including numeric strings from forms)', () => {
    const result = validateOptions(jpgRoute.options, {
      quality: '70',
      width: 800,
      background: '#FFAA00',
    });
    expect(result).toEqual({
      ok: true,
      values: { quality: 70, width: 800, background: '#ffaa00' },
    });
  });

  it('rejects unknown keys, wrong types and out-of-range values', () => {
    const result = validateOptions(jpgRoute.options, {
      quality: 101,
      width: 1.5,
      background: 'red',
      shell: '$(rm -rf /)',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { id: 'shell', code: 'unknown' },
        { id: 'quality', code: 'range' },
        { id: 'width', code: 'type' },
        { id: 'background', code: 'type' },
      ]),
    );
  });

  it('enforces narrowed enum choices', () => {
    expect(validateOptions(gifRoute.options, { fps: 60 }).ok).toBe(false);
    expect(validateOptions(gifRoute.options, { fps: '12' })).toEqual({
      ok: true,
      values: { fps: 12, width: 480, loop: true },
    });
    expect(validateOptions(gifRoute.options, { width: 4000 }).ok).toBe(false);
  });

  it('enforces anchored patterns on text options (no SQL identifier injection)', () => {
    expect(validateOptions(sqlRoute.options, { sqlTable: 'users' }).ok).toBe(true);
    expect(validateOptions(sqlRoute.options, { sqlTable: 'users; DROP TABLE x' }).ok).toBe(false);
    expect(validateOptions(sqlRoute.options, { sqlTable: 'a'.repeat(65) }).ok).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(validateOptions(jpgRoute.options, 'quality=1').ok).toBe(false);
    expect(validateOptions(jpgRoute.options, [1]).ok).toBe(false);
    expect(validateOptions(jpgRoute.options, null).ok).toBe(true);
  });

  it('exposes defaults for settings forms', () => {
    expect(defaultOptionValues(gifRoute.options)).toEqual({ fps: 10, width: 480, loop: true });
  });
});

describe('parsePageRange', () => {
  it('parses lists and ranges', () => {
    expect(parsePageRange('1-3, 5')).toEqual([1, 2, 3, 5]);
    expect(parsePageRange('5,1,3-3')).toEqual([1, 3, 5]);
  });

  it('clamps to the page count', () => {
    expect(parsePageRange('2-10', 4)).toEqual([2, 3, 4]);
    expect(parsePageRange('9', 4)).toBeNull();
  });

  it('rejects malformed ranges', () => {
    expect(parsePageRange('0')).toBeNull();
    expect(parsePageRange('3-1')).toBeNull();
    expect(parsePageRange('a-b')).toBeNull();
    expect(parsePageRange('1-999999')).toBeNull();
  });
});
