/**
 * Conversion tests against the real engines, driven through registry routes. Each engine's
 * tests are skipped when it is not installed (CI installs them in the worker image job).
 * Fixtures are generated on the fly; outputs are validated by content detection.
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  defaultOptionValues,
  VanillateError,
  type OptionValues,
  type Route,
  type ToolRoute,
} from '@vanillate/core';
import { describe, expect, it } from 'vitest';

import { POLICY_XML } from '../src/engines/imagemagick.ts';
import { executeConversion, executeTool, SERVER_ENGINES, type EngineFile } from '../src/index.ts';
import {
  detected,
  engineProbes,
  generate,
  makeJob,
  registry,
  textPdf,
  type TestJob,
} from './helpers.ts';

const probes = await engineProbes();
const has = (...ids: string[]): boolean => ids.every((id) => probes[id]?.available === true);
const SLOW = 180_000;

function serverRoute(from: string, to: string): Route {
  const route = registry.conversion(from, to)?.routes.find((r) => r.mode === 'server' && r.offered);
  if (!route) throw new Error(`no offered server route ${from} → ${to}`);
  return route;
}

function toolRoute(toolId: string): ToolRoute {
  const route = registry.tool(toolId)?.routes.find((r) => r.mode === 'server');
  if (!route) throw new Error(`no server route for tool ${toolId}`);
  return route;
}

async function convert(
  job: TestJob,
  from: string,
  to: string,
  inputs: EngineFile[],
  options: OptionValues = {},
) {
  const route = serverRoute(from, to);
  return executeConversion(
    route,
    inputs,
    { ...defaultOptionValues(route.options), ...options },
    job.outDir,
    job.ctx,
    SERVER_ENGINES,
  );
}

async function tool(
  job: TestJob,
  toolId: string,
  inputs: EngineFile[],
  options: OptionValues = {},
) {
  const route = toolRoute(toolId);
  const cardinality = registry.tool(toolId)?.cardinality;
  return executeTool(
    route,
    inputs,
    { ...defaultOptionValues(route.options), ...options },
    job.outDir,
    job.ctx,
    SERVER_ENGINES,
    cardinality === 'n:1',
  );
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof VanillateError && error.code === code,
    `expected ${code}`,
  );
}

async function withJob(
  fn: (job: TestJob) => Promise<void>,
  limits?: Parameters<typeof makeJob>[0],
) {
  const job = await makeJob(limits);
  try {
    await fn(job);
  } finally {
    await job.cleanup();
  }
}

// ---------------------------------------------------------------------------------------------

describe.skipIf(!has('imagemagick'))('ImageMagick', () => {
  async function png(job: TestJob, name = 'photo.png', size = '64x48'): Promise<EngineFile> {
    await generate(
      probes.imagemagick?.binary ?? 'convert',
      ['-size', size, 'gradient:red-blue', join(job.dir, 'in', name)],
      job.dir,
    );
    return {
      path: join(job.dir, 'in', name),
      name,
      format: 'png',
      size: (await stat(join(job.dir, 'in', name))).size,
    };
  }

  it('converts PNG to every raster target', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const input = await png(job);
      for (const to of ['jpg', 'webp', 'gif', 'bmp', 'tiff', 'ico', 'jp2', 'tga']) {
        const [output] = await convert(job, 'png', to, [input]);
        expect(output?.format).toBe(to);
        expect(await detected(output?.path ?? '', `x.${to}`), to).toBe(to);
      }
    }),
  );

  it('downscales but never enlarges', () =>
    withJob(async (job) => {
      const input = await png(job, 'big.png', '400x200');
      const [small] = await convert(job, 'png', 'webp', [input], { width: 100 });
      const header = await readFile(small?.path ?? '');
      expect(header.subarray(0, 4).toString()).toBe('RIFF');
      const [same] = await convert(job, 'png', 'bmp', [input], { width: 4000 });
      const bmp = await readFile(same?.path ?? '');
      expect(bmp.readUInt32LE(18)).toBe(400);
    }));

  it('combines images into one PDF in order', () =>
    withJob(async (job) => {
      const a = await png(job, 'a.png', '40x30');
      const b = await png(job, 'b.png', '30x40');
      const outputs = await convert(job, 'png', 'pdf', [a, b]);
      expect(outputs).toHaveLength(1);
      const pdf = await readFile(outputs[0]?.path ?? '');
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.toString('latin1')).toContain('/Count 2');
    }));

  it('runs under the Vanillate security policy', () =>
    withJob(async (job) => {
      const dir = join(job.dir, 'tmp', 'policy');
      await generate('mkdir', ['-p', dir], job.dir);
      await writeFile(join(dir, 'policy.xml'), POLICY_XML);
      const result = await job.ctx.runner.run(
        probes.imagemagick?.binary ?? 'convert',
        ['-list', 'policy'],
        {
          cwd: job.dir,
          timeoutMs: 20_000,
          writable: [job.dir],
          env: { MAGICK_CONFIGURE_PATH: dir },
        },
      );
      expect(result.stdout).toContain(`${dir}/policy.xml`);
      expect(result.stdout).toMatch(/Policy: Delegate\s+rights: None\s+pattern: \*/);
      // Enforced, not just listed: script coders are refused.
      const script = join(dir, 'x.msl');
      await writeFile(script, '<image><read filename="/etc/hostname"/></image>');
      const blocked = await job.ctx.runner.run(
        probes.imagemagick?.binary ?? 'convert',
        [`MSL:${script}`, join(dir, 'out.png')],
        {
          cwd: job.dir,
          timeoutMs: 20_000,
          writable: [job.dir],
          env: { MAGICK_CONFIGURE_PATH: dir },
        },
      );
      expect(blocked.exitCode).not.toBe(0);
      expect(blocked.stderr).toMatch(/not allowed by the security policy|not authorized/i);
    }));

  it('refuses images above the pixel limit before decoding', () =>
    withJob(
      async (job) => {
        const input = await png(job, 'wide.png', '300x200');
        await expectCode(convert(job, 'png', 'jpg', [input]), 'image-too-large');
      },
      { limits: { maxPixels: 10_000 } },
    ));

  it('reports corrupt input', () =>
    withJob(async (job) => {
      const bytes = new Uint8Array(200);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const input = await job.file('broken.png', bytes, 'png');
      await expect(convert(job, 'png', 'jpg', [input])).rejects.toBeInstanceOf(VanillateError);
    }));
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!has('ffmpeg'))('FFmpeg', () => {
  async function video(job: TestJob, name = 'clip.mp4', extra: string[] = []): Promise<EngineFile> {
    const path = join(job.dir, 'in', name);
    await generate(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=161x121:rate=15:duration=2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2',
        ...extra,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv444p',
        '-c:a',
        'aac',
        '-shortest',
        '-metadata',
        'title=Clip Title',
        path,
      ],
      job.dir,
    );
    return { path, name, format: 'mp4', size: (await stat(path)).size };
  }

  it('transcodes video with odd dimensions to WebM, MKV and AVI', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const input = await video(job);
      for (const to of ['webm', 'mkv', 'avi']) {
        const [output] = await convert(job, 'mp4', to, [input], { videoQuality: 'small' });
        expect(await detected(output?.path ?? '', `x.${to}`), to).toBe(to);
      }
      expect(job.progress.at(-1)).toBeGreaterThan(0.5);
    }),
  );

  it('extracts audio and keeps tags', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const input = await video(job);
      const [mp3] = await convert(job, 'mp4', 'mp3', [input]);
      expect(await detected(mp3?.path ?? '', 'x.mp3')).toBe('mp3');
      expect((await readFile(mp3?.path ?? '')).toString('latin1')).toContain('Clip Title');
    }),
  );

  it('converts between audio formats', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const input = await video(job);
      const [wav] = await convert(job, 'mp4', 'wav', [input]);
      const wavFile: EngineFile = {
        path: wav?.path ?? '',
        name: 'tone.wav',
        format: 'wav',
        size: 1,
      };
      for (const to of ['flac', 'ogg', 'opus', 'm4a', 'aac', 'mka']) {
        const [output] = await convert(
          job,
          'wav',
          to,
          [wavFile],
          to === 'mka' ? {} : { channels: 'mono' },
        );
        expect(await detected(output?.path ?? '', `x.${to}`), to).toBe(to);
      }
    }),
  );

  it('makes an animated GIF with a palette', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const input = await video(job);
      const [gif] = await convert(job, 'mp4', 'gif', [input], { width: 80, fps: 5 });
      const bytes = await readFile(gif?.path ?? '');
      expect(bytes.subarray(0, 6).toString()).toBe('GIF89a');
      expect(bytes.readUInt16LE(6)).toBeLessThanOrEqual(80);
    }),
  );

  it('extracts text subtitles and reports videos without them', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const srt = join(job.dir, 'in', 'subs.srt');
      await writeFile(srt, '1\n00:00:00,500 --> 00:00:01,500\nHello subtitles\n');
      const input = await video(job, 'subbed.mkv', [
        '-i',
        srt,
        '-map',
        '0:v',
        '-map',
        '1:a',
        '-map',
        '2:s',
        '-c:s',
        'srt',
      ]);
      const mkv: EngineFile = { ...input, format: 'mkv' };
      const [vtt] = await convert(job, 'mkv', 'vtt', [mkv]);
      expect(await readFile(vtt?.path ?? '', 'utf8')).toContain('Hello subtitles');
      const plain = await video(job, 'plain.mkv');
      await expectCode(
        convert(job, 'mkv', 'srt', [{ ...plain, format: 'mkv' }]),
        'no-subtitle-track',
      );
    }),
  );

  it('rejects media over the duration limit before transcoding', () =>
    withJob(
      async (job) => {
        const input = await video(job);
        await expectCode(convert(job, 'mp4', 'mp3', [input]), 'media-too-long');
      },
      { limits: { maxDurationSeconds: 1 } },
    ));

  it('reports a missing audio track', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const path = join(job.dir, 'in', 'silent.mp4');
      await generate(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=64x48:rate=5:duration=1',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          path,
        ],
        job.dir,
      );
      await expectCode(
        convert(job, 'mp4', 'mp3', [{ path, name: 'silent.mp4', format: 'mp4', size: 1 }]),
        'no-audio-track',
      );
    }),
  );

  it('compresses video with the video-compressor tool', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const input = await video(job, 'clip.mov');
      const [output] = await tool(job, 'video-compressor', [{ ...input, format: 'mov' }], {
        resolution: 360,
      });
      expect(await detected(output?.path ?? '', 'x.mp4')).toBe('mp4');
    }),
  );
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!has('libreoffice'))('LibreOffice', () => {
  it('converts text and CSV, keeping CSV formulas as text', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const txt = await job.file('notes.txt', 'Hello from Vanillate\nLine two\n', 'txt');
      const [docx] = await convert(job, 'txt', 'docx', [txt]);
      expect(await detected(docx?.path ?? '', 'x.docx')).toBe('docx');

      const csv = await job.file('data.csv', 'name;value\nalpha;=1+1\n', 'csv');
      const [xlsx] = await convert(job, 'csv', 'xlsx', [csv]);
      expect(await detected(xlsx?.path ?? '', 'x.xlsx')).toBe('xlsx');
      const [back] = await convert(job, 'xlsx', 'csv', [
        { path: xlsx?.path ?? '', name: 'data.xlsx', format: 'xlsx', size: 1 },
      ]);
      const text = await readFile(back?.path ?? '', 'utf8');
      expect(text).toContain('alpha');
      expect(text).toContain('=1+1');
      expect(text).not.toMatch(/alpha,2\b/);
    }),
  );

  it('renders documents to PDF and to images through the pipeline', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const txt = await job.file('notes.txt', 'Page one text\n', 'txt');
      const [docx] = await convert(job, 'txt', 'docx', [txt]);
      const doc: EngineFile = {
        path: docx?.path ?? '',
        name: 'notes.docx',
        format: 'docx',
        size: 1,
      };
      const [pdf] = await convert(job, 'docx', 'pdf', [doc]);
      expect(await detected(pdf?.path ?? '', 'x.pdf')).toBe('pdf');
      if (has('poppler')) {
        const images = await convert(job, 'docx', 'png', [doc], { dpi: 50 });
        expect(images.length).toBeGreaterThanOrEqual(1);
        expect(await detected(images[0]?.path ?? '', 'x.png')).toBe('png');
      }
    }),
  );

  it('fails on garbage instead of importing it as text', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const bytes = new Uint8Array(4096).map((_, i) => (i * 131 + 7) % 256);
      const input = await job.file('fake.docx', bytes, 'docx');
      await expect(convert(job, 'docx', 'pdf', [input])).rejects.toBeInstanceOf(VanillateError);
    }),
  );
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!has('poppler'))('Poppler', () => {
  it('renders selected pages, extracts text and HTML', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const input = await job.file(
        'doc.pdf',
        textPdf(['First page', 'Second page', 'Third page']),
        'pdf',
      );
      const pages = await convert(job, 'pdf', 'png', [input], { dpi: 40, pageRange: '1,3' });
      expect(pages.map((p) => p.part)).toEqual([
        { index: 1, total: 2 },
        { index: 2, total: 2 },
      ]);
      expect(await detected(pages[0]?.path ?? '', 'x.png')).toBe('png');
      const [txt] = await convert(job, 'pdf', 'txt', [input], { pageRange: '2-3' });
      const text = await readFile(txt?.path ?? '', 'utf8');
      expect(text).toContain('Second page');
      expect(text).not.toContain('First page');
      const [html] = await convert(job, 'pdf', 'html', [input], { pageRange: '1,3' });
      const markup = await readFile(html?.path ?? '', 'utf8');
      expect(markup).toContain('Third');
      expect(markup).not.toContain('Second');
      const svgs = await convert(job, 'pdf', 'svg', [input], { pageRange: '2' });
      expect(svgs).toHaveLength(1);
    }),
  );

  it('keeps the files of a multi-file job apart', { timeout: SLOW }, () =>
    withJob(async (job) => {
      // Regression: engines once reused fixed scratch folders, mixing pages across inputs.
      const a = await job.file('a.pdf', textPdf(['A one', 'A two']), 'pdf');
      const b = await job.file('b.pdf', textPdf(['B one']), 'pdf');
      const pages = await convert(job, 'pdf', 'png', [a, b], { dpi: 30 });
      expect(pages.map((p) => [p.inputIndex, p.label])).toEqual([
        [0, 'page-1'],
        [0, 'page-2'],
        [1, 'page-1'],
      ]);
      const texts = await convert(job, 'pdf', 'txt', [a, b]);
      expect(await readFile(texts[0]?.path ?? '', 'utf8')).toContain('A two');
      expect(await readFile(texts[1]?.path ?? '', 'utf8')).toContain('B one');
      expect(await readFile(texts[1]?.path ?? '', 'utf8')).not.toContain('A one');
    }),
  );

  it('validates page ranges and page limits', () =>
    withJob(
      async (job) => {
        const input = await job.file('doc.pdf', textPdf(['a', 'b', 'c']), 'pdf');
        await expectCode(
          convert(job, 'pdf', 'png', [input], { pageRange: '7' }),
          'page-range-invalid',
        );
        await expectCode(convert(job, 'pdf', 'png', [input]), 'too-many-pages');
      },
      { limits: { maxPages: 2 } },
    ));
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!has('qpdf'))('qpdf', () => {
  it('merges, splits, extracts and rotates pages', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const a = await job.file('a.pdf', textPdf(['A1', 'A2']), 'pdf');
      const b = await job.file('b.pdf', textPdf(['B1']), 'pdf');
      const [merged] = await tool(job, 'pdf-merger', [a, b]);
      expect((await readFile(merged?.path ?? '')).toString('latin1')).toMatch(/\/Count 3/);

      const parts = await tool(job, 'pdf-splitter', [a]);
      expect(parts).toHaveLength(2);
      expect(parts.map((p) => p.label)).toEqual(['page-1', 'page-2']);

      const [selected] = await tool(job, 'pdf-page-extractor', [a], { pageRange: '2' });
      expect((await readFile(selected?.path ?? '')).toString('latin1')).toMatch(/\/Count 1/);
      await expectCode(
        tool(job, 'pdf-page-extractor', [a], { pageRange: '' }),
        'page-range-invalid',
      );

      const [rotated] = await tool(job, 'pdf-rotator', [a], { rotate: 90 });
      expect((await readFile(rotated?.path ?? '')).toString('latin1')).toMatch(/\/Rotate 90/);
    }),
  );

  it('reports password-protected PDFs', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const plain = await job.file('plain.pdf', textPdf(['secret']), 'pdf');
      const encrypted = join(job.dir, 'in', 'locked.pdf');
      await generate(
        'qpdf',
        ['--encrypt', 'user', 'owner', '256', '--', plain.path, encrypted],
        job.dir,
      );
      await expectCode(
        tool(job, 'pdf-splitter', [
          { path: encrypted, name: 'locked.pdf', format: 'pdf', size: 1 },
        ]),
        'password-protected',
      );
    }),
  );
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!has('ghostscript'))('Ghostscript', () => {
  it('compresses PDFs without ever growing them', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const input = await job.file('doc.pdf', textPdf(['Compress me']), 'pdf');
      const [output] = await tool(job, 'pdf-compressor', [input]);
      expect(await detected(output?.path ?? '', 'x.pdf')).toBe('pdf');
      expect((await stat(output?.path ?? '')).size).toBeLessThanOrEqual(input.size);
    }),
  );

  it('converts EPS to PDF and PNG', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const eps = await job.file(
        'shape.eps',
        '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 50\nnewpath 10 10 moveto 90 40 lineto stroke showpage\n',
        'eps',
      );
      const [pdf] = await convert(job, 'eps', 'pdf', [eps]);
      expect(await detected(pdf?.path ?? '', 'x.pdf')).toBe('pdf');
      const pngs = await convert(job, 'eps', 'png', [eps], { dpi: 72 });
      expect(pngs).toHaveLength(1);
      expect(await detected(pngs[0]?.path ?? '', 'x.png')).toBe('png');
    }),
  );

  it('blocks file access from PostScript (SAFER)', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const ps = await job.file(
        'evil.ps',
        '%!PS\n/Helvetica findfont 12 scalefont setfont 72 700 moveto (/etc/passwd) (r) file 100 string readstring pop show showpage\n',
        'ps',
      );
      await expect(convert(job, 'ps', 'pdf', [ps])).rejects.toBeInstanceOf(VanillateError);
    }),
  );
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!has('pandoc'))('Pandoc', () => {
  it('converts Markdown to DOCX, HTML and EPUB, and back', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const md = await job.file(
        'readme.md',
        '# Title\n\nSome *emphasis* and a [link](https://example.com).\n',
        'md',
      );
      for (const to of ['docx', 'html', 'epub', 'odt']) {
        const [output] = await convert(job, 'md', to, [md]);
        expect(await detected(output?.path ?? '', `x.${to}`), to).toBe(to);
      }
      // Without document metadata the file name is the title; document metadata wins.
      const [html] = await convert(job, 'md', 'html', [md]);
      expect(await readFile(html?.path ?? '', 'utf8')).toContain('<title>readme</title>');
      const page = await job.file('readme.html', await readFile(html?.path ?? ''), 'html');
      const [back] = await convert(job, 'html', 'md', [page]);
      expect(await readFile(back?.path ?? '', 'utf8')).toContain('*emphasis*');
      const titled = await job.file('titled.md', '---\ntitle: Real Title\n---\n\nBody\n', 'md');
      const [titledHtml] = await convert(job, 'md', 'html', [titled]);
      expect(await readFile(titledHtml?.path ?? '', 'utf8')).toContain('<title>Real Title</title>');
    }),
  );

  it('does not include local files referenced by the document', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const tex = await job.file(
        'evil.tex',
        '\\documentclass{article}\\begin{document}X\\input{/etc/passwd}\\end{document}',
        'tex',
      );
      const [txt] = await convert(job, 'tex', 'txt', [tex]);
      expect(await readFile(txt?.path ?? '', 'utf8')).not.toContain('root:');
    }),
  );

  it(
    'converts Markdown to PDF through LibreOffice',
    { timeout: SLOW, skip: !has('libreoffice') },
    () =>
      withJob(async (job) => {
        const md = await job.file('readme.md', '# Title\n\nBody text.\n', 'md');
        const [pdf] = await convert(job, 'md', 'pdf', [md]);
        expect(await detected(pdf?.path ?? '', 'x.pdf')).toBe('pdf');
      }),
  );
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!has('sevenzip'))('7-Zip', () => {
  const zip = async (
    job: TestJob,
    name: string,
    files: Record<string, string>,
  ): Promise<EngineFile> => {
    const src = join(job.dir, 'tmp', `src-${name}`);
    for (const [path, content] of Object.entries(files)) {
      const full = join(src, path);
      await generate('mkdir', ['-p', join(full, '..')], job.dir);
      await writeFile(full, content);
    }
    const out = join(job.dir, 'in', name);
    await generate(probes.sevenzip?.binary ?? '7z', ['a', '-tzip', '-bd', '-y', out, '*'], src);
    return { path: out, name, format: 'zip', size: (await stat(out)).size };
  };

  it('extracts archives with their folder structure', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const input = await zip(job, 'docs.zip', { 'a.txt': 'alpha', 'sub/b.txt': 'beta' });
      const outputs = await tool(job, 'archive-extractor', [input]);
      expect(outputs.map((o) => o.entryPath)).toEqual(['a.txt', 'sub/b.txt']);
      expect(outputs.every((o) => o.format === null)).toBe(true);
      expect(await readFile(outputs[1]?.path ?? '', 'utf8')).toBe('beta');
    }),
  );

  it('repacks to every archive format and back', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const input = await zip(job, 'docs.zip', { 'a.txt': 'alpha', 'sub/b.txt': 'beta' });
      for (const to of ['7z', 'tar', 'tgz', 'tbz2', 'txz']) {
        const [output] = await convert(job, 'zip', to, [input]);
        expect(await detected(output?.path ?? '', `x.${to === 'tgz' ? 'tar.gz' : to}`), to).toBe(
          to,
        );
        // A fresh job, as in production: each job only sees its own directory.
        const roundTrip = await makeJob();
        try {
          const copy = await roundTrip.file(`x.${to}`, await readFile(output?.path ?? ''), to);
          const files = await tool(roundTrip, 'archive-extractor', [copy]);
          expect(
            files.map((f) => f.entryPath),
            to,
          ).toEqual(['a.txt', 'sub/b.txt']);
        } finally {
          await roundTrip.cleanup();
        }
      }
    }),
  );

  it('refuses traversal, links and encrypted archives', { timeout: SLOW }, () =>
    withJob(async (job) => {
      // ZIP with a "../evil.txt" entry, written by hand (stored, no compression).
      const evil = await job.file(
        'evil.zip',
        storedZip({ 'ok.txt': 'ok', '../evil.txt': 'bad' }),
        'zip',
      );
      await expectCode(tool(job, 'archive-extractor', [evil]), 'archive-unsafe');

      const encrypted = join(job.dir, 'in', 'locked.zip');
      const plain = join(job.dir, 'tmp', 'plain.txt');
      await writeFile(plain, 'secret');
      await generate(
        probes.sevenzip?.binary ?? '7z',
        ['a', '-tzip', '-pxyz', '-bd', '-y', encrypted, plain],
        job.dir,
      );
      await expectCode(
        tool(job, 'archive-extractor', [
          { path: encrypted, name: 'locked.zip', format: 'zip', size: 1 },
        ]),
        'password-protected',
      );
    }),
  );

  it('stops archives that expand beyond the limit, even when headers lie', { timeout: SLOW }, () =>
    withJob(
      async (job) => {
        const zeros = gzipSync(Buffer.alloc(30 * 1024 * 1024));
        // Rewrite the gzip size trailer so the listing claims a tiny file.
        zeros.writeUInt32LE(10, zeros.length - 4);
        const input = await job.file('zeros.gz', zeros, 'gz');
        await expectCode(
          tool(job, 'archive-extractor', [{ ...input, format: 'gz' }]),
          'archive-too-large',
        );
      },
      {
        limits: {
          archive: { ...registry.archiveLimits, maxExtractedBytes: 5 * 1024 * 1024 },
        },
      },
    ),
  );
});

