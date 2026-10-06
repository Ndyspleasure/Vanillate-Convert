/**
 * Worker tests: the full server pipeline (job service → storage → worker → engines → outputs)
 * with the in-memory store and storage. Real engines are used where installed; fake engines
 * cover cancellation, shutdown, retries and invalid outputs deterministically.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createLogger,
  detectFormat,
  getRegistry,
  type JobRecord,
  type Logger,
} from '@vanillate/core';
import {
  probeEngines,
  ProcessRunner,
  resolveSandbox,
  SERVER_ENGINES,
  type EngineSet,
  type ServerEngine,
} from '@vanillate/engines';
import { JobService, MemoryJobStore } from '@vanillate/jobs';
import { inputKey, MemoryStorage } from '@vanillate/storage';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { WorkerConfig } from '../src/config.ts';
import { Worker } from '../src/worker.ts';

const registry = getRegistry();
const quiet: Logger = createLogger({ level: 'error', sink: () => undefined });
const runner = new ProcessRunner({ sandbox: resolveSandbox(process.env.VANILLATE_SANDBOX) });
const probes = await probeEngines(runner);
const installed: EngineSet = Object.fromEntries(
  Object.entries(SERVER_ENGINES).filter(([id]) => probes[id]?.available),
);
const SLOW = 120_000;

let workRoot: string;
beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), 'vanillate-worker-'));
  return () => rm(workRoot, { recursive: true, force: true });
});

interface Harness {
  service: JobService;
  storage: MemoryStorage;
  store: MemoryJobStore;
  worker: Worker;
}

function harness(
  options: { engines?: EngineSet; config?: Partial<WorkerConfig>; runner?: ProcessRunner } = {},
): Harness {
  const store = new MemoryJobStore();
  const storage = new MemoryStorage();
  const service = new JobService({
    store,
    storage,
    registry,
    logger: quiet,
    requireWorkers: false,
  });
  const config: WorkerConfig = {
    id: 'test-worker',
    pools: ['image', 'media', 'document', 'archive', 'data', 'specialized'],
    concurrency: 2,
    workRoot,
    leaseSeconds: 3,
    pollMs: 50,
    sweepSeconds: 0,
    registerSeconds: 30,
    shutdownGraceMs: 100,
    sandbox: runner.sandbox,
    engineUser: null,
    disabledEngines: [],
    allowUnisolated: true,
    production: false,
    ...options.config,
  };
  const worker = new Worker({
    config,
    service,
    storage,
    registry,
    runner: options.runner ?? runner,
    engines: options.engines ?? installed,
    probes,
    logger: quiet,
  });
  return { service, storage, store, worker };
}

/** Creates a job and uploads its files like a client would. */
async function submit(
  h: Harness,
  target: { kind: 'conversion'; from: string; to: string } | { kind: 'tool'; toolId: string },
  files: { name: string; format: string; bytes: Uint8Array }[],
  options: Record<string, unknown> = {},
): Promise<{ id: string; token: string }> {
  const created = await h.service.createJob({
    target,
    options,
    files: files.map((f) => ({ name: f.name, format: f.format, size: f.bytes.length })),
    clientKey: 'test-client',
  });
  for (const [i, file] of files.entries()) {
    const input = created.job.inputs[i];
    if (!input) throw new Error('missing input');
    await h.storage.write(inputKey(created.job.id, input.id), file.bytes, {
      contentType: 'application/octet-stream',
      size: file.bytes.length,
    });
    await h.service.completeUpload(created.job.id, created.token, input.id);
  }
  return { id: created.job.id, token: created.token };
}

async function record(h: Harness, id: string): Promise<JobRecord> {
  const job = await h.store.get(id);
  if (!job) throw new Error('job vanished');
  return job;
}

async function readOutput(h: Harness, key: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = (await h.storage.read(key)).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function textPdf(text: string): Uint8Array {
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** A tiny valid PNG (1×1, opaque red). */
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64',
  ),
);

