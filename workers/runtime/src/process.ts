/**
 * Processes one claimed job:
 *
 *   resolve route ─▶ prepare job directory ─▶ download inputs (exact size) ─▶ re-check formats
 *   ─▶ run engines ─▶ validate + name outputs ─▶ upload ─▶ complete
 *
 * Inputs are re-checked here even though the API verified them at upload time: the worker must
 * not trust anything that crossed the storage boundary. The job directory is private to the
 * job and always removed afterwards.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, chown, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import {
  sameFamily,
  VanillateError,
  type CategoryId,
  type JobRecord,
  type Logger,
  type Registry,
  type Route,
  type ToolRoute,
} from '@vanillate/core';
import {
  detectFile,
  executeConversion,
  executeTool,
  type EngineContext,
  type EngineFile,
  type EngineLimits,
  type EngineSet,
  type PipelineOutput,
  type ProcessRunner,
} from '@vanillate/engines';
import { outputRecord, type JobService } from '@vanillate/jobs';
import type { Storage } from '@vanillate/storage';

import { finalizeOutputs } from './outputs.ts';

export interface ProcessDeps {
  service: JobService;
  storage: Storage;
  registry: Registry;
  runner: ProcessRunner;
  engines: EngineSet;
  binaries: Readonly<Record<string, string>>;
  logger: Logger;
  workerId: string;
  workRoot: string;
}

type ResolvedJob = ({ kind: 'conversion'; route: Route } | { kind: 'tool'; route: ToolRoute }) & {
  category: CategoryId;
  /** Tools accepting any file skip the input format check. */
  anyInput: boolean;
  combine: boolean;
};

function resolveJob(job: JobRecord, registry: Registry): ResolvedJob {
  if (job.target.kind === 'conversion') {
    const route = registry.route(job.target.routeId);
    if (!route?.offered || route.mode !== 'server') {
      throw new VanillateError('conversion-unsupported', {
        detail: `route ${job.target.routeId} is no longer offered`,
      });
    }
    return {
      kind: 'conversion',
      route,
      category: registry.requireFormat(route.from).category,
      anyInput: false,
      combine: route.cardinality === 'n:1',
    };
  }
  const tool = registry.tool(job.target.toolId);
  const route = registry.toolRoute(job.target.routeId);
  if (!tool || !route?.offered || route.mode !== 'server') {
    throw new VanillateError('conversion-unsupported', {
      detail: `tool route ${job.target.routeId} is no longer offered`,
    });
  }
  return {
    kind: 'tool',
    route,
    category: tool.category,
    anyInput: route.inputs.includes('*'),
    combine: tool.cardinality === 'n:1',
  };
}

/** Creates the job directory; with a separate engine user, it owns the writable parts. */
async function prepareWorkDir(dir: string, runner: ProcessRunner): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const sub of ['in', 'out', 'tmp', 'home']) await mkdir(join(dir, sub), { mode: 0o700 });
  if (runner.user) {
    for (const path of [dir, join(dir, 'out'), join(dir, 'tmp'), join(dir, 'home')]) {
      await chown(path, runner.user.uid, runner.user.gid);
    }
    // Inputs stay owned by the worker but readable by the engine user.
    await chmod(join(dir, 'in'), 0o755);
  }
}

/** Streams an input from storage to disk, refusing anything but the exact declared size. */
async function download(
  storage: Storage,
  key: string,
  size: number,
  path: string,
  signal: AbortSignal,
): Promise<void> {
  let body: ReadableStream<Uint8Array>;
  try {
    body = await storage.read(key);
  } catch (error) {
    throw new VanillateError('storage-error', { detail: 'input download failed', cause: error });
  }
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      // A size mismatch at this point is not transient: do not retry it.
      callback(
        received > size ? new VanillateError('upload-incomplete', { retryable: false }) : null,
        chunk,
      );
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(body as WebReadableStream<Uint8Array>),
      counter,
      createWriteStream(path, { flags: 'wx', mode: 0o644 }),
      { signal },
    );
  } catch (error) {
    if (error instanceof VanillateError || signal.aborted) throw error;
    throw new VanillateError('storage-error', { detail: 'input download failed', cause: error });
  }
  if (received !== size) {
    throw new VanillateError('upload-incomplete', {
      detail: `${received} of ${size} bytes`,
      retryable: false,
    });
  }
}

