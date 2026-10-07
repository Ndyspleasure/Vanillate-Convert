/**
 * Contracts between the browser executor (Web Worker) and the engines.
 */
import type { OptionValues, Registry } from '@vanillate/core';

export interface BrowserInputFile {
  name: string;
  bytes: Uint8Array;
  /** Detected (and user-confirmed) format id. */
  format: string;
}

export interface BrowserOutputFile {
  name: string;
  /** Relative path for files extracted from archives (keeps folder structure). */
  path?: string;
  bytes: Uint8Array;
  /** Output format id (verified by output validation). */
  format: string;
  mimeType: string;
}

export type BrowserTask =
  | {
      kind: 'conversion';
      routeId: string;
      engine: string;
      from: string;
      to: string;
      options: OptionValues;
      inputs: BrowserInputFile[];
    }
  | {
      kind: 'tool';
      routeId: string;
      engine: string;
      toolId: string;
      operation: string;
      options: OptionValues;
      inputs: BrowserInputFile[];
    };

export interface TaskContext {
  registry: Registry;
  signal: AbortSignal;
  /** Reports progress in the range 0–1. */
  progress(fraction: number): void;
}

export type BrowserEngine = (task: BrowserTask, ctx: TaskContext) => Promise<BrowserOutputFile[]>;

/** Throws an AbortError if the task was cancelled. Call between expensive steps. */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The conversion was cancelled.', 'AbortError');
}