/** A fake engine standing in for ImageMagick, to drive the worker deterministically. */
function fakeImageEngine(
  behavior: (signal: AbortSignal, outDir: string) => Promise<string>,
): EngineSet {
  const engine: ServerEngine = {
    id: 'imagemagick',
    probe: () => Promise.resolve({ available: true, version: 'fake', binary: 'fake' }),
    run: async (request, ctx) => {
      const path = await behavior(ctx.signal, request.outDir);
      return [{ path, format: request.kind === 'convert' ? request.to : 'png' }];
    },
  };
  return { imagemagick: engine };
}

function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
      once: true,
    });
  });
}

afterEach(async () => {
  // Leave no job directories behind.
  const { readdir } = await import('node:fs/promises');
  expect(await readdir(workRoot)).toEqual([]);
});

describe.skipIf(!installed.imagemagick)('with real engines', () => {
  it('converts an uploaded image end to end and deletes the input', { timeout: SLOW }, async () => {
    const h = harness();
    const { id } = await submit(h, { kind: 'conversion', from: 'png', to: 'jpg' }, [
      { name: 'Holiday Photo.png', format: 'png', bytes: PNG },
    ]);
    expect(await h.worker.runOnce()).toBe(true);
    const job = await record(h, id);
    expect(job.status).toBe('completed');
    expect(job.outputs).toHaveLength(1);
    const output = job.outputs[0]!;
    expect(output).toMatchObject({
      name: 'Holiday Photo.jpg',
      format: 'jpg',
      mimeType: 'image/jpeg',
    });
    const bytes = await readOutput(h, output.storageKey);
    expect(detectFormat({ head: bytes, size: bytes.length }, registry).format?.id).toBe('jpg');
    expect(await h.storage.head(job.inputs[0]!.storageKey)).toBeNull();
  });

  it.skipIf(!installed.qpdf)('merges several PDFs into one output', { timeout: SLOW }, async () => {
    const h = harness();
    const { id } = await submit(h, { kind: 'tool', toolId: 'pdf-merger' }, [
      { name: 'part one.pdf', format: 'pdf', bytes: textPdf('One') },
      { name: 'part two.pdf', format: 'pdf', bytes: textPdf('Two') },
    ]);
    await h.worker.runOnce();
    const job = await record(h, id);
    expect(job.status).toBe('completed');
    expect(job.outputs.map((o) => o.name)).toEqual(['part one.pdf']);
  });

  it('fails a job whose input was swapped after verification', { timeout: SLOW }, async () => {
    const h = harness();
    const { id } = await submit(h, { kind: 'conversion', from: 'png', to: 'jpg' }, [
      { name: 'photo.png', format: 'png', bytes: PNG },
    ]);
    const job = await record(h, id);
    // Same size, different content: e.g. a second PUT with a still-valid upload URL.
    const swapped = new Uint8Array(PNG.length).fill(0x41);
    await h.storage.write(job.inputs[0]!.storageKey, swapped, {
      contentType: 'image/png',
      size: swapped.length,
    });
    await h.worker.runOnce();
    const after = await record(h, id);
    expect(after.status).toBe('failed');
    expect(after.error?.code).toBe('format-mismatch');
  });

  it('reports corrupt inputs without retrying', { timeout: SLOW }, async () => {
    const h = harness();
    const broken = new Uint8Array(64);
    broken.set(PNG.subarray(0, 33)); // valid signature and header, no image data
    const { id } = await submit(h, { kind: 'conversion', from: 'png', to: 'jpg' }, [
      { name: 'broken.png', format: 'png', bytes: broken },
    ]);
    await h.worker.runOnce();
    const job = await record(h, id);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(1);
    expect(job.error?.code).toMatch(/input-corrupt|conversion-failed/);
  });

  it.skipIf(typeof process.getuid !== 'function' || process.getuid() !== 0)(
    'runs engines as a separate unprivileged user',
    { timeout: SLOW },
    async () => {
      const h = harness({
        runner: new ProcessRunner({ sandbox: runner.sandbox, user: { uid: 65534, gid: 65534 } }),
      });
      const { id } = await submit(h, { kind: 'conversion', from: 'png', to: 'webp' }, [
        { name: 'photo.png', format: 'png', bytes: PNG },
      ]);
      await h.worker.runOnce();
      const job = await record(h, id);
      expect(job.error).toBeNull();
      expect(job.status).toBe('completed');
      if (installed.libreoffice) {
        // LibreOffice writes a profile and HOME files: the most permission-sensitive engine.
        const doc = await submit(h, { kind: 'conversion', from: 'txt', to: 'pdf' }, [
          { name: 'notes.txt', format: 'txt', bytes: new TextEncoder().encode('Hello\n') },
        ]);
        await h.worker.runOnce();
        const converted = await record(h, doc.id);
        expect(converted.error).toBeNull();
        expect(converted.outputs.map((o) => o.name)).toEqual(['notes.pdf']);
      }
    },
  );
});

