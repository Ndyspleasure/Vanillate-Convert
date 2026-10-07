/**
 * @vanillate/engines — server conversion engines and the sandboxed process runner.
 */
import { assimp } from './engines/assimp.ts';
import { exiftoolEngine } from './engines/exiftool.ts';
import { ffmpegEngine } from './engines/ffmpeg.ts';
import { fonttools } from './engines/fonttools.ts';
import { ghostscript } from './engines/ghostscript.ts';
import { imagemagick } from './engines/imagemagick.ts';
import { libreoffice } from './engines/libreoffice.ts';
import { pandoc } from './engines/pandoc.ts';
import { poppler } from './engines/poppler.ts';
import { qpdfEngine } from './engines/qpdf.ts';
import { rsvg } from './engines/rsvg.ts';
import { sevenzip } from './engines/sevenzip.ts';
import type { ProcessRunner } from './runner.ts';
import type { EngineProbe, ServerEngine } from './types.ts';

export type * from './types.ts';
export {
  ProcessRunner,
  bwrapAvailable,
  hasCommand,
  resolveSandbox,
  type EngineUser,
  type RunOptions,
  type RunResult,
  type SandboxMode,
} from './runner.ts';
export { executeConversion, executeTool, type EngineSet, type PipelineOutput } from './pipeline.ts';

/** Every server engine adapter, by catalog engine id. */
export const SERVER_ENGINES: Readonly<Record<string, ServerEngine>> = {
  assimp,
  exiftool: exiftoolEngine,
  ffmpeg: ffmpegEngine,
  fonttools,
  ghostscript,
  imagemagick,
  libreoffice,
  pandoc,
  poppler,
  qpdf: qpdfEngine,
  rsvg,
  sevenzip,
};

/** Probes engines (all by default) and reports which are installed. */
export async function probeEngines(
  runner: ProcessRunner,
  ids: readonly string[] = Object.keys(SERVER_ENGINES),
): Promise<Record<string, EngineProbe>> {
  const results: Record<string, EngineProbe> = {};
  await Promise.all(
    ids.map(async (id) => {
      const engine = SERVER_ENGINES[id];
      results[id] = engine
        ? await engine
            .probe(runner)
            .catch(() => ({ available: false, version: null, binary: null }))
        : { available: false, version: null, binary: null };
    }),
  );
  return results;
}
export { detectFile, inflateHead, sampleFile, type FileSample } from './files.ts';
