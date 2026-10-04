import { getRegistry } from '@vanillate/core';

import {
  runBrowserTask,
  type BrowserOutputFile,
  type BrowserTask,
  type TaskContext,
} from '../src/index.ts';

export const registry = getRegistry();
export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

export function ctx(): TaskContext {
  return { registry, signal: new AbortController().signal, progress: () => undefined };
}

export function file(name: string, content: string | Uint8Array, format: string) {
  return { name, bytes: typeof content === 'string' ? encoder.encode(content) : content, format };
}

/** Runs a conversion through the real registry route (options validated like the UI does). */
export async function convert(
  from: string,
  to: string,
  content: string | Uint8Array,
  options: Record<string, unknown> = {},
  name = `input.${registry.requireFormat(from).extensions[0]}`,
): Promise<BrowserOutputFile[]> {
  const conversion = registry.conversion(from, to);
  const route = conversion?.routes.find((r) => r.mode === 'browser' && r.offered);
  if (!route) throw new Error(`no browser route ${from} → ${to}`);
  const defaults = Object.fromEntries(
    route.options.filter((o) => o.default !== null).map((o) => [o.id, o.default]),
  );
  const task: BrowserTask = {
    kind: 'conversion',
    routeId: route.id,
    engine: route.engines[0]!,
    from,
    to,
    options: { ...defaults, ...options } as BrowserTask['options'],
    inputs: [file(name, content, from)],
  };
  return runBrowserTask(task, ctx());
}

export async function tool(
  toolId: string,
  inputs: { name: string; content: string | Uint8Array; format: string }[],
  options: Record<string, unknown> = {},
): Promise<BrowserOutputFile[]> {
  const t = registry.tool(toolId);
  const route = t?.routes.find((r) => r.mode === 'browser');
  if (!t || !route) throw new Error(`no browser route for ${toolId}`);
  const defaults = Object.fromEntries(
    route.options.filter((o) => o.default !== null).map((o) => [o.id, o.default]),
  );
  return runBrowserTask(
    {
      kind: 'tool',
      routeId: route.id,
      engine: route.engine,
      toolId,
      operation: route.operation,
      options: { ...defaults, ...options } as BrowserTask['options'],
      inputs: inputs.map((i) => file(i.name, i.content, i.format)),
    },
    ctx(),
  );
}

export const text = (output: BrowserOutputFile | undefined): string =>
  decoder.decode(output?.bytes);
