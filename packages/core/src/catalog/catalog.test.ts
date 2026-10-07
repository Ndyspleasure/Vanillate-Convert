import { describe, expect, it } from 'vitest';

import { catalog } from '../registry/default.ts';
import { validateCatalog } from './validate.ts';

describe('catalog', () => {
  it('passes schema, reference and expansion validation', () => {
    const result = validateCatalog(catalog);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('reports unknown references', () => {
    const broken = structuredClone(catalog);
    broken.rules[0] = { ...broken.rules[0]!, steps: ['no-such-engine'] };
    const result = validateCatalog(broken);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('unknown engine "no-such-engine"'))).toBe(
      true,
    );
  });

  it('rejects malformed signatures and duplicate ids', () => {
    const broken = structuredClone(catalog);
    broken.formats.push({ ...broken.formats[0]! });
    const result = validateCatalog(broken);
    expect(result.issues.some((i) => i.message.startsWith('duplicate id'))).toBe(true);

    const badHex = structuredClone(catalog);
    badHex.formats[0] = { ...badHex.formats[0]!, signatures: [[{ hex: 'FFD' }]] };
    expect(validateCatalog(badHex).ok).toBe(false);
  });

  it('rejects option references to missing choices', () => {
    const broken = structuredClone(catalog);
    const rule = broken.rules.find((r) => r.id === 'video.ffmpeg.gif')!;
    rule.options = [{ id: 'fps', choices: [999] }];
    const result = validateCatalog(broken);
    expect(result.issues.some((i) => i.message.includes('has no choice 999'))).toBe(true);
  });
});