/**
 * Runs a claimed job to completion (or throws). Completing the job, and deleting the inputs,
 * happens here; failure handling belongs to the caller, which knows why it stopped.
 */
export async function processJob(
  job: JobRecord,
  deps: ProcessDeps,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const { registry, storage } = deps;
  const resolved = resolveJob(job, registry);
  const modeLimits = registry.limitsFor('server', resolved.category);
  const media = registry.mediaLimits;
  const limits: EngineLimits = {
    maxOutputBytes: modeLimits.maxOutputBytes,
    maxPixels: media.maxPixels,
    maxPages: media.maxPages,
    maxDurationSeconds: media.maxDurationSeconds,
    archive: registry.archiveLimits,
  };
  const workDir = join(deps.workRoot, `${job.id}-${job.attempts}`);
  // Whole-job deadline (downloads and uploads included), with a margin over the engine budget.
  const deadline = AbortSignal.timeout((modeLimits.maxJobSeconds + 120) * 1000);
  const jobSignal = AbortSignal.any([signal, deadline]);
  await rm(workDir, { recursive: true, force: true });
  await prepareWorkDir(workDir, deps.runner);
  try {
    await run();
  } catch (error) {
    if (deadline.aborted && !signal.aborted) {
      throw new VanillateError('conversion-timeout', { detail: 'job deadline exceeded' });
    }
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch((error: unknown) =>
      deps.logger.warn('workdir.cleanup_failed', { jobId: job.id, error }),
    );
  }

  async function run(): Promise<void> {
    // ---- inputs
    const inputs: EngineFile[] = [];
    for (const input of job.inputs) {
      const path = join(workDir, 'in', input.id);
      await download(storage, input.storageKey, input.size, path, jobSignal);
      if (!resolved.anyInput) {
        const detection = await detectFile(path, registry, input.name);
        if (!detection.format || !sameFamily(detection.format.id, input.format)) {
          throw new VanillateError('format-mismatch', {
            detail: `declared ${input.format}, detected ${detection.format?.id ?? 'unknown'}`,
          });
        }
      }
      inputs.push({ path, name: input.name, format: input.format, size: input.size });
    }
    onProgress(0.05);

    // ---- engines
    const ctx: EngineContext = {
      runner: deps.runner,
      workDir,
      signal: jobSignal,
      deadline: Date.now() + modeLimits.maxJobSeconds * 1000,
      limits,
      registry,
      binaries: deps.binaries,
      progress: (fraction) => onProgress(0.05 + 0.85 * Math.min(1, Math.max(0, fraction))),
    };
    const outDir = join(workDir, 'out');
    const produced: PipelineOutput[] =
      resolved.kind === 'conversion'
        ? await executeConversion(resolved.route, inputs, job.options, outDir, ctx, deps.engines)
        : await executeTool(
            resolved.route,
            inputs,
            job.options,
            outDir,
            ctx,
            deps.engines,
            resolved.combine,
          );

    // ---- outputs
    const outputs = await finalizeOutputs(produced, job.inputs, registry, {
      maxOutputBytes: modeLimits.maxOutputBytes,
      maxPixels: media.maxPixels,
    });
    onProgress(0.92);
    const records = [];
    try {
      for (const output of outputs) {
        const record = outputRecord(
          job.id,
          output.name,
          output.format,
          output.mimeType,
          output.size,
        );
        records.push(record);
        await storage.write(
          record.storageKey,
          Readable.toWeb(createReadStream(output.path)) as ReadableStream<Uint8Array>,
          { contentType: output.mimeType, size: output.size },
        );
      }
    } catch (error) {
      await storage.deleteMany(records.map((r) => r.storageKey)).catch(() => undefined);
      throw new VanillateError('storage-error', { detail: 'output upload failed', cause: error });
    }
    const completed = await deps.service.complete(job, deps.workerId, records);
    if (!completed) {
      deps.logger.info('job.discarded', { jobId: job.id, reason: 'lease lost or cancelled' });
    }
  }
}
