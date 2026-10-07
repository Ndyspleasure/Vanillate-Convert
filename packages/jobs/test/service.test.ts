import { createLogger, getRegistry, VanillateError } from '@vanillate/core';
import { MemoryStorage } from '@vanillate/storage';
import { beforeEach, describe, expect, it } from 'vitest';

import { JobService, MemoryJobStore, outputRecord } from '../src/index.ts';

const registry = getRegistry();
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
  0, 0, 0, 1,
]);

let clock = new Date('2026-05-01T08:00:00Z');
let store: MemoryJobStore;
let storage: MemoryStorage;
let service: JobService;

async function registerWorker(
  engines: string[] = ['imagemagick'],
  pools: ('image' | 'document' | 'media')[] = ['image'],
) {
  await service.registerWorker({
    id: 'worker-1',
    pools,
    engines: Object.fromEntries(engines.map((e) => [e, { available: true, version: '1' }])),
    version: 'test',
    startedAt: clock.toISOString(),
  });
}

function code(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof VanillateError ? error.code : String(error)),
  );
}

async function createPngJob(clientKey = 'client-a') {
  return service.createJob({
    target: { kind: 'conversion', from: 'png', to: 'jpg' },
    options: { quality: 70 },
    files: [{ name: '../secret/photo.png', size: PNG.length, format: 'png' }],
    clientKey,
  });
}

beforeEach(async () => {
  clock = new Date('2026-05-01T08:00:00Z');
  store = new MemoryJobStore();
  storage = new MemoryStorage();
  service = new JobService({
    store,
    storage,
    registry,
    logger: createLogger({ level: 'error' }),
    now: () => clock,
  });
  await registerWorker();
});

describe('createJob', () => {
  it('creates a pending job with upload URLs and a one-time token', async () => {
    const result = await createPngJob();
    expect(result.job).toMatchObject({
      status: 'pending',
      target: { kind: 'conversion', from: 'png', to: 'jpg' },
    });
    expect(result.job.inputs).toEqual([
      {
        id: expect.stringMatching(/^in_/),
        name: 'photo.png',
        size: PNG.length,
        format: 'png',
        uploaded: false,
      },
    ]);
    expect(result.uploads[0]!.request.headers['content-type']).toBe('image/png');
    expect(result.token).toMatch(/^[\w-]{43}$/);
    const record = await store.get(result.job.id);
    expect(record?.tokenHash).not.toContain(result.token);
    expect(record?.options).toEqual({ quality: 70, background: '#ffffff' });
    expect(record?.engines).toEqual(['imagemagick']);
  });

  it('validates routes, formats, limits and options', async () => {
    const base = { clientKey: 'c', options: {} };
    expect(
      await code(
        service.createJob({
          ...base,
          target: { kind: 'conversion', from: 'png', to: 'mp3' },
          files: [{ name: 'a.png', size: 10, format: 'png' }],
        }),
      ),
    ).toBe('conversion-unsupported');
    // JSON → YAML is browser-only.
    expect(
      await code(
        service.createJob({
          ...base,
          target: { kind: 'conversion', from: 'json', to: 'yaml' },
          files: [{ name: 'a.json', size: 10, format: 'json' }],
        }),
      ),
    ).toBe('bad-request');
    expect(
      await code(
        service.createJob({
          ...base,
          target: { kind: 'conversion', from: 'png', to: 'jpg' },
          files: [{ name: 'a.gif', size: 10, format: 'gif' }],
        }),
      ),
    ).toBe('format-mismatch');
    expect(
      await code(
        service.createJob({
          ...base,
          target: { kind: 'conversion', from: 'png', to: 'jpg' },
          files: [
            { name: 'a.png', size: 10, format: 'png' },
            { name: 'b.png', size: 10, format: 'png' },
          ],
        }),
      ),
    ).toBe('bad-request');
    expect(
      await code(
        service.createJob({
          ...base,
          target: { kind: 'conversion', from: 'png', to: 'jpg' },
          files: [{ name: 'a.png', size: 500 * 1024 ** 2, format: 'png' }],
        }),
      ),
    ).toBe('file-too-large');
    expect(
      await code(
        service.createJob({
          ...base,
          target: { kind: 'conversion', from: 'png', to: 'jpg' },
          options: { quality: 0 },
          files: [{ name: 'a.png', size: 10, format: 'png' }],
        }),
      ),
    ).toBe('invalid-options');
  });

  it('accepts several files for multi-input conversions', async () => {
    const result = await service.createJob({
      target: { kind: 'conversion', from: 'jpg', to: 'pdf' },
      files: [
        { name: '1.jpg', size: 10, format: 'jpg' },
        { name: '2.jpg', size: 10, format: 'jpg' },
      ],
      clientKey: 'c',
    });
    expect(result.uploads).toHaveLength(2);
  });

  it('refuses work when no live worker can run the engines', async () => {
    expect(
      await code(
        service.createJob({
          target: { kind: 'conversion', from: 'docx', to: 'pdf' },
          files: [{ name: 'a.docx', size: 10, format: 'docx' }],
          clientKey: 'c',
        }),
      ),
    ).toBe('server-unavailable');
    clock = new Date(clock.getTime() + 10 * 60_000); // the image worker goes stale
    expect(await code(createPngJob())).toBe('server-unavailable');
  });

  it('rate limits per client', async () => {
    for (let i = 0; i < registry.rateLimits.jobsPerMinute; i++) await createPngJob('busy');
    expect(await code(createPngJob('busy'))).toBe('rate-limited');
    expect(await code(createPngJob('other'))).toBe('ok');
  });
});

