/**
 * Pandoc adapter for markup and e-book documents.
 *
 * Untrusted documents can include other files (`\input`, image paths, HTML resources), so
 * pandoc must run either with `--sandbox` (needs a build with embedded data files, as in the
 * official release binaries) or as an isolated engine process (bubblewrap sandbox or a
 * separate user). With neither available the conversion is refused. The heap is capped.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { decodeText, stripBom, VanillateError, type ErrorCode } from '@vanillate/core';

import type {
  EngineContext,
  EngineFile,
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

const READERS: Record<string, string> = {
  md: 'markdown',
  html: 'html',
  docx: 'docx',
  odt: 'odt',
  epub: 'epub',
  rst: 'rst',
  tex: 'latex',
  org: 'org',
  fb2: 'fb2',
};

const WRITERS: Record<string, string> = {
  md: 'markdown',
  html: 'html5',
  docx: 'docx',
  odt: 'odt',
  epub: 'epub3',
  rst: 'rst',
  tex: 'latex',
  org: 'org',
  txt: 'plain',
  fb2: 'fb2',
  rtf: 'rtf',
};

/** Text inputs are normalized to UTF-8 (pandoc only reads UTF-8). */
const TEXT_INPUTS = new Set(['md', 'html', 'rst', 'tex', 'org']);
const STANDALONE = new Set(['html', 'tex', 'rtf']);

const FAILURES: [RegExp, ErrorCode][] = [
  [/Heap exhausted|out of memory/i, 'input-corrupt'],
  [
    /couldn't parse|Error parsing|Unknown reader|PandocParseError|Could not read|zip archive|not a valid/i,
    'input-corrupt',
  ],
];

const sandboxSupport = new Map<string, Promise<boolean>>();

/** Whether this pandoc build can run with `--sandbox` (data files embedded in the binary). */
function supportsSandbox(ctx: EngineContext, binary: string): Promise<boolean> {
  let cached = sandboxSupport.get(binary);
  if (!cached) {
    cached = (async () => {
      const dir = join(ctx.workDir, 'tmp', 'pandoc-probe');
      await mkdir(dir, { recursive: true });
      const source = join(dir, 'probe.md');
      await writeFile(source, '# probe\n');
      const result = await ctx.runner.run(
        binary,
        ['--sandbox', '-f', 'markdown', '-t', 'docx', '-o', join(dir, 'probe.docx'), source],
        { ...runOptions(ctx), timeoutMs: 30_000 },
      );
      return result.exitCode === 0;
    })();
    sandboxSupport.set(binary, cached);
    cached.catch(() => sandboxSupport.delete(binary));
  }
  return cached;
}

async function stage(input: EngineFile, dir: string): Promise<string> {
  if (!TEXT_INPUTS.has(input.format)) return input.path;
  const staged = join(dir, 'input.txt');
  await writeFile(staged, stripBom(decodeText(await readFile(input.path)).text), 'utf8');
  return staged;
}

/** Converts with pandoc; `title` is used only when the document has no title of its own. */
export async function convertWithPandoc(
  input: EngineFile,
  to: string,
  out: string,
  ctx: EngineContext,
): Promise<void> {
  const reader = READERS[input.format];
  const writer = WRITERS[to];
  if (!reader || !writer) {
    throw new VanillateError('conversion-unsupported', {
      detail: `pandoc ${input.format} → ${to}`,
    });
  }
  const binary = ctx.binaries.pandoc ?? 'pandoc';
  const sandboxed = await supportsSandbox(ctx, binary);
  if (!sandboxed && !ctx.runner.isolated) {
    throw new VanillateError('server-unavailable', {
      detail: 'pandoc needs --sandbox support or isolated engine processes for untrusted input',
    });
  }
  const dir = join(ctx.workDir, 'tmp', 'pandoc');
  await mkdir(dir, { recursive: true });
  const source = await stage(input, dir);
  // A metadata file only supplies values the document lacks (document metadata wins).
  const meta = join(dir, 'metadata.yaml');
  const stem = input.name.replace(/\.[^.]+$/, '') || 'Document';
  await writeFile(meta, `title: ${JSON.stringify(stem)}\n`);
  const args = [
    '+RTS',
    '-M1536M',
    '-RTS',
    ...(sandboxed ? ['--sandbox'] : []),
    '-f',
    reader,
    '-t',
    writer,
    `--metadata-file=${meta}`,
    `--resource-path=${dir}`,
    ...(STANDALONE.has(to) ? ['--standalone'] : []),
    ...(to === 'html' ? ['--embed-resources'] : []),
    '-o',
    out,
    source,
  ];
  const result = await ctx.runner.run(binary, args, runOptions(ctx));
  assertSuccess(result, 'pandoc', FAILURES);
  await requireFile(out, 'pandoc');
}

async function probe(runner: ProcessRunner): Promise<EngineProbe> {
  try {
    const result = await runner.run('pandoc', ['--version'], {
      cwd: '/',
      timeoutMs: 10_000,
      writable: [],
    });
    if (result.exitCode === 0)
      return { available: true, version: firstLine(result.stdout), binary: 'pandoc' };
  } catch {
    // not installed
  }
  return { available: false, version: null, binary: null };
}

async function run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]> {
  if (request.kind !== 'convert') {
    throw new VanillateError('conversion-unsupported', { detail: `pandoc ${request.operation}` });
  }
  const input = onlyInput(request);
  const out = join(request.outDir, `output.${extensionOf(ctx, request.to)}`);
  await convertWithPandoc(input, request.to, out, ctx);
  return [{ path: out, format: request.to }];
}

export const pandoc: ServerEngine = { id: 'pandoc', probe, run };
