/**
 * LibreOffice adapter (headless Writer, Calc, Impress and Draw).
 *
 * - Every job gets a fresh user profile inside the job directory, with macros disabled and
 *   link updates turned off, so documents cannot run code or pull in other files.
 * - The import filter is forced from the detected format; LibreOffice otherwise falls back to
 *   importing unknown bytes as plain text and "succeeds" with garbage.
 * - Text inputs are normalized to UTF-8 first; CSV delimiters are detected and formulas in CSV
 *   cells are kept as text (no formula injection into spreadsheets).
 */
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { sniffDelimiter } from '@vanillate/browser-engines/csv';
import { decodeText, stripBom, VanillateError, type ErrorCode } from '@vanillate/core';

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
  ensureDir,
  extensionOf,
  firstLine,
  grant,
  onlyInput,
  requireFile,
  runOptions,
  scratchDir,
} from '../util.ts';

type Family = 'writer' | 'calc' | 'impress' | 'draw';

interface ImportSpec {
  family: Family;
  filter: string;
  /** Text inputs are re-encoded to UTF-8 before import. */
  text?: boolean;
}

export const IMPORT_FILTERS: Record<string, ImportSpec> = {
  doc: { family: 'writer', filter: 'MS Word 97' },
  docx: { family: 'writer', filter: 'MS Word 2007 XML' },
  odt: { family: 'writer', filter: 'writer8' },
  rtf: { family: 'writer', filter: 'Rich Text Format' },
  txt: { family: 'writer', filter: 'Text (encoded):UTF8', text: true },
  html: { family: 'writer', filter: 'HTML (StarWriter)' },
  wpd: { family: 'writer', filter: 'WordPerfect' },
  pages: { family: 'writer', filter: 'Apple Pages' },
  pdf: { family: 'writer', filter: 'writer_pdf_import' },
  xls: { family: 'calc', filter: 'MS Excel 97' },
  xlsx: { family: 'calc', filter: 'Calc MS Excel 2007 XML' },
  xlsm: { family: 'calc', filter: 'Calc MS Excel 2007 VBA XML' },
  xlsb: { family: 'calc', filter: 'Calc MS Excel 2007 Binary' },
  ods: { family: 'calc', filter: 'calc8' },
  csv: { family: 'calc', filter: 'Text - txt - csv (StarCalc)', text: true },
  dbf: { family: 'calc', filter: 'dBase' },
  numbers: { family: 'calc', filter: 'Apple Numbers' },
  ppt: { family: 'impress', filter: 'MS PowerPoint 97' },
  pptx: { family: 'impress', filter: 'Impress MS PowerPoint 2007 XML' },
  ppsx: { family: 'impress', filter: 'Impress MS PowerPoint 2007 XML AutoPlay' },
  odp: { family: 'impress', filter: 'impress8' },
  key: { family: 'impress', filter: 'Apple Keynote' },
  emf: { family: 'draw', filter: 'EMF - MS Windows Metafile' },
  wmf: { family: 'draw', filter: 'WMF - MS Windows Metafile' },
  cdr: { family: 'draw', filter: 'Corel Draw Document' },
  dxf: { family: 'draw', filter: 'DXF - AutoCAD Interchange' },
};

/**
 * CSV options: separator, `"` quotes, UTF-8, from line 1, standard cell formats, default
 * language, quoted fields as text off, special-number detection off, …, formula evaluation
 * off (token 13).
 */
const CSV_IMPORT_TAIL = '34,76,1,,0,false,false,false,false,false,0,false';
/** CSV export: comma, `"` quotes, UTF-8. */
const CSV_EXPORT = 'Text - txt - csv (StarCalc):44,34,76,1';

export const EXPORT_FILTERS: Record<Family, Record<string, string>> = {
  writer: {
    pdf: 'writer_pdf_Export',
    docx: 'MS Word 2007 XML',
    doc: 'MS Word 97',
    odt: 'writer8',
    rtf: 'Rich Text Format',
    txt: 'Text (encoded):UTF8',
    html: 'HTML (StarWriter):EmbedImages',
    epub: 'EPUB',
  },
  calc: {
    xlsx: 'Calc MS Excel 2007 XML',
    xls: 'MS Excel 97',
    ods: 'calc8',
    csv: CSV_EXPORT,
    pdf: 'calc_pdf_Export',
    html: 'HTML (StarCalc)',
  },
  impress: {
    pptx: 'Impress MS PowerPoint 2007 XML',
    ppt: 'MS PowerPoint 97',
    odp: 'impress8',
    pdf: 'impress_pdf_Export',
  },
  draw: {
    pdf: 'draw_pdf_Export',
    svg: 'draw_svg_Export',
    png: 'draw_png_Export',
  },
};

