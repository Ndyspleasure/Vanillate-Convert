/**
 * Executes registry routes with server engines.
 *
 * A conversion route is a chain of steps (`docx → pdf → png`); each step's outputs become the
 * next step's inputs. Files are processed one at a time unless the route combines them
 * (`n:1`, e.g. images → one PDF). Intermediate files stay in the job's temporary directory.
 * Every output records which input it came from, so it can be named after it.
 */
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { VanillateError, type OptionValues, type Route, type ToolRoute } from '@vanillate/core';

import type { EngineContext, EngineFile, EngineOutput, ServerEngine } from './types.ts';

export type EngineSet = Readonly<Record<string, ServerEngine>>;

export interface PipelineOutput extends EngineOutput {
  /** Index of the job input this output was produced from (0 for combined outputs). */
  inputIndex: number;
}

function engineFor(engines: EngineSet, id: string): ServerEngine {
  const engine = engines[id];
  if (!engine) {
    throw new VanillateError('server-unavailable', { detail: `engine ${id} not installed` });
  }
  return engine;
}

function scoped(ctx: EngineContext, start: number, end: number): EngineContext {
  return {
    ...ctx,
    progress: (fraction) =>
      ctx.progress(start + (end - start) * Math.min(1, Math.max(0, fraction))),
  };
}

interface Tracked {
  file: EngineFile;
  inputIndex: number;
}

export async function executeConversion(
  route: Route,
  inputs: readonly EngineFile[],
  options: OptionValues,
  outDir: string,
  ctx: EngineContext,
  engines: EngineSet,
): Promise<PipelineOutput[]> {
  if (route.mode !== 'server') {
    throw new VanillateError('bad-request', { detail: 'not a server route' });
  }
  let current: Tracked[] = inputs.map((file, inputIndex) => ({ file, inputIndex }));
  let outputs: PipelineOutput[] = [];
  const steps = route.steps.length;
  for (const [index, step] of route.steps.entries()) {
    const last = index === steps - 1;
    const stepDir = last ? outDir : join(ctx.workDir, 'tmp', `step-${index + 1}`);
    const engine = engineFor(engines, step.engine);
    const combine = route.cardinality === 'n:1';
    const batches: Tracked[][] = combine ? [current] : current.map((item) => [item]);
    outputs = [];
    for (const [b, batch] of batches.entries()) {
      const batchCtx = scoped(
        ctx,
        (index + b / batches.length) / steps,
        (index + (b + 1) / batches.length) / steps,
      );
      // Separate directories keep engines' fixed output names from colliding.
      const dir = batches.length > 1 ? join(stepDir, `file-${b + 1}`) : stepDir;
      await mkdir(dir, { recursive: true });
      const produced = await engine.run(
        {
          kind: 'convert',
          from: step.from,
          to: step.to,
          options,
          inputs: batch.map((item) => item.file),
          outDir: dir,
        },
        batchCtx,
      );
      const inputIndex = combine ? 0 : (batch[0]?.inputIndex ?? 0);
      outputs.push(...produced.map((output) => ({ ...output, inputIndex })));
    }
    if (!last) {
      current = await Promise.all(
        outputs.map(async (output): Promise<Tracked> => ({
          inputIndex: output.inputIndex,
          file: {
            path: output.path,
            name: inputs[output.inputIndex]?.name ?? 'file',
            format: output.format ?? step.to,
            size: (await stat(output.path)).size,
          },
        })),
      );
    }
  }
  return outputs;
}

export async function executeTool(
  route: ToolRoute,
  inputs: readonly EngineFile[],
  options: OptionValues,
  outDir: string,
  ctx: EngineContext,
  engines: EngineSet,
  combine: boolean,
): Promise<PipelineOutput[]> {
  if (route.mode !== 'server') {
    throw new VanillateError('bad-request', { detail: 'not a server route' });
  }
  const engine = engineFor(engines, route.engine);
  const batches = combine ? [[...inputs]] : inputs.map((file) => [file]);
  const outputs: PipelineOutput[] = [];
  for (const [b, batch] of batches.entries()) {
    const dir = batches.length > 1 ? join(outDir, `file-${b + 1}`) : outDir;
    await mkdir(dir, { recursive: true });
    const produced = await engine.run(
      { kind: 'operation', operation: route.operation, options, inputs: batch, outDir: dir },
      scoped(ctx, b / batches.length, (b + 1) / batches.length),
    );
    outputs.push(...produced.map((output) => ({ ...output, inputIndex: combine ? 0 : b })));
  }
  return outputs;
}
