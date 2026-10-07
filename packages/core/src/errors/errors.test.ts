import { describe, expect, it } from 'vitest';

import type * as Codes from './codes.ts';
import { ERRORS, isErrorCode, toVanillateError, VanillateError } from './codes.ts';

describe('VanillateError', () => {
  it('maps codes to kind, status and localized public messages', () => {
    const error = new VanillateError('file-too-large', { detail: 'internal path /tmp/x' });
    expect(error.status).toBe(413);
    expect(error.kind).toBe('user');
    expect(error.toPublic('id')).toEqual({
      code: 'file-too-large',
      message: ERRORS['file-too-large'].message.id,
      retryable: false,
    });
    expect(JSON.stringify(error.toPublic())).not.toContain('/tmp/x');
  });

  it('is recognized across copies of the module (bundlers can duplicate packages)', async () => {
    // A query string makes the module loader evaluate a second, independent copy.
    const specifier = './codes.ts?copy';
    const copy = (await import(/* @vite-ignore */ specifier)) as typeof Codes;
    expect(copy.VanillateError).not.toBe(VanillateError);
    const foreign = new copy.VanillateError('unauthorized');
    expect(foreign instanceof VanillateError).toBe(true);
    expect(toVanillateError(foreign)).toBe(foreign);
    expect(new VanillateError('job-expired') instanceof copy.VanillateError).toBe(true);
  });

  it('does not mistake other errors for platform errors', () => {
    expect(new Error('unauthorized') instanceof VanillateError).toBe(false);
    expect({ name: 'VanillateError', code: 'unauthorized' } instanceof VanillateError).toBe(false);
    expect((null as unknown as object) instanceof VanillateError).toBe(false);
    const unknown = toVanillateError(new TypeError('boom'));
    expect(unknown.code).toBe('internal-error');
    expect(unknown.detail).toBe('TypeError: boom');
    expect(toVanillateError('text').code).toBe('internal-error');
  });

  it('keeps the brand out of serialized errors', () => {
    const error = new VanillateError('bad-request');
    expect(Object.keys(error)).not.toContain('Symbol(vanillate.error)');
    expect(JSON.parse(JSON.stringify(error))).not.toHaveProperty('brand');
  });

  it('knows its codes', () => {
    expect(isErrorCode('unauthorized')).toBe(true);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});
