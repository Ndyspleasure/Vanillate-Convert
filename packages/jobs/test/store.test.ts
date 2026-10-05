import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { MemoryJobStore, PostgresJobStore, type JobStore } from '../src/index.ts';
import { createTestDatabase, makeJob } from './helpers.ts';

const databaseUrl = inject('databaseUrl');

function contract(
  name: string,
  setup: () => Promise<{ store: JobStore; teardown: () => Promise<void> }>,
) {
  describe(name, () => {
    let store: JobStore;
    let teardown: () => Promise<void>;
    beforeAll(async () => {
      ({ store, teardown } = await setup());
    });
    afterAll(async () => {
      await teardown();
    });

    it('inserts, reads and updates with optimistic concurrency', async () => {
      const job = makeJob({ status: 'pending' });
      await store.insert(job);
      expect(await store.get(job.id)).toEqual(job);
      const now = new Date();
      const updated = await store.update(
        job.id,
        0,
        {
          status: 'uploading',
          inputs: [
            { id: 'in_x', name: 'a.png', size: 1, format: 'png', storageKey: 'k', uploaded: true },
          ],
        },
        now,
      );
      expect(updated).toMatchObject({
        status: 'uploading',
        version: 1,
        updatedAt: now.toISOString(),
      });
      expect(updated!.inputs[0]!.uploaded).toBe(true);
      expect(await store.update(job.id, 0, { status: 'queued' }, now)).toBeNull();
      expect(await store.get('job_missing')).toBeNull();
    });

    it('claims runnable jobs by pool, priority and age', async () => {
      const base = Date.now();
      const old = makeJob({
        pool: 'media',
        createdAt: new Date(base - 5000).toISOString(),
        runAfter: new Date(base - 5000).toISOString(),
      });
      const urgent = makeJob({
        pool: 'media',
        priority: 5,
        runAfter: new Date(base - 1000).toISOString(),
      });
      const later = makeJob({ pool: 'media', runAfter: new Date(base + 60_000).toISOString() });
      const other = makeJob({ pool: 'archive', runAfter: new Date(base - 500).toISOString() });
      for (const job of [old, urgent, later, other]) await store.insert(job);
      const now = new Date(base);
      const first = await store.claim('w1', ['media'], 60, now);
      expect(first).toMatchObject({
        id: urgent.id,
        status: 'processing',
        workerId: 'w1',
        attempts: 1,
      });
      expect(first!.startedAt).toBe(now.toISOString());
      expect((await store.claim('w1', ['media'], 60, now))?.id).toBe(old.id);
      expect(await store.claim('w1', ['media'], 60, now)).toBeNull();
      expect((await store.claim('w2', ['archive', 'media'], 60, now))?.id).toBe(other.id);
    });

    it('never hands the same job to two workers', async () => {
      const jobs = Array.from({ length: 5 }, () => makeJob({ pool: 'document' }));
      for (const job of jobs) await store.insert(job);
      const claims = await Promise.all(
        Array.from({ length: 12 }, (_, i) => store.claim(`w${i}`, ['document'], 60, new Date())),
      );
      const ids = claims.filter((c) => c !== null).map((c) => c.id);
      expect(ids.sort()).toEqual(jobs.map((j) => j.id).sort());
    });

    it('heartbeats only for the lease holder and stops after cancellation', async () => {
      const job = makeJob({ pool: 'data' });
      await store.insert(job);
      const claimed = (await store.claim('w1', ['data'], 60, new Date()))!;
      expect(await store.heartbeat(job.id, 'w1', 60, 42.4, new Date())).toBe('processing');
      expect((await store.get(job.id))!.progress).toBe(42);
      expect(await store.heartbeat(job.id, 'w2', 60, 50, new Date())).toBeNull();
      await store.update(job.id, claimed.version, { status: 'cancelled' }, new Date());
      expect(await store.heartbeat(job.id, 'w1', 60, 50, new Date())).toBeNull();
    });

    it('recovers expired leases: requeue, or fail when attempts are exhausted', async () => {
      const start = new Date(Date.now() - 600_000);
      const retry = makeJob({ pool: 'specialized', runAfter: start.toISOString() });
      const exhausted = makeJob({
        pool: 'specialized',
        maxAttempts: 1,
        runAfter: start.toISOString(),
      });
      await store.insert(retry);
      await store.insert(exhausted);
      await store.claim('w1', ['specialized'], 10, start);
      await store.claim('w1', ['specialized'], 10, start);
      const result = await store.recoverLeases(new Date(), 600);
      expect(result.requeued).toContain(retry.id);
      expect(result.failed).toContain(exhausted.id);
      expect(await store.get(retry.id)).toMatchObject({
        status: 'queued',
        workerId: null,
        leaseExpiresAt: null,
      });
      expect(await store.get(exhausted.id)).toMatchObject({
        status: 'failed',
        error: { code: 'conversion-timeout', retryable: false },
      });
    });

    it('finds expired jobs and removes them', async () => {
      const gone = makeJob({
        status: 'completed',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      await store.insert(gone);
      const expired = await store.findExpired(new Date(), 100);
      expect(expired.map((j) => j.id)).toContain(gone.id);
      await store.remove(gone.id);
      expect(await store.get(gone.id)).toBeNull();
    });

    it('tracks workers', async () => {
      const now = new Date();
      await store.upsertWorker({
        id: 'worker-a',
        pools: ['image'],
        engines: { imagemagick: { available: true, version: '6.9' } },
        version: '0.1.0',
        startedAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
      });
      const seen = await store.workersSeenSince(new Date(now.getTime() - 1000));
      expect(seen.find((w) => w.id === 'worker-a')?.engines.imagemagick?.available).toBe(true);
      expect(await store.workersSeenSince(new Date(now.getTime() + 1000))).toEqual([]);
      await store.removeWorker('worker-a');
      expect(await store.workersSeenSince(new Date(0))).toEqual([]);
    });

    it('counts rate-limit hits per fixed window', async () => {
      const now = new Date('2026-01-01T10:00:30Z');
      expect(await store.hit('client', 60, now)).toBe(1);
      expect(await store.hit('client', 60, new Date('2026-01-01T10:00:59Z'))).toBe(2);
      expect(await store.hit('client', 60, new Date('2026-01-01T10:01:00Z'))).toBe(1);
      await store.purgeRateLimits(new Date('2026-01-01T11:00:00Z'));
      expect(await store.hit('client', 60, now)).toBe(1);
    });
  });
}

contract('MemoryJobStore', () =>
  Promise.resolve({ store: new MemoryJobStore(), teardown: () => Promise.resolve() }),
);

if (databaseUrl) {
  contract('PostgresJobStore', async () => {
    const db = await createTestDatabase(databaseUrl);
    const store = new PostgresJobStore(db.url, { max: 12 });
    return {
      store,
      teardown: async () => {
        await store.close();
        await db.drop();
      },
    };
  });
} else {
  describe.skip('PostgresJobStore (no database available)', () => {
    it('skipped', () => undefined);
  });
}
