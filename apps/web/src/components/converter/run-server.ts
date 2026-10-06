/**
 * Server processing from the browser:
 *
 *   create job ─▶ upload each file straight to storage (signed request) ─▶ confirm upload
 *   ─▶ poll status ─▶ signed download links
 *
 * Files never pass through the web server when storage is S3-compatible. Cancelling aborts the
 * upload and cancels the job, which deletes its files.
 */
import { isErrorCode, VanillateError, type ErrorCode, type OptionValues } from '@vanillate/core';

import type { Locale } from '@/i18n/config.ts';

export type ServerTarget =
  { kind: 'conversion'; from: string; to: string } | { kind: 'tool'; toolId: string };

export interface ServerResult {
  name: string;
  size: number;
  format: string;
  url: string;
  expiresAt: string;
}

export interface ServerProgress {
  stage: 'uploading' | 'queued' | 'processing' | 'finalizing';
  /** 0–1 within the stage. */
  fraction: number;
}

interface SignedRequest {
  method: 'PUT' | 'GET';
  url: string;
  headers: Record<string, string>;
}

interface PublicJob {
  id: string;
  status: string;
  progress: number;
  inputs: { id: string }[];
  outputs: {
    name: string;
    size: number;
    format: string;
    download: { url: string; expiresAt: string } | null;
  }[];
  error: { code: string } | null;
}

function failure(code: unknown): VanillateError {
  return new VanillateError(isErrorCode(code) ? code : ('internal-error' satisfies ErrorCode));
}

async function api<T>(
  path: string,
  init: RequestInit,
  locale: Locale,
  signal: AbortSignal,
): Promise<T> {
  const url = `${path}${path.includes('?') ? '&' : '?'}locale=${locale}`;
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal, credentials: 'same-origin' });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new VanillateError('server-unavailable', { cause: error });
  }
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
  if (!response.ok) throw failure(body?.error?.code);
  return body as T;
}

function upload(
  request: SignedRequest,
  file: File,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(request.method, request.url);
    for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new VanillateError('upload-incomplete', { detail: `HTTP ${xhr.status}` }));
    xhr.onerror = () => reject(new VanillateError('storage-error', { detail: 'upload failed' }));
    const abort = (): void => {
      xhr.abort();
      reject(new DOMException('cancelled', 'AbortError'));
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    xhr.onloadend = () => signal.removeEventListener('abort', abort);
    xhr.send(file);
  });
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      signal.removeEventListener('abort', cancel);
      resolve();
    }
    function cancel(): void {
      clearTimeout(timer);
      reject(new DOMException('cancelled', 'AbortError'));
    }
    signal.addEventListener('abort', cancel, { once: true });
  });

export async function runOnServer(args: {
  target: ServerTarget;
  options: OptionValues;
  files: readonly { file: File; format: string }[];
  locale: Locale;
  signal: AbortSignal;
  onProgress: (progress: ServerProgress) => void;
}): Promise<ServerResult[]> {
  const { target, options, files, locale, signal, onProgress } = args;
  const created = await api<{
    job: PublicJob;
    token: string;
    uploads: { inputId: string; request: SignedRequest }[];
  }>(
    '/api/v1/jobs',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target,
        options,
        files: files.map(({ file, format }) => ({ name: file.name, size: file.size, format })),
      }),
    },
    locale,
    signal,
  );
  const auth = { authorization: `Bearer ${created.token}` };
  const base = `/api/v1/jobs/${created.job.id}`;
  try {
    // ---- upload
    const total = files.reduce((sum, f) => sum + f.file.size, 0) || 1;
    let done = 0;
    for (const [index, entry] of files.entries()) {
      const slot = created.uploads[index];
      if (!slot) throw new VanillateError('internal-error', { detail: 'missing upload slot' });
      await upload(slot.request, entry.file, signal, (loaded) =>
        onProgress({ stage: 'uploading', fraction: Math.min(1, (done + loaded) / total) }),
      );
      done += entry.file.size;
      await api(
        `${base}/inputs/${slot.inputId}/complete`,
        { method: 'POST', headers: auth },
        locale,
        signal,
      );
    }

    // ---- wait
    let delay = 800;
    for (;;) {
      const { job } = await api<{ job: PublicJob }>(base, { headers: auth }, locale, signal);
      switch (job.status) {
        case 'completed':
          return job.outputs
            .filter(
              (o): o is typeof o & { download: { url: string; expiresAt: string } } =>
                o.download !== null,
            )
            .map((o) => ({
              name: o.name,
              size: o.size,
              format: o.format,
              url: o.download.url,
              expiresAt: o.download.expiresAt,
            }));
        case 'failed':
        case 'expired':
          throw failure(job.error?.code ?? 'conversion-failed');
        case 'cancelled':
          throw new DOMException('cancelled', 'AbortError');
        case 'processing':
          onProgress({ stage: 'processing', fraction: job.progress / 100 });
          break;
        case 'finalizing':
          onProgress({ stage: 'finalizing', fraction: 1 });
          break;
        default:
          onProgress({ stage: 'queued', fraction: 0 });
      }
      await sleep(delay, signal);
      delay = Math.min(3000, Math.round(delay * 1.3));
    }
  } catch (error) {
    if (signal.aborted) {
      // Best effort: delete the job's files right away.
      void fetch(`${base}/cancel?locale=${locale}`, { method: 'POST', headers: auth }).catch(
        () => undefined,
      );
    }
    throw error;
  }
}