describe('upload verification', () => {
  it('requires the token and the complete upload', async () => {
    const { job, token } = await createPngJob();
    const inputId = job.inputs[0]!.id;
    expect(await code(service.completeUpload(job.id, 'wrong-token', inputId))).toBe('unauthorized');
    expect(
      await code(service.completeUpload('job_aaaaaaaaaaaaaaaaaaaaaaaaaa', token, inputId)),
    ).toBe('job-not-found');
    expect(await code(service.completeUpload(job.id, token, inputId))).toBe('upload-incomplete');
  });

  it('rejects content that does not match the declared format and deletes it', async () => {
    const { job, token } = await createPngJob();
    const input = (await store.get(job.id))!.inputs[0]!;
    const fake = new TextEncoder().encode('not an image, honest'.padEnd(PNG.length, '.'));
    await storage.write(input.storageKey, fake, { contentType: 'image/png', size: fake.length });
    expect(await code(service.completeUpload(job.id, token, input.id))).toBe('format-mismatch');
    expect(await storage.head(input.storageKey)).toBeNull();
    expect((await service.getJob(job.id, token)).status).toBe('failed');
  });

  it('queues the job when every input is verified', async () => {
    const { job, token } = await createPngJob();
    const input = (await store.get(job.id))!.inputs[0]!;
    await storage.write(input.storageKey, PNG, { contentType: 'image/png', size: PNG.length });
    const queued = await service.completeUpload(job.id, token, input.id);
    expect(queued.status).toBe('queued');
    expect(queued.inputs[0]!.uploaded).toBe(true);
    // Idempotent.
    expect((await service.completeUpload(job.id, token, input.id)).status).toBe('queued');
  });
});