/** Minimal stored (uncompressed) ZIP writer, to craft unsafe entry names. */
function storedZip(files: Record<string, string>): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (data: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of data) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]));
}

// ---------------------------------------------------------------------------------------------

describe.skipIf(!has('rsvg'))('librsvg', () => {
  it('renders SVG to PNG at the requested size and to PDF', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const svg = await job.file(
        'icon.svg',
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="teal"/></svg>',
        'svg',
      );
      const [png] = await convert(job, 'svg', 'png', [svg], { width: 200 });
      const bytes = await readFile(png?.path ?? '');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([200, 100]);
      const [pdf] = await convert(job, 'svg', 'pdf', [svg]);
      expect(await detected(pdf?.path ?? '', 'x.pdf')).toBe('pdf');
    }),
  );

  it('caps giant canvases instead of exhausting memory', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const svg = await job.file(
        'huge.svg',
        '<svg xmlns="http://www.w3.org/2000/svg" width="200000" height="100000"><rect width="10" height="10"/></svg>',
        'svg',
      );
      const [png] = await convert(job, 'svg', 'png', [svg]);
      const bytes = await readFile(png?.path ?? '');
      expect(bytes.readUInt32BE(16)).toBeLessThanOrEqual(16384);
    }),
  );
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!has('assimp'))('assimp', () => {
  const cube = [
    'v 0 0 0',
    'v 1 0 0',
    'v 1 1 0',
    'v 0 1 0',
    'v 0 0 1',
    'v 1 0 1',
    'v 1 1 1',
    'v 0 1 1',
    'f 1 2 3 4',
    'f 5 6 7 8',
    'f 1 2 6 5',
    'f 2 3 7 6',
    'f 3 4 8 7',
    'f 4 1 5 8',
  ].join('\n');

  it('converts OBJ meshes to STL and GLB', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const obj = await job.file('cube.obj', `${cube}\n`, 'obj');
      const [glb] = await convert(job, 'obj', 'glb', [obj]);
      expect((await readFile(glb?.path ?? '')).subarray(0, 4).toString()).toBe('glTF');
      const [stl] = await convert(job, 'obj', 'stl', [obj]);
      expect((await stat(stl?.path ?? '')).size).toBeGreaterThan(84);

      // OBJ output: mesh and material library named after the input, linked by that name.
      const mesh = await job.file('My Cube.stl', await readFile(stl?.path ?? ''), 'stl');
      const objOutputs = await convert(job, 'stl', 'obj', [mesh]);
      expect(objOutputs.map((o) => o.entryPath).sort()).toEqual(['My_Cube.mtl', 'My_Cube.obj']);
      const model = objOutputs.find((o) => o.entryPath === 'My_Cube.obj');
      expect(await readFile(model?.path ?? '', 'utf8')).toContain('mtllib My_Cube.mtl');
    }),
  );
});

