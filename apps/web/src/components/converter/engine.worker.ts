/**
 * Web Worker that runs browser conversions off the main thread, so the page stays responsive.
 * Files arrive as transferred buffers and results are transferred back (no copies).
 */
import {
  runBrowserTask,
  type BrowserOutputFile,
  type BrowserTask,
} from '@vanillate/browser-engines';
import { toVanillateError } from '@vanillate/core';

import { clientRegistry } from './registry.ts';

export interface WorkerRequest {
  task: BrowserTask;
  serverProcessing: boolean;
}

export type WorkerMessage =
  | { type: 'progress'; value: number }
  | { type: 'done'; outputs: BrowserOutputFile[] }
  | { type: 'error'; code: string; detail?: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const { task, serverProcessing } = event.data;
  const controller = new AbortController();
  runBrowserTask(task, {
    registry: clientRegistry(serverProcessing),
    signal: controller.signal,
    progress: (value) => scope.postMessage({ type: 'progress', value }),
  })
    .then((outputs) => {
      // Several outputs can share one buffer; each buffer may be transferred only once.
      const buffers = new Set(outputs.map((output) => output.bytes.buffer as ArrayBuffer));
      scope.postMessage({ type: 'done', outputs }, [...buffers]);
    })
    .catch((error: unknown) => {
      const failure = toVanillateError(error);
      scope.postMessage({ type: 'error', code: failure.code, detail: failure.detail });
    });
};
