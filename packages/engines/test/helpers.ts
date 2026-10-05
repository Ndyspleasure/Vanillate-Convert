/**
 * Test helpers: a job directory with an engine context, engine probing and fixtures.
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getRegistry, type Registry } from '@vanillate/core';

import {
  detectFile,
  probeEngines,
  ProcessRunner,
  resolveSandbox,
  type EngineContext,
  type EngineFile,
  type EngineLimits,
  type EngineProbe,
} from '../src/index.ts';

export const registry: Registry = getRegistry();
export const runner = new ProcessRunner({ sandbox: resolveSandbox(process.env.VANILLATE_SANDBOX) });

let probing: Promise<Record<string, EngineProbe>> | null = null;
export function engineProbes(): Promise<Record<string, EngineProbe>> {
  probing ??= probeEngines(runner);
  return probing;
}

export const DEFAULT_LIMITS: EngineLimits = {
  maxOutputBytes: 512 * 1024 * 1024,
  maxPixels: 100_000_000,
  maxPages: 500,
  maxDurationSeconds: 3600,
  archive: registry.archiveLimits,
};

export interface TestJob {
  dir: string;
  outDir: string;
  ctx: EngineContext;
  progress: number[];
  /** Writes an input file into the job's input directory. */
  file(name: string, content: Uint8Array | string, format: string): Promise<EngineFile>;
  cleanup(): Promise<void>;
}

export async function makeJob(
  overrides: { limits?: Partial<EngineLimits>; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<TestJob> {
  const dir = await mkdtemp(join(tmpdir(), 'vanillate-engine-'));
  for (const sub of ['in', 'out', 'tmp', 'home']) await mkdir(join(dir, sub));
  const probes = await engineProbes();
  const binaries: Record<string, string> = {};
  for (const [id, probe] of Object.entries(probes)) if (probe.binary) binaries[id] = probe.binary;
  const progress: number[] = [];
  const ctx: EngineContext = {
    runner,
    workDir: dir,
    signal: overrides.signal ?? new AbortController().signal,
    deadline: Date.now() + (overrides.timeoutMs ?? 120_000),
    limits: { ...DEFAULT_LIMITS, ...overrides.limits },
    registry,
    binaries,
    progress: (fraction) => progress.push(fraction),
  };
  return {
    dir,
    outDir: join(dir, 'out'),
    ctx,
    progress,
    async file(name, content, format) {
      const path = join(dir, 'in', name);
      await writeFile(path, content);
      return { path, name, format, size: (await stat(path)).size };
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Detected format id of a file (null when unknown). */
export async function detected(path: string, name: string | null = null): Promise<string | null> {
  return (await detectFile(path, registry, name)).format?.id ?? null;
}

/** A small PDF with one line of Helvetica text per page. */
export function textPdf(pages: readonly string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((text, i) => {
    const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
    objects[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objects[5 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets.push(out.length);
    out += `${id} 0 obj\n${objects[id] ?? ''}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** Runs a fixture-generating command outside the engines (fails the test on error). */
export async function generate(command: string, args: string[], cwd: string): Promise<void> {
  const result = await new ProcessRunner({ sandbox: 'none', prlimit: false }).run(command, args, {
    cwd,
    timeoutMs: 60_000,
    writable: [cwd],
    homeDir: cwd,
    tmpDir: cwd,
  });
  if (result.exitCode !== 0) {
    throw new Error(`${command} failed (${result.exitCode}): ${result.stderr.slice(-1000)}`);
  }
}