// ---------------------------------------------------------------------------------------------

describe.skipIf(!has('exiftool', 'imagemagick'))('ExifTool', () => {
  it('shows metadata without server details and strips private data', { timeout: SLOW }, () =>
    withJob(async (job) => {
      const path = join(job.dir, 'in', 'photo.jpg');
      await generate(
        probes.imagemagick?.binary ?? 'convert',
        ['-size', '32x24', 'xc:orange', path],
        job.dir,
      );
      await generate(
        'exiftool',
        [
          '-q',
          '-overwrite_original',
          '-GPSLatitude=12.34',
          '-GPSLatitudeRef=N',
          '-Artist=Secret Person',
          path,
        ],
        job.dir,
      );
      const input: EngineFile = {
        path,
        name: 'photo.jpg',
        format: 'jpg',
        size: (await stat(path)).size,
      };

      const [json] = await tool(job, 'metadata-viewer', [input]);
      const metadata = JSON.parse(await readFile(json?.path ?? '', 'utf8')) as Record<
        string,
        unknown
      >;
      expect(metadata['IFD0:Artist']).toBe('Secret Person');
      expect(JSON.stringify(metadata)).not.toContain(job.dir);
      expect(metadata.SourceFile).toBeUndefined();

      const [stripped] = await tool(job, 'metadata-remover', [input]);
      const bytes = (await readFile(stripped?.path ?? '')).toString('latin1');
      expect(bytes).not.toContain('Secret Person');
      expect(await detected(stripped?.path ?? '', 'x.jpg')).toBe('jpg');
    }),
  );
});

