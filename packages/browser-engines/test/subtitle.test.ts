import { describe, expect, it } from 'vitest';

import { parseTtmlTime, readAss, readSrt, readTtml } from '../src/subtitle/codecs.ts';
import { convert, text, tool } from './helpers.ts';

const SRT = `1
00:00:01,000 --> 00:00:02,500
<i>Halo</i>, apa kabar?

2
00:00:03,000 --> 00:00:05,250
Baik,
terima kasih!
`;

const ASS = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}Halo{\\i0}, apa kabar?
Comment: 0,0:00:02.00,0:00:02.10,Default,,0,0,0,,ignored
Dialogue: 0,0:00:03.00,0:00:05.25,Default,,0,0,0,,{\\pos(10,10)}Baik,\\Nterima kasih!
`;

describe('subtitle codecs', () => {
  it('parses SRT with markup and multi-line cues', () => {
    expect(readSrt(SRT)).toEqual([
      { start: 1000, end: 2500, text: '<i>Halo</i>, apa kabar?' },
      { start: 3000, end: 5250, text: 'Baik,\nterima kasih!' },
    ]);
  });

  it('parses ASS dialogue with override tags and commas in text', () => {
    expect(readAss(ASS)).toEqual(readSrt(SRT));
  });

  it('parses TTML clock, offset and frame times', () => {
    expect(parseTtmlTime('00:01:02.5', { frameRate: 25, tickRate: 1 })).toBe(62_500);
    expect(parseTtmlTime('1.5s', { frameRate: 25, tickRate: 1 })).toBe(1500);
    expect(parseTtmlTime('50f', { frameRate: 25, tickRate: 1 })).toBe(2000);
    expect(parseTtmlTime('10000000t', { frameRate: 25, tickRate: 10_000_000 })).toBe(1000);
    const cues = readTtml(
      '<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="10s"><p begin="1s" end="2s">A<br/>\n  B</p><p begin="3s" dur="1s">C</p></div></body></tt>',
    );
    expect(cues).toEqual([
      { start: 11_000, end: 12_000, text: 'A\nB' },
      { start: 13_000, end: 14_000, text: 'C' },
    ]);
  });
});

describe('subtitle conversions', () => {
  it('SRT → VTT keeps basic markup', async () => {
    const [vtt] = await convert('srt', 'vtt', SRT);
    expect(text(vtt)).toBe(
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\n<i>Halo</i>, apa kabar?\n\n00:00:03.000 --> 00:00:05.250\nBaik,\nterima kasih!\n',
    );
  });

  it('VTT → SRT ignores notes, styles and cue settings', async () => {
    const vtt =
      'WEBVTT Kind: captions\n\nSTYLE\n::cue { color: red }\n\nNOTE hi\n\nintro\n00:01.000 --> 00:02.000 align:start\n<v Ani>Hi &amp; bye</v>\n';
    const [srt] = await convert('vtt', 'srt', vtt);
    expect(text(srt)).toBe('1\n00:00:01,000 --> 00:00:02,000\nHi & bye\n');
  });

  it('SRT → ASS → SRT round trip', async () => {
    const [ass] = await convert('srt', 'ass', SRT);
    expect(text(ass)).toContain(
      'Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}Halo{\\i0}, apa kabar?',
    );
    const [srt] = await convert('ass', 'srt', text(ass));
    expect(text(srt)).toBe(`${SRT.trim()}\n`);
  });

  it('MicroDVD uses the frame rate (and honours a declared one)', async () => {
    const [sub] = await convert('srt', 'sub', SRT, { subtitleFps: 25 });
    expect(text(sub)).toBe('{25}{63}Halo, apa kabar?\n{75}{131}Baik,|terima kasih!\n');
    const [srt] = await convert('sub', 'srt', '{1}{1}25\n{25}{50}Halo\n', { subtitleFps: 23.976 });
    expect(text(srt)).toBe('1\n00:00:01,000 --> 00:00:02,000\nHalo\n');
  });

  it('SRT → TTML → SRT and SBV', async () => {
    const [ttml] = await convert('srt', 'ttml', SRT);
    expect(text(ttml)).toContain(
      '<p begin="00:00:03.000" end="00:00:05.250">Baik,<br/>terima kasih!</p>',
    );
    const [srt] = await convert('ttml', 'srt', text(ttml));
    expect(text(srt)).toContain('Baik,\nterima kasih!');
    const [sbv] = await convert('srt', 'sbv', SRT);
    expect(text(sbv)).toBe(
      '0:00:01.000,0:00:02.500\nHalo, apa kabar?\n\n0:00:03.000,0:00:05.250\nBaik,\nterima kasih!\n',
    );
  });

  it('SRT → TXT produces a transcript', async () => {
    const [txt] = await convert('srt', 'txt', SRT);
    expect(text(txt)).toBe('Halo, apa kabar?\nBaik, terima kasih!\n');
  });

  it('rejects files without cues', async () => {
    await expect(convert('srt', 'vtt', 'not a subtitle')).rejects.toMatchObject({
      code: 'input-corrupt',
    });
  });
});

describe('subtitle shift tool', () => {
  it('shifts SRT and drops cues that end before zero', async () => {
    const [out] = await tool(
      'subtitle-shift',
      [{ name: 'film.srt', content: SRT, format: 'srt' }],
      { offsetMs: -2600 },
    );
    expect(text(out)).toBe('1\n00:00:00,400 --> 00:00:02,650\nBaik,\nterima kasih!\n');
    expect(out!.name).toBe('film.srt');
  });

  it('shifts VTT in place, keeping styles and settings', async () => {
    const vtt =
      'WEBVTT\n\nSTYLE\n::cue { color: red }\n\n00:01.000 --> 00:02.000 align:start\nHi\n';
    const [out] = await tool('subtitle-shift', [{ name: 'a.vtt', content: vtt, format: 'vtt' }], {
      offsetMs: 1500,
    });
    expect(text(out)).toBe(
      'WEBVTT\n\nSTYLE\n::cue { color: red }\n\n00:00:02.500 --> 00:00:03.500 align:start\nHi\n',
    );
  });

  it('shifts ASS dialogue in place, keeping styles', async () => {
    const [out] = await tool('subtitle-shift', [{ name: 'a.ass', content: ASS, format: 'ass' }], {
      offsetMs: 500,
    });
    const result = text(out);
    expect(result).toContain('Style: Default,Arial,20');
    expect(result).toContain(
      'Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\i1}Halo{\\i0}, apa kabar?',
    );
  });
});
