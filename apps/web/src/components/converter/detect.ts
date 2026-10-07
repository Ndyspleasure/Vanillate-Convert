/**
 * Format detection in the browser: reads only the head and tail of each file (never the whole
 * file) and recognizes `.tar.gz` by inflating the first bytes.
 */
import { DETECT_HEAD_BYTES, DETECT_TAIL_BYTES, detectFormat, type Registry } from '@vanillate/core';

export interface FileDetection {
  format: string | null;
  isText: boolean;
}

async function inflatedHead(head: Uint8Array): Promise<Uint8Array | null> {
  if (head[0] !== 0x1f || head[1] !== 0x8b || typeof DecompressionStream === 'undefined') {
    return null;
  }
  try {
    const stream = new Blob([head as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < 1024) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => undefined);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return total > 0 ? out : null;
  } catch {
    return null;
  }
}

export async function detectBrowserFile(file: File, registry: Registry): Promise<FileDetection> {
  const head = new Uint8Array(await file.slice(0, DETECT_HEAD_BYTES).arrayBuffer());
  const tail =
    file.size > DETECT_HEAD_BYTES
      ? new Uint8Array(await file.slice(Math.max(0, file.size - DETECT_TAIL_BYTES)).arrayBuffer())
      : head;
  const result = detectFormat(
    {
      name: file.name,
      mimeType: file.type || null,
      size: file.size,
      head,
      tail,
      inflatedHead: await inflatedHead(head),
    },
    registry,
  );
  return { format: result.format?.id ?? null, isText: result.isText };
}