// ---------------------------------------------------------------------------------------------

const TTF = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const OTF = '/usr/share/fonts/opentype/urw-base35/URWBookman-Light.otf';

describe.skipIf(!has('fonttools'))('fontTools', () => {
  it('wraps TrueType fonts as WOFF2 and back', { timeout: SLOW }, async () => {
    const source = await readFile(TTF).catch(() => null);
    if (!source) return;
    await withJob(async (job) => {
      const ttf = await job.file('font.ttf', source, 'ttf');
      const [woff2] = await convert(job, 'ttf', 'woff2', [ttf]);
      expect((await readFile(woff2?.path ?? '')).subarray(0, 4).toString()).toBe('wOF2');
      const wrapped: EngineFile = {
        path: woff2?.path ?? '',
        name: 'font.woff2',
        format: 'woff2',
        size: 1,
      };
      const [back] = await convert(job, 'woff2', 'ttf', [wrapped]);
      expect(await detected(back?.path ?? '', 'x.ttf')).toBe('ttf');
      // TrueType outlines cannot become an OTF (CFF) font by re-wrapping.
      await expectCode(convert(job, 'woff2', 'otf', [wrapped]), 'font-flavor-mismatch');
    });
  });

  it('refuses to relabel CFF fonts as TrueType', { timeout: SLOW }, async () => {
    const source = await readFile(OTF).catch(() => null);
    if (!source) return;
    await withJob(async (job) => {
      const otf = await job.file('font.otf', source, 'otf');
      const [woff] = await convert(job, 'otf', 'woff', [otf]);
      const wrapped: EngineFile = {
        path: woff?.path ?? '',
        name: 'font.woff',
        format: 'woff',
        size: 1,
      };
      await expectCode(convert(job, 'woff', 'ttf', [wrapped]), 'font-flavor-mismatch');
      const [back] = await convert(job, 'woff', 'otf', [wrapped]);
      expect(await detected(back?.path ?? '', 'x.otf')).toBe('otf');
    });
  });
});