describe('worker lifecycle', () => {
  async function queuedJob() {
    const created = await createPngJob();
    const input = (await store.get(created.job.id))!.inputs[0]!;
    await storage.write(input.storageKey, PNG, { contentType: 'image/png', size: PNG.length });
    await service.completeUpload(created.job.id, created.token, input.id);
    return created;
  }

  it('claims, heartbeats, completes and serves downloads', async () => {
    const { job, token } = await queuedJob();
    const claimed = (await service.claim('worker-1', ['image'], 60))!;
    expect(claimed.id).toBe(job.id);
    expect(await service.heartbeat(claimed, 'worker-1', 60, 50)).toBe(true);
    const output = outputRecord(job.id, 'photo.jpg', 'jpg', 'image/jpeg', 3);
    await storage.write(output.storageKey, new Uint8Array([0xff, 0xd8, 0xff]), {
      contentType: 'image/jpeg',
      size: 3,
    });
    await service.complete(claimed, 'worker-1', [output]);
    const done = await service.getJob(job.id, token, 'id');
    expect(done.status).toBe('completed');
    expect(done.outputs[0]).toMatchObject({
      name: 'photo.jpg',
      size: 3,
      download: { url: expect.stringContaining('photo.jpg') },
    });
    expect(await storage.head(claimed.inputs[0]!.storageKey)).toBeNull(); // inputs deleted right away
  });

  it('stops workers of cancelled jobs and deletes files', async () => {
    const { job, token } = await queuedJob();
    const claimed = (await service.claim('worker-1', ['image'], 60))!;
    const cancelled = await service.cancelJob(job.id, token, 'id');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error?.message).toBe('Konversi ini dibatalkan.');
    expect(await service.heartbeat(claimed, 'worker-1', 60, 60)).toBe(false);
    expect(storage.size).toBe(0);
    expect(await service.complete(claimed, 'worker-1', [])).toBeNull();
  });

  it('retries retryable failures with backoff, then fails for good', async () => {
    const { job, token } = await queuedJob();
    let claimed = (await service.claim('worker-1', ['image'], 60))!;
    await service.fail(claimed, 'worker-1', new VanillateError('storage-error'));
    let record = (await store.get(job.id))!;
    expect(record.status).toBe('queued');
    expect(new Date(record.runAfter).getTime() - clock.getTime()).toBe(30_000);
    expect(await service.claim('worker-1', ['image'], 60)).toBeNull(); // backoff not elapsed
    clock = new Date(clock.getTime() + 31_000);
    claimed = (await service.claim('worker-1', ['image'], 60))!;
    await service.fail(
      claimed,
      'worker-1',
      new VanillateError('conversion-failed', { detail: 'exit 1' }),
    );
    record = (await store.get(job.id))!;
    expect(record.status).toBe('failed');
    const view = await service.getJob(job.id, token);
    expect(view.error).toMatchObject({ code: 'conversion-failed', retryable: false });
    expect(JSON.stringify(view)).not.toContain('exit 1'); // internal detail never leaks
  });
});

describe('sweep', () => {
  it('expires abandoned uploads and finished jobs, then removes old records', async () => {
    const { job, token } = await createPngJob();
    clock = new Date(clock.getTime() + (registry.retention.abandonedUploadSeconds + 1) * 1000);
    expect((await service.sweep()).expired).toBe(1);
    expect(await code(service.completeUpload(job.id, token, job.inputs[0]!.id))).toBe(
      'job-expired',
    );
    clock = new Date(clock.getTime() + (registry.retention.jobRecordSeconds + 1) * 1000);
    expect((await service.sweep()).removed).toBe(1);
    expect(await code(service.getJob(job.id, token))).toBe('job-not-found');
  });

  it('requeues jobs whose worker died', async () => {
    const created = await createPngJob();
    const input = (await store.get(created.job.id))!.inputs[0]!;
    await storage.write(input.storageKey, PNG, { contentType: 'image/png', size: PNG.length });
    await service.completeUpload(created.job.id, created.token, input.id);
    await service.claim('worker-1', ['image'], 30);
    clock = new Date(clock.getTime() + 31_000);
    expect((await service.sweep()).recovered).toBe(1);
    expect((await store.get(created.job.id))!.status).toBe('queued');
  });

  it('reports live capabilities', async () => {
    await registerWorker(['ffmpeg'], ['media']);
    expect(await service.liveCapabilities()).toEqual({
      workers: 1,
      pools: ['media'],
      engines: ['ffmpeg'],
    });
  });
});
