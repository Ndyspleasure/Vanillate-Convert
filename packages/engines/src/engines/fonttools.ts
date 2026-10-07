/**
 * fontTools adapter: TTF/OTF ↔ WOFF/WOFF2 wrapping (lossless; outlines are untouched).
 *
 * TrueType (`glyf`) and CFF outlines are different formats; converting between them would
 * change the glyphs, so a mismatch is reported to the user instead of producing a mislabeled
 * file. Python is chosen at probe time: `VANILLATE_PYTHON`, then `python3` and versioned names,
 * whichever has both fontTools and brotli (needed for WOFF2).
 */
import { join } from 'node:path';

import { VanillateError, isErrorCode } from '@vanillate/core';

import type {
  EngineContext,
  EngineOutput,
  EngineProbe,
  EngineRequest,
  ProcessRunner,
  ServerEngine,
} from '../types.ts';
import { assertSuccess, extensionOf, onlyInput, requireFile, runOptions } from '../util.ts';

const SCRIPT = `
import sys
from fontTools.ttLib import TTFont
src, dst, target = sys.argv[1], sys.argv[2], sys.argv[3]
def fail(code, detail=''):
    sys.stderr.write('VANILLATE_ERROR %s %s\\n' % (code, detail))
    sys.exit(3)
try:
    font = TTFont(src, recalcBBoxes=False, recalcTimestamp=False)
    tables = set(font.keys())
except Exception as error:
    fail('input-corrupt', repr(error)[:300])
cff = 'CFF ' in tables or 'CFF2' in tables
if 'glyf' not in tables and not cff:
    fail('input-corrupt', 'no outlines')
if target == 'ttf' and cff:
    fail('font-flavor-mismatch', 'CFF outlines cannot be stored as TTF')
if target == 'otf' and not cff:
    fail('font-flavor-mismatch', 'TrueType outlines cannot be stored as OTF')
font.flavor = target if target in ('woff', 'woff2') else None
font.save(dst, reorderTables=True)
`;

const PYTHONS = ['python3', 'python3.13', 'python3.12', 'python3.11'];

async function probe(runner: ProcessRunner): Promise<EngineProbe> {
  const candidates = [process.env.VANILLATE_PYTHON, ...PYTHONS].filter(
    (name): name is string => typeof name === 'string' && name !== '',
  );
  for (const binary of candidates) {
    try {
      const result = await runner.run(
        binary,
        ['-I', '-c', 'import fontTools, fontTools.ttLib, brotli; print(fontTools.version)'],
        { cwd: '/', timeoutMs: 15_000, writable: [] },
      );
      if (result.exitCode === 0) {
        return { available: true, version: `fontTools ${result.stdout.trim()}`, binary };
      }
    } catch {
      // try the next interpreter
    }
  }
  return { available: false, version: null, binary: null };
}

async function run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]> {
  if (request.kind !== 'convert') {
    throw new VanillateError('conversion-unsupported', {
      detail: `fonttools ${request.operation}`,
    });
  }
  if (!['ttf', 'otf', 'woff', 'woff2'].includes(request.to)) {
    throw new VanillateError('conversion-unsupported', {
      detail: `fonttools cannot write ${request.to}`,
    });
  }
  const input = onlyInput(request);
  const out = join(request.outDir, `output.${extensionOf(ctx, request.to)}`);
  const result = await ctx.runner.run(
    ctx.binaries.fonttools ?? 'python3',
    ['-I', '-c', SCRIPT, input.path, out, request.to],
    runOptions(ctx),
  );
  const reported = /VANILLATE_ERROR (\S+)/.exec(result.stderr)?.[1];
  if (result.exitCode !== 0 && reported && isErrorCode(reported)) {
    throw new VanillateError(reported, { detail: `fonttools: ${result.stderr.slice(-500)}` });
  }
  assertSuccess(result, 'fonttools');
  return [{ path: await requireFile(out, 'fonttools'), format: request.to }];
}

export const fonttools: ServerEngine = { id: 'fonttools', probe, run };
