/**
 * @vanillate/browser-engines — conversions that run entirely in the user's browser.
 *
 * `runBrowserTask` dispatches to the engine named by the route and validates every output
 * (non-empty, expected format confirmed by content detection, size limits) before it is
 * handed to the user.
 */
import { detectFormat, sameFamily, VanillateError, type Registry } from '@vanillate/core';

import { archiveEngine } from './archive/engine.ts';
import { dataEngine } from './data/engine.ts';
import { imageEngine } from './image/engine.ts';
import { subtitleEngine } from './subtitle/engine.ts';
import { textEngine } from './text/engine.ts';
import type { BrowserEngine, BrowserOutputFile, BrowserTask, TaskContext } from './types.ts';

export type * from './types.ts';
export { throwIfAborted } from './types.ts';
export { detectImageSupport, type ImageSupport } from './image/engine.ts';

export const BROWSER_ENGINES: Readonly<Record<string, BrowserEngine>> = {
  'browser-image': imageEngine,
  'browser-data': dataEngine,
  'browser-subtitle': subtitleEngine,
  'browser-archive': archiveEngine,
  'browser-text': textEngine,
};

/** Whether a task must run on the main thread (SVG decoding needs the DOM). */
export function needsMainThread(task: Pick<BrowserTask, 'engine' | 'inputs'>): boolean {
  return task.engine === 'browser-image' && task.inputs.some((input) => input.format === 'svg');
}

function expectedFormat(task: BrowserTask, registry: Registry, inputFormat: string): string | null {
  if (task.kind === 'conversion') return task.to;
  const tool = registry.tool(task.toolId);
  if (!tool || tool.output === 'detect') return null;
  return tool.output === 'same' ? inputFormat : tool.output;
}

function categoryOf(task: BrowserTask, registry: Registry): string {
  if (task.kind === 'tool') return registry.tool(task.toolId)?.category ?? 'data';
  return registry.format(task.from)?.category ?? 'data';
}

export function validateOutputs(
  task: BrowserTask,
  outputs: readonly BrowserOutputFile[],
  registry: Registry,
): void {
  if (outputs.length === 0) throw new VanillateError('output-invalid', { detail: 'no outputs' });
  const limits = registry.limitsFor(
    'browser',
    categoryOf(task, registry) as Parameters<Registry['limitsFor']>[1],
  );
  const total = outputs.reduce((sum, output) => sum + output.bytes.length, 0);
  if (total > limits.maxOutputBytes) throw new VanillateError('output-too-large');
  const inputFormat = task.inputs[0]?.format ?? '';
  const expected = expectedFormat(task, registry, inputFormat);
  for (const output of outputs) {
    if (expected === null) continue; // detected outputs (archive extraction, Base64 decoding)
    if (output.bytes.length === 0)
      throw new VanillateError('output-invalid', { detail: `${output.name} is empty` });
    if (output.format !== expected) {
      throw new VanillateError('output-invalid', {
        detail: `expected ${expected}, engine produced ${output.format}`,
      });
    }
    const detection = detectFormat(
      {
        name: output.name,
        size: output.bytes.length,
        head: output.bytes.subarray(0, 65536),
        tail: output.bytes.subarray(Math.max(0, output.bytes.length - 65536)),
      },
      registry,
    );
    if (!detection.format || !sameFamily(detection.format.id, expected)) {
      throw new VanillateError('output-invalid', {
        detail: `${output.name}: content detected as ${detection.format?.id ?? 'unknown'}, expected ${expected}`,
      });
    }
  }
}

export async function runBrowserTask(
  task: BrowserTask,
  ctx: TaskContext,
): Promise<BrowserOutputFile[]> {
  const engine = BROWSER_ENGINES[task.engine];
  if (!engine)
    throw new VanillateError('conversion-unsupported', {
      detail: `unknown browser engine ${task.engine}`,
    });
  ctx.progress(0);
  const outputs = await engine(task, ctx);
  validateOutputs(task, outputs, ctx.registry);
  ctx.progress(1);
  return outputs;
}
