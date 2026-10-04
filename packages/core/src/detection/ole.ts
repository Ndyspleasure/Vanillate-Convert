/**
 * OLE2 Compound File detection (legacy Office: DOC, XLS, PPT).
 *
 * The directory sector holding stream names can be anywhere in the file; for typical files it
 * is close to the start or the end, so names are searched as UTF-16LE in the head and tail.
 */
import { indexOfBytes, utf16leBytes } from '../util/bytes.ts';

export const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

export function isOle(head: Uint8Array): boolean {
  return OLE_SIGNATURE.every((byte, i) => head[i] === byte);
}

export function oleHasStream(name: string, head: Uint8Array, tail?: Uint8Array): boolean {
  const needle = utf16leBytes(name);
  // Directory entries store the name followed by a NUL terminator (UTF-16).
  const terminated = new Uint8Array(needle.length + 2);
  terminated.set(needle);
  if (indexOfBytes(head, terminated) >= 0) return true;
  return tail !== undefined && indexOfBytes(tail, terminated) >= 0;
}
