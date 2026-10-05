/**
 * ExifTool adapter: metadata viewer (JSON) and metadata remover.
 *
 * The viewer never reports server-side details: the `System` group (file name, directory,
 * permissions, timestamps) and `SourceFile` are removed, and binary values are not extracted.
 * The remover deletes all metadata, then restores only the ICC color profile and the
 * orientation so images still look and rotate the same.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { VanillateError, type ErrorCode } from '@vanillate/core';

import type {
  EngineContext,
  EngineOutput,
  EngineProbe,
  EngineRequest,
  ProcessRunner,
  ServerEngine,
} from '../types.ts';
import {
  assertSuccess,
  extensionOf,
  firstLine,
  onlyInput,
  requireFile,
  runOptions,
} from '../util.ts';

const FAILURES: [RegExp, ErrorCode][] = [
  [/File format error|Not a valid|Corrupted|Error reading|Unknown file type/i, 'input-corrupt'],
];

/** Removes keys that would describe our servers rather than the file. */
export function publicMetadata(raw: unknown): Record<string, unknown> {
  const list: unknown[] = Array.isArray(raw) ? (raw as unknown[]) : [];
  const record = (list[0] ?? {}) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'SourceFile' || key.startsWith('System:') || key.startsWith('ExifTool:')) continue;
    if (key === 'File:Directory' || key === 'File:FileName') continue;
    result[key] = value;
  }
  return result;
}

async function exiftool(ctx: EngineContext, args: string[]): Promise<string> {
  const result = await ctx.runner.run(ctx.binaries.exiftool ?? 'exiftool', args, {
    ...runOptions(ctx),
    stdoutLimit: 16 * 1024 * 1024,
  });
  assertSuccess(result, 'exiftool', FAILURES);
  return result.stdout;
}

async function probe(runner: ProcessRunner): Promise<EngineProbe> {
  try {
    const result = await runner.run('exiftool', ['-ver'], {
      cwd: '/',
      timeoutMs: 10_000,
      writable: [],
    });
    if (result.exitCode === 0)
      return {
        available: true,
        version: `ExifTool ${firstLine(result.stdout) ?? ''}`.trim(),
        binary: 'exiftool',
      };
  } catch {
    // not installed
  }
  return { available: false, version: null, binary: null };
}

async function run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]> {
  if (request.kind !== 'operation') {
    throw new VanillateError('conversion-unsupported', { detail: 'exiftool has no conversions' });
  }
  const input = onlyInput(request);
  switch (request.operation) {
    case 'read-metadata': {
      const json = await exiftool(ctx, [
        '-json',
        '-G1',
        '-a',
        '-s',
        '-struct',
        '-charset',
        'utf8',
        '--System:all',
        '-api',
        'LargeFileSupport=1',
        input.path,
      ]);
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new VanillateError('conversion-failed', { detail: 'exiftool returned invalid JSON' });
      }
      const out = join(request.outDir, 'metadata.json');
      await writeFile(out, `${JSON.stringify(publicMetadata(parsed), null, 2)}\n`);
      return [{ path: out, format: 'json' }];
    }
    case 'strip-metadata': {
      const out = join(request.outDir, `output.${extensionOf(ctx, input.format)}`);
      await exiftool(ctx, [
        '-q',
        '-all=',
        '-tagsFromFile',
        '@',
        '-ICC_Profile',
        '-Orientation',
        '-api',
        'LargeFileSupport=1',
        '-o',
        out,
        input.path,
      ]);
      return [{ path: await requireFile(out, 'exiftool'), format: input.format }];
    }
    default:
      throw new VanillateError('conversion-unsupported', {
        detail: `exiftool ${request.operation}`,
      });
  }
}

export const exiftoolEngine: ServerEngine = { id: 'exiftool', probe, run };
