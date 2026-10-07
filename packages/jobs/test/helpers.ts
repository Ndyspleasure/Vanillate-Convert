import { newId, type JobRecord } from '@vanillate/core';
import postgres from 'postgres';

import { migrate } from '../src/index.ts';

export function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  const now = new Date().toISOString();
  return {
    id: newId('job'),
    status: 'queued',
    progress: 0,
    target: {
      kind: 'conversion',
      routeId: 'image.imagemagick.raster:png-jpg',
      from: 'png',
      to: 'jpg',
    },
    engines: ['imagemagick'],
    pool: 'image',
    options: { quality: 80 },
    inputs: [],
    outputs: [],
    error: null,
    attempts: 0,
    maxAttempts: 3,
    priority: 0,
    tokenHash: 'h'.repeat(64),
    workerId: null,
    leaseExpiresAt: null,
    runAfter: now,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    version: 0,
    ...overrides,
  };
}

/** Creates an isolated, migrated database on the test server; returns its URL and a drop function. */
export async function createTestDatabase(
  baseUrl: string,
): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `vc_test_${Math.random().toString(36).slice(2, 10)}`;
  const admin = postgres(baseUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database ${name}`);
  await admin.end();
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  await migrate(url.toString());
  return {
    url: url.toString(),
    drop: async () => {
      const sql = postgres(baseUrl, { max: 1, onnotice: () => undefined });
      await sql.unsafe(`drop database if exists ${name} with (force)`);
      await sql.end();
    },
  };
}