const CSV_DELIMITER_CODES: Record<string, number> = { ',': 44, ';': 59, '\t': 9, '|': 124 };

/** Profile settings: no macros, no link updates, no remote resources, no first-run work. */
const REGISTRY = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseOpenCL" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="FirstRun" oor:op="fuse"><value>false</value></prop></item>
</oor:items>
`;

const FAILURES: [RegExp, ErrorCode][] = [
  [/password|encrypted/i, 'password-protected'],
  [
    /source file could not be loaded|general input\/output error|Error: Please verify input parameters/i,
    'input-corrupt',
  ],
];

async function probe(runner: ProcessRunner): Promise<EngineProbe> {
  for (const binary of ['soffice', 'libreoffice']) {
    try {
      const result = await runner.run(binary, ['--version'], {
        cwd: '/',
        timeoutMs: 30_000,
        writable: [],
      });
      if (result.exitCode === 0 && /LibreOffice/i.test(result.stdout)) {
        return { available: true, version: firstLine(result.stdout), binary };
      }
    } catch {
      // try the next binary
    }
  }
  return { available: false, version: null, binary: null };
}

/** Copies (or re-encodes) the input into the LibreOffice work directory with its extension. */
async function stageInput(
  path: string,
  format: string,
  spec: ImportSpec,
  dir: string,
  ctx: EngineContext,
): Promise<{ path: string; filter: string }> {
  const staged = join(dir, `input.${extensionOf(ctx, format)}`);
  if (!spec.text) {
    await copyFile(path, staged);
    return { path: staged, filter: spec.filter };
  }
  const text = stripBom(decodeText(await readFile(path)).text);
  await writeFile(staged, text, 'utf8');
  if (format !== 'csv') return { path: staged, filter: spec.filter };
  const code = CSV_DELIMITER_CODES[sniffDelimiter(text)] ?? 44;
  return { path: staged, filter: `${spec.filter}:${code},${CSV_IMPORT_TAIL}` };
}

/** Converts one file; returns the path of the converted file inside `dir`. */
export async function convertWithLibreOffice(
  input: { path: string; format: string },
  to: string,
  ctx: EngineContext,
): Promise<string> {
  const spec = IMPORT_FILTERS[input.format];
  const exportFilter = spec ? EXPORT_FILTERS[spec.family][to] : undefined;
  if (!spec || !exportFilter) {
    throw new VanillateError('conversion-unsupported', {
      detail: `libreoffice ${input.format} → ${to}`,
    });
  }
  const dir = await scratchDir(ctx, 'libreoffice');
  const profile = join(dir, 'profile');
  const outDir = await ensureDir(ctx, join(dir, 'out'));
  await ensureDir(ctx, join(profile, 'user'));
  const registry = join(profile, 'user', 'registrymodifications.xcu');
  await writeFile(registry, REGISTRY);
  await grant(ctx, registry);
  const staged = await stageInput(input.path, input.format, spec, dir, ctx);
  ctx.progress(0.1);

  const binary = ctx.binaries.libreoffice ?? 'soffice';
  const ext = extensionOf(ctx, to);
  const result = await ctx.runner.run(
    binary,
    [
      '--headless',
      '--invisible',
      '--nologo',
      '--nodefault',
      '--nofirststartwizard',
      '--nolockcheck',
      '--norestore',
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      `--infilter=${staged.filter}`,
      '--convert-to',
      `${ext}:${exportFilter}`,
      '--outdir',
      outDir,
      staged.path,
    ],
    runOptions(ctx, { env: { SAL_USE_VCLPLUGIN: 'svp' } }),
  );
  assertSuccess(result, 'libreoffice', FAILURES);
  // LibreOffice can exit 0 without writing anything when a document fails to load.
  return requireFile(join(outDir, `input.${ext}`), 'libreoffice');
}

async function run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]> {
  if (request.kind !== 'convert') {
    throw new VanillateError('conversion-unsupported', {
      detail: `libreoffice operation ${request.operation}`,
    });
  }
  const input = onlyInput(request);
  const converted = await convertWithLibreOffice(input, request.to, ctx);
  const out = join(request.outDir, `output.${extensionOf(ctx, request.to)}`);
  await rename(converted, out);
  return [{ path: out, format: request.to }];
}

export const libreoffice: ServerEngine = { id: 'libreoffice', probe, run };
