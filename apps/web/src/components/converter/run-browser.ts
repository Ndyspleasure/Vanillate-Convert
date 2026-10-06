/**
 * Runs a browser task in a Web Worker, or on the main thread when the engine needs the DOM
 * (SVG rendering). Cancelling terminates the worker immediately.
 */
import type { BrowserOutputFile, BrowserTask } from '@vanillate/browser-engines';
import { VanillateError, isErrorCode, toVanillateError } from '@vanillate/core';

import type { WorkerMessage, WorkerRequest } from './engine.worker.ts';
import { clientRegistry } from './registry.ts';

export async function runInBrowser(
  task: BrowserTask,
  serverProcessing: boolean,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<BrowserOutputFile[]> {
  const engines = await import('@vanillate/browser-engines');
  if (engines.needsMainThread(task) || typeof Worker === 'undefined') {
    return engines.runBrowserTask(task, {
      registry: clientRegistry(serverProcessing),
      signal,
      progress: onProgress,
    });
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    const stop = (): void => {
      worker.terminate();
      reject(new DOMException('cancelled', 'AbortError'));
    };
    if (signal.aborted) return stop();
    signal.addEventListener('abort', stop, { once: true });
    const finish = (): void => {
      signal.removeEventListener('abort', stop);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress(message.value);
      } else if (message.type === 'done') {
        finish();
        resolve(message.outputs);
      } else {
        finish();
        reject(
          new VanillateError(isErrorCode(message.code) ? message.code : 'internal-error', {
            detail: message.detail,
          }),
        );
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(toVanillateError(new Error(event.message || 'worker failed')));
    };
    const request: WorkerRequest = { task, serverProcessing };
    // Transfer input buffers: the files are not copied a second time.
    worker.postMessage(request, [
      ...new Set(task.inputs.map((input) => input.bytes.buffer as ArrayBuffer)),
    ]);
  });
}
