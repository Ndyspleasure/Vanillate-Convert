/**
 * Magic-byte signature matching against the catalog's signature definitions.
 */
import type { Signature, SignatureCondition } from '../catalog/schema.ts';
import { asciiToBytes, hexToBytes, indexOfBytes } from '../util/bytes.ts';

export interface SignatureBytes {
  /** Bytes sampled from the start of the file. */
  head: Uint8Array;
  /** Bytes sampled from the end of the file (for negative offsets). */
  tail?: Uint8Array;
}

interface CompiledCondition {
  offset: number;
  bytes: Uint8Array;
  mask: Uint8Array | null;
  within: number | null;
}

const compiledCache = new WeakMap<SignatureCondition, CompiledCondition>();

function compile(condition: SignatureCondition): CompiledCondition {
  let compiled = compiledCache.get(condition);
  if (!compiled) {
    compiled = {
      offset: condition.offset ?? 0,
      bytes:
        condition.hex !== undefined
          ? hexToBytes(condition.hex)
          : asciiToBytes(condition.ascii ?? ''),
      mask: condition.mask !== undefined ? hexToBytes(condition.mask) : null,
      within: condition.within ?? null,
    };
    compiledCache.set(condition, compiled);
  }
  return compiled;
}

function matchAt(buffer: Uint8Array, at: number, { bytes, mask }: CompiledCondition): boolean {
  if (at < 0 || at + bytes.length > buffer.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    const actual = buffer[at + i] ?? 0;
    const expected = bytes[i] ?? 0;
    if (mask) {
      const m = mask[i] ?? 0xff;
      if ((actual & m) !== (expected & m)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

function matchCondition(condition: SignatureCondition, input: SignatureBytes): boolean {
  const compiled = compile(condition);
  if (compiled.offset < 0) {
    if (!input.tail) return false;
    return matchAt(input.tail, input.tail.length + compiled.offset, compiled);
  }
  if (compiled.within !== null) {
    return (
      indexOfBytes(
        input.head,
        compiled.bytes,
        compiled.offset,
        compiled.offset + compiled.within + compiled.bytes.length,
      ) >= 0
    );
  }
  return matchAt(input.head, compiled.offset, compiled);
}

/** Number of significant bytes in a signature; longer signatures are more specific. */
export function signatureStrength(signature: Signature): number {
  return signature.reduce((total, condition) => {
    const compiled = compile(condition);
    const significant = compiled.mask
      ? compiled.mask.reduce((n, m) => n + (m === 0xff ? 1 : 0.5), 0)
      : compiled.bytes.length;
    return total + significant;
  }, 0);
}

/** Returns the strength of the strongest matching signature, or 0. */
export function matchSignatures(signatures: readonly Signature[], input: SignatureBytes): number {
  let best = 0;
  for (const signature of signatures) {
    if (signature.every((condition) => matchCondition(condition, input))) {
      best = Math.max(best, signatureStrength(signature));
    }
  }
  return best;
}
