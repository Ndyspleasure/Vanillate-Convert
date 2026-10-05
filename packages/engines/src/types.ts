import type { ArchiveLimits, OptionValues, Registry } from '@vanillate/core';

import type { ProcessRunner, RunOptions, RunResult } from './runner.ts';

export interface EngineFile {
  path: string;
  /** Display name (sanitized original name). */
  name: string;
  format: string;
  size: number;
}

export interface EngineOutput {
  path: string;
  /** Output format id; `null` when it must be detected from the content (extracted files). */
  format: string | null;
  /** Optional suffix for multi-file outputs, e.g. the page number. */
  part?: { index: number; total: number };
  /** Relative path for extracted archive entries. */
  entryPath?: string;
}

export type EngineRequest =
  | {
      kind: 'convert';
      from: string;
      to: string;
      options: OptionValues;
      inputs: EngineFile[];
      outDir: string;
    }
  | {
      kind: 'operation';
      operation: string;
      options: OptionValues;
      inputs: EngineFile[];
      outDir: string;
    };

export interface EngineLimits {
  maxOutputBytes: number;
  maxPixels: number;
  maxPages: number;
  maxDurationSeconds: number;
  archive: ArchiveLimits;
}

export interface EngineContext {
  runner: ProcessRunner;
  /** Job working directory; everything the engine writes stays inside. */
  workDir: string;
  signal: AbortSignal;
  /** Absolute deadline (epoch ms) for the whole job. */
  deadline: number;
  limits: EngineLimits;
  registry: Registry;
  /** Binaries resolved by the probe, by engine id. */
  binaries: Readonly<Record<string, string>>;
  progress(fraction: number): void;
}

export interface EngineProbe {
  available: boolean;
  version: string | null;
  binary: string | null;
}

export interface ServerEngine {
  id: string;
  probe(runner: ProcessRunner): Promise<EngineProbe>;
  run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]>;
}

export type { ProcessRunner, RunOptions, RunResult };
