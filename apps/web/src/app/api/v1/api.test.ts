/**
 * The job API's route handlers, called directly with an in-memory job store and local storage:
 * the browser's whole server flow (create → upload → confirm → status → cancel) and the checks
 * that protect it.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { textPdf } from '../../../../e2e/fixtures.ts';

import { GET as health } from './health/route.ts';
import { POST as cancelJob } from './jobs/[id]/cancel/route.ts';
import { POST as completeInput } from './jobs/[id]/inputs/[inputId]/complete/route.ts';
import { GET as getJob } from './jobs/[id]/route.ts';
import { POST as createJob } from './jobs/route.ts';
import { GET as download, PUT as upload } from './storage/[token]/route.ts';

const ORIGIN = 'https://convert.example';
const SERVICES = Symbol.for('vanillate.services');

interface Created {
  job: { id: string; status: string; inputs: { id: string }[] };
  token: string;
  uploads: {
    inputId: string;
    request: { method: string; url: string; headers: Record<string, string> };
  }[];
}

interface ApiError {
  error: { code: string; message: string };
}

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const authorized = (token: string) => ({ authorization: `Bearer ${token}` });

async function create(body: unknown = pdfJob(1000)): Promise<Response> {
  return createJob(
    post('/api/v1/jobs', body, {
      'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 250)}`,
    }),
  );
}

function pdfJob(size: number) {
  return {
    target: { kind: 'conversion', from: 'pdf', to: 'png' },
    files: [{ name: 'report.pdf', size, format: 'pdf' }],
  };
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as ApiError).error.code;
}

const tokenOf = (url: string): string => url.slice(url.lastIndexOf('/') + 1);

let storageDir = '';

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'vanillate-api-test-'));
});

afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
});

function resetServices(): void {
  delete (globalThis as Record<symbol, unknown>)[SERVICES];
}

describe('with server processing disabled', () => {
  beforeEach(() => {
    resetServices();
    vi.stubEnv('VANILLATE_SERVER_PROCESSING', 'disabled');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetServices();
  });

  it('refuses jobs with a clear error', async () => {
    const response = await create();
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe('server-processing-disabled');
  });

  it('reports that the server is not processing', async () => {
    const response = await health(new Request(`${ORIGIN}/api/v1/health`));
    expect(await response.json()).toEqual({ status: 'ok', serverProcessing: null });
  });
});

describe('with server processing enabled', () => {
  beforeEach(() => {
    resetServices();
    vi.stubEnv('VANILLATE_SERVER_PROCESSING', 'enabled');
    vi.stubEnv('JOB_STORE', 'memory');
    vi.stubEnv('STORAGE_DRIVER', 'local');
    vi.stubEnv('STORAGE_LOCAL_DIR', storageDir);
    vi.stubEnv('STORAGE_SIGNING_SECRET', 'api-test-signing-secret-at-least-32-characters');
    // No worker runs in these tests: accept jobs anyway.
    vi.stubEnv('VANILLATE_REQUIRE_WORKERS', 'false');
    vi.stubEnv('LOG_LEVEL', 'error');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetServices();
  });

  it('runs the browser flow: create, upload, confirm, status, cancel', async () => {
    const pdf = textPdf(['Hello']);
    const response = await create(pdfJob(pdf.length));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const created = (await response.json()) as Created;
    expect(created.job.status).toBe('pending');
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const [slot] = created.uploads;
    if (!slot) throw new Error('no upload slot');
    expect(slot.request.method).toBe('PUT');
    expect(slot.request.url).toMatch(/^\/api\/v1\/storage\//);

    const put = await upload(
      new Request(`${ORIGIN}${slot.request.url}`, {
        method: 'PUT',
        headers: slot.request.headers,
        body: pdf,
      }),
      params({ token: tokenOf(slot.request.url) }),
    );
    expect(put.status).toBe(204);

    const base = `/api/v1/jobs/${created.job.id}`;
    const confirmed = await completeInput(
      post(`${base}/inputs/${slot.inputId}/complete`, '', authorized(created.token)),
      params({ id: created.job.id, inputId: slot.inputId }),
    );
    expect(confirmed.status).toBe(200);
    expect(((await confirmed.json()) as Created).job.status).toBe('queued');

    const status = await getJob(
      new Request(`${ORIGIN}${base}`, { headers: authorized(created.token) }),
      params({ id: created.job.id }),
    );
    expect(((await status.json()) as Created).job.status).toBe('queued');

    const cancelled = await cancelJob(
      post(`${base}/cancel`, '', authorized(created.token)),
      params({ id: created.job.id }),
    );
    expect(((await cancelled.json()) as Created).job.status).toBe('cancelled');
  });

  it('fails the job when the uploaded file is not what was declared', async () => {
    const fake = Buffer.from('name,age\nAda,36\n');
    const created = (await (await create(pdfJob(fake.length))).json()) as Created;
    const [slot] = created.uploads;
    if (!slot) throw new Error('no upload slot');
    await upload(
      new Request(`${ORIGIN}${slot.request.url}`, {
        method: 'PUT',
        headers: slot.request.headers,
        body: fake,
      }),
      params({ token: tokenOf(slot.request.url) }),
    );
    const confirmed = await completeInput(
      post(
        `/api/v1/jobs/${created.job.id}/inputs/${slot.inputId}/complete`,
        '',
        authorized(created.token),
      ),
      params({ id: created.job.id, inputId: slot.inputId }),
    );
    expect(confirmed.status).toBe(415);
    expect(await errorCode(confirmed)).toBe('format-mismatch');
    const status = await getJob(
      new Request(`${ORIGIN}/api/v1/jobs/${created.job.id}`, {
        headers: authorized(created.token),
      }),
      params({ id: created.job.id }),
    );
    const { job } = (await status.json()) as { job: { status: string; error: { code: string } } };
    expect(job.status).toBe('failed');
    expect(job.error.code).toBe('format-mismatch');
  });

  describe('job access', () => {
    it('needs the job token', async () => {
      const created = (await (await create()).json()) as Created;
      const url = `${ORIGIN}/api/v1/jobs/${created.job.id}`;
      const ctx = params({ id: created.job.id });
      const anonymous = await getJob(new Request(url), ctx);
      expect(anonymous.status).toBe(403);
      expect(await errorCode(anonymous)).toBe('unauthorized');
      const wrong = await getJob(new Request(url, { headers: authorized('A'.repeat(43)) }), ctx);
      expect(wrong.status).toBe(403);
      const cancel = await cancelJob(post(`/api/v1/jobs/${created.job.id}/cancel`, ''), ctx);
      expect(cancel.status).toBe(403);
    });

    it('rejects malformed job ids before any lookup', async () => {
      const response = await getJob(
        new Request(`${ORIGIN}/api/v1/jobs/..%2F..%2Fetc`, { headers: authorized('A'.repeat(43)) }),
        params({ id: '../../etc' }),
      );
      expect(response.status).toBe(404);
      expect(await errorCode(response)).toBe('job-not-found');
    });

    it('answers in the requested language', async () => {
      const created = (await (await create()).json()) as Created;
      const response = await getJob(
        new Request(`${ORIGIN}/api/v1/jobs/${created.job.id}?locale=id`),
        params({ id: created.job.id }),
      );
      expect(((await response.json()) as ApiError).error.message).toBe(
        'Kamu tidak memiliki akses ke konversi ini.',
      );
    });
  });

  describe('storage tokens', () => {
    it('reject tampered, wrong-method and mismatched uploads', async () => {
      const created = (await (await create(pdfJob(10))).json()) as Created;
      const [slot] = created.uploads;
      if (!slot) throw new Error('no upload slot');
      const token = tokenOf(slot.request.url);
      const send = (t: string, headers: Record<string, string>, body: string) =>
        upload(
          new Request(`${ORIGIN}/api/v1/storage/${t}`, { method: 'PUT', headers, body }),
          params({ token: t }),
        );

      const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
      expect((await send(tampered, slot.request.headers, '%PDF-1.4\n')).status).toBe(403);
      expect((await send(token, { 'content-type': 'text/html' }, '%PDF-1.4\n')).status).toBe(400);
      const larger = await send(token, slot.request.headers, '%PDF-1.4\n0123456789');
      expect(larger.status).toBe(400);
      expect(await errorCode(larger)).toBe('bad-request');
      const shorter = await send(token, slot.request.headers, '%PDF');
      expect(shorter.status).toBe(409);
      expect(await errorCode(shorter)).toBe('upload-incomplete');
      const wrongMethod = await download(
        new Request(`${ORIGIN}/api/v1/storage/${token}`),
        params({ token }),
      );
      expect(wrongMethod.status).toBe(405);
    });
  });

  describe('request validation', () => {
    it.each([
      ['wrong content type', post('/api/v1/jobs', 'x', { 'content-type': 'text/plain' })],
      ['invalid JSON', post('/api/v1/jobs', '{')],
      ['unknown fields', post('/api/v1/jobs', { ...pdfJob(10), admin: true })],
      ['no files', post('/api/v1/jobs', { ...pdfJob(10), files: [] })],
      ['negative size', post('/api/v1/jobs', pdfJob(-1))],
      [
        'oversized body',
        post('/api/v1/jobs', { ...pdfJob(10), options: { pad: 'x'.repeat(70_000) } }),
      ],
    ])('rejects %s', async (_, request) => {
      const response = await createJob(request);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe('bad-request');
    });

    it('rejects conversions that are not offered', async () => {
      const response = await create({
        target: { kind: 'conversion', from: 'jpg', to: 'mp3' },
        files: [{ name: 'a.jpg', size: 10, format: 'jpg' }],
      });
      expect(response.status).toBe(422);
      expect(await errorCode(response)).toBe('conversion-unsupported');
    });

    it('rejects files over the limit before anything is uploaded', async () => {
      const response = await create(pdfJob(50 * 1024 ** 3));
      expect(response.status).toBe(413);
      expect(await errorCode(response)).toBe('file-too-large');
    });

    it('validates options against the route', async () => {
      const response = await create({ ...pdfJob(10), options: { dpi: 100_000 } });
      expect(response.status).toBe(422);
      expect(await errorCode(response)).toBe('invalid-options');
    });

    it('never returns internal details', async () => {
      const response = await createJob(post('/api/v1/jobs', '{'));
      const body = JSON.stringify(await response.json());
      expect(body).not.toMatch(/stack|at \/|node_modules|SyntaxError/);
    });
  });
});
