/**
 * Open Asset Import Library adapter (`assimp export`) for 3D meshes. Experimental: geometry
 * and basic materials convert; animation, rigging and some textures may be lost.
 *
 * assimp picks the importer from the file extension, so the input is staged with the
 * extension of its detected format.
 */
import { copyFile, mkdir } from 'node:fs/promises';
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
  listFiles,
  onlyInput,
  runOptions,
} from '../util.ts';

/** Catalog format → assimp exporter id (binary variants where they exist). */
const EXPORTERS: Record<string, string> = {
  obj: 'obj',
  stl: 'stlb',
  glb: 'glb2',
  dae: 'collada',
  ply: 'plyb',
  '3ds': '3ds',
  fbx: 'fbx',
};

const FAILURES: [RegExp, ErrorCode][] = [
  [
    /failed to load|Unable to open|No suitable reader|File is too small|Unexpected end|parse error|invalid/i,
    'input-corrupt',
  ],
];

async function probe(runner: ProcessRunner): Promise<EngineProbe> {
  try {
    const result = await runner.run('assimp', ['version'], {
      cwd: '/',
      timeoutMs: 10_000,
      writable: [],
    });
    if (result.exitCode === 0) {
      const version = /Version\s+([\d.]+)/i.exec(result.stdout)?.[1];
      return {
        available: true,
        version: version ? `assimp ${version}` : firstLine(result.stdout),
        binary: 'assimp',
      };
    }
  } catch {
    // not installed
  }
  return { available: false, version: null, binary: null };
}

async function run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]> {
  if (request.kind !== 'convert') {
    throw new VanillateError('conversion-unsupported', { detail: `assimp ${request.operation}` });
  }
  const exporter = EXPORTERS[request.to];
  if (!exporter)
    throw new VanillateError('conversion-unsupported', {
      detail: `assimp cannot write ${request.to}`,
    });
  const input = onlyInput(request);
  const dir = join(ctx.workDir, 'tmp', 'assimp');
  const outDir = join(dir, 'out');
  await mkdir(outDir, { recursive: true });
  const staged = join(dir, `model.${extensionOf(ctx, input.format)}`);
  await copyFile(input.path, staged);
  const target = join(outDir, `model.${extensionOf(ctx, request.to)}`);
  const result = await ctx.runner.run(
    ctx.binaries.assimp ?? 'assimp',
    ['export', staged, target, `-f${exporter}`],
    runOptions(ctx),
  );
  assertSuccess(result, 'assimp', FAILURES);
  // OBJ also writes a material library (`model.mtl`) next to the mesh.
  const files = await listFiles(outDir);
  if (!files.includes(target))
    throw new VanillateError('conversion-failed', { detail: 'assimp wrote no model' });
  const outputs: EngineOutput[] = [];
  for (const file of files) {
    const name = file.slice(outDir.length + 1);
    const out = join(request.outDir, name);
    await copyFile(file, out);
    outputs.push({ path: out, format: file === target ? request.to : null, entryPath: name });
  }
  return outputs;
}

export const assimp: ServerEngine = { id: 'assimp', probe, run };