describe('worker control flow', () => {
  it('only claims jobs whose engines are installed here', async () => {
    const h = harness({ engines: {} });
    await submit(h, { kind: 'conversion', from: 'png', to: 'jpg' }, [
      { name: 'photo.png', format: 'png', bytes: PNG },
    ]);
    expect(await h.worker.runOnce()).toBe(false);
  });

  it('stops the engine as soon as the user cancels', async () => {
    let aborted = false;
    const h = harness({
      engines: fakeImageEngine(async (signal) => {
        await untilAborted(signal).catch((error: unknown) => {
          aborted = true;
          throw error;
        });
        return '';
      }),
    });
    const { id, token } = await submit(h, { kind: 'conversion', from: 'png', to: 'jpg' }, [
      { name: 'photo.png', format: 'png', bytes: PNG },
    ]);
    const running = h.worker.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await h.service.cancelJob(id, token);
    await running; // the heartbeat (every second here) notices the cancellation
    expect(aborted).toBe(true);
    expect((await record(h, id)).status).toBe('cancelled');
  });

  it('requeues running jobs when shutting down', async () => {
    const h = harness({
      engines: fakeImageEngine(async (signal) => untilAborted(signal)),
    });
    const { id } = await submit(h, { kind: 'conversion', from: 'png', to: 'jpg' }, [
      { name: 'photo.png', format: 'png', bytes: PNG },
    ]);
    await h.worker.start();
    for (let i = 0; i < 50 && (await record(h, id)).status !== 'processing'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await h.worker.stop();
    const job = await record(h, id);
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(1);
    expect(job.workerId).toBeNull();
  });

  it('retries unexpected failures with backoff', async () => {
    const h = harness({
      engines: fakeImageEngine(() => Promise.reject(new Error('engine crashed'))),
    });
    const { id } = await submit(h, { kind: 'conversion', from: 'png', to: 'jpg' }, [
      { name: 'photo.png', format: 'png', bytes: PNG },
    ]);
    await h.worker.runOnce();
    const job = await record(h, id);
    expect(job.status).toBe('queued');
    expect(new Date(job.runAfter).getTime()).toBeGreaterThan(Date.now() + 20_000);
  });

  it('rejects outputs whose content is not the promised format', async () => {
    const h = harness({
      engines: fakeImageEngine(async (_signal, outDir) => {
        const path = join(outDir, 'output.jpg');
        await writeFile(path, 'definitely not a JPEG');
        return path;
      }),
    });
    const { id } = await submit(h, { kind: 'conversion', from: 'png', to: 'jpg' }, [
      { name: 'photo.png', format: 'png', bytes: PNG },
    ]);
    await h.worker.runOnce();
    const job = await record(h, id);
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('output-invalid');
    expect(job.outputs).toEqual([]);
  });
});

describe('output names', () => {
  it('labels multi-file outputs after the input', async () => {
    const { labelledName, entryName } = await import('../src/outputs.ts');
    expect(labelledName('Annual Report.pdf', 'page-3', { extensions: ['png'] }, [])).toBe(
      'Annual Report-page-3.png',
    );
    expect(labelledName('archive.tar.gz', 'page-1', { extensions: ['png'] }, ['tar.gz'])).toBe(
      'archive-page-1.png',
    );
    expect(entryName('../x/./a<b>.txt')).toBe('x/a_b_.txt');
  });
});
