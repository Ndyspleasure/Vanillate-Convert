/**
 * Output validation and naming.
 *
 * Every engine output is checked before it is stored: it exists and is not empty, it fits the
 * size limits, its content really is the expected format (detected from its bytes, the same
 * rule browser processing uses), and images are within the pixel limit. Files whose format is
 * not known in advance (archive entries) get the detected format, or plain text / binary.
 */
import { stat } from 'node:fs/promises';

import {
  outputFilename,
  readImageDimensions,
  sameFamily,
  sanitizeFilename,
  VanillateError,
  type JobInput,
  type Registry,
} from '@vanillate/core';
import { detectFile, sampleFile, type PipelineOutput } from '@vanillate/engines';

export interface FinalOutput {
  path: string;
  name: string;
  format: string;
  mimeType: string;
  size: number;
}

export interface OutputLimits {
  maxOutputBytes: number;
  maxPixels: number;
}

function knownExtensions(registry: Registry): string[] {
  return registry.formats.flatMap((f) => f.extensions).filter((ext) => ext.includes('.'));
}

/** Makes names unique (case-insensitively): `a.txt`, `a (2).txt`, … */
function uniqueNames(): (name: string) => string {
  const used = new Set<string>();
  return (name) => {
    let candidate = name;
    const slash = name.lastIndexOf('/');
    const dir = name.slice(0, slash + 1);
    const file = name.slice(slash + 1);
    const dot = file.lastIndexOf('.');
    const stem = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : '';
    for (let n = 2; used.has(candidate.toLowerCase()); n++)
      candidate = `${dir}${stem} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
}

/** A relative path from an archive entry, each segment sanitized. */
export function entryName(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .map((segment) => sanitizeFilename(segment))
    .join('/');
}

async function detectedFormat(
  output: PipelineOutput,
  registry: Registry,
): Promise<{ format: string }> {
  const name = output.entryPath ?? null;
  const detection = await detectFile(output.path, registry, name);
  return { format: detection.format?.id ?? (detection.isText ? 'txt' : 'bin') };
}

async function checkContent(
  output: PipelineOutput & { format: string },
  registry: Registry,
  limits: OutputLimits,
): Promise<void> {
  const format = registry.requireFormat(output.format);
  // The expected extension lets text formats (Markdown, SRT, CSV…) be recognized by content.
  const detection = await detectFile(
    output.path,
    registry,
    `output.${format.extensions[0] ?? 'bin'}`,
  );
  if (!detection.format || !sameFamily(detection.format.id, output.format)) {
    throw new VanillateError('output-invalid', {
      detail: `expected ${output.format}, content detected as ${detection.format?.id ?? 'unknown'}`,
    });
  }
  if (format.category === 'image') {
    const size = readImageDimensions((await sampleFile(output.path)).head);
    if (size && size.width * size.height > limits.maxPixels) {
      throw new VanillateError('image-too-large', {
        detail: `output ${size.width}×${size.height}`,
      });
    }
  }
}

export async function finalizeOutputs(
  outputs: readonly PipelineOutput[],
  inputs: readonly JobInput[],
  registry: Registry,
  limits: OutputLimits,
): Promise<FinalOutput[]> {
  if (outputs.length === 0) throw new VanillateError('output-invalid', { detail: 'no outputs' });
  const extensions = knownExtensions(registry);
  const unique = uniqueNames();
  const results: FinalOutput[] = [];
  let total = 0;
  for (const output of outputs) {
    const info = await stat(output.path).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      throw new VanillateError('output-invalid', { detail: 'missing or empty output' });
    }
    total += info.size;
    if (info.size > limits.maxOutputBytes || total > limits.maxOutputBytes) {
      throw new VanillateError('output-too-large', { detail: `${total} bytes` });
    }
    const format =
      output.format === null
        ? (await detectedFormat(output, registry)).format
        : (await checkContent({ ...output, format: output.format }, registry, limits),
          output.format);
    const target = registry.requireFormat(format);
    const input = inputs[output.inputIndex] ?? inputs[0];
    const name = output.entryPath
      ? entryName(output.entryPath) || outputFilename('file', target)
      : outputFilename(
          input?.name ?? 'file',
          target,
          output.part ? { index: output.part.index - 1, total: output.part.total } : undefined,
          extensions,
        );
    results.push({
      path: output.path,
      name: unique(name),
      format,
      mimeType: target.mimeTypes[0] ?? 'application/octet-stream',
      size: info.size,
    });
  }
  return results;
}
