/**
 * Subtitle readers and writers around a neutral cue model.
 *
 * Cue text keeps a small markup subset — <i>, <b>, <u> — that SRT, WebVTT and ASS can all
 * express; other writers strip it.
 */
import { XMLParser } from 'fast-xml-parser';

export interface Cue {
  /** Milliseconds. */
  start: number;
  end: number;
  /** Text with "\n" line breaks and optional <i>/<b>/<u> markup. */
  text: string;
}

export class SubtitleError extends Error {
  override name = 'SubtitleError';
}

const MAX_CUES = 200_000;

function pushCue(cues: Cue[], cue: Cue): void {
  if (cues.length >= MAX_CUES) throw new SubtitleError('too many cues');
  if (Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end >= cue.start)
    cues.push(cue);
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Keeps only <i>, <b> and <u> tags (lowercased); removes every other tag. */
export function sanitizeMarkup(text: string): string {
  return text.replace(/<\/?([a-zA-Z][\w.-]*)(?:\s[^>]*)?>/g, (tag, name: string) => {
    const lower = name.toLowerCase();
    if (lower === 'i' || lower === 'b' || lower === 'u')
      return tag.startsWith('</') ? `</${lower}>` : `<${lower}>`;
    return '';
  });
}

export function stripMarkup(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// ------------------------------------------------------------- timestamps

/** Parses `[H]H:MM:SS(,|.)mmm` or `MM:SS.mmm`. */
export function parseClock(value: string): number {
  const match = /^\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?\s*$/.exec(value);
  if (!match) return Number.NaN;
  const [, h = '0', m = '0', s = '0', ms = '0'] = match;
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms.padEnd(3, '0'));
}

function pad(value: number, length: number): string {
  return String(Math.floor(value)).padStart(length, '0');
}

export function formatClock(ms: number, separator: ',' | '.', hourDigits = 2): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  return `${pad(h, hourDigits)}:${pad(m, 2)}:${pad(s, 2)}${separator}${pad(total % 1000, 3)}`;
}

function formatAssTime(ms: number): string {
  const centis = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(centis / 360_000);
  const m = Math.floor((centis % 360_000) / 6000);
  const s = Math.floor((centis % 6000) / 100);
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(centis % 100, 2)}`;
}

function parseAssTime(value: string): number {
  const match = /^\s*(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,3})\s*$/.exec(value);
  if (!match) return Number.NaN;
  const [, h = '0', m = '0', s = '0', frac = '0'] = match;
  const ms =
    frac.length === 1 ? Number(frac) * 100 : frac.length === 2 ? Number(frac) * 10 : Number(frac);
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + ms;
}

// -------------------------------------------------------------- SRT / VTT

const TIMING = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/;

export function readSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = normalizeNewlines(text).split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex < 0 || timingIndex > 1) continue;
    const match = TIMING.exec(lines[timingIndex] ?? '');
    if (!match) continue;
    const body = lines
      .slice(timingIndex + 1)
      .join('\n')
      .trim();
    pushCue(cues, {
      start: parseClock(match[1] ?? ''),
      end: parseClock(match[2] ?? ''),
      text: sanitizeMarkup(body),
    });
  }
  if (cues.length === 0 && text.trim() !== '') throw new SubtitleError('no subtitle cues found');
  return cues;
}

export function writeSrt(cues: readonly Cue[]): string {
  return cues
    .map(
      (cue, i) =>
        `${i + 1}\n${formatClock(cue.start, ',')} --> ${formatClock(cue.end, ',')}\n${cue.text}\n`,
    )
    .join('\n');
}

export function readVtt(text: string): Cue[] {
  const normalized = normalizeNewlines(text);
  if (!/^\uFEFF?WEBVTT/.test(normalized)) throw new SubtitleError('missing WEBVTT header');
  const cues: Cue[] = [];
  for (const block of normalized.split(/\n{2,}/).slice(1)) {
    const lines = block.split('\n');
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0] ?? '')) continue;
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0 || timingIndex > 1) continue;
    const match = TIMING.exec(lines[timingIndex] ?? '');
    if (!match) continue;
    const body = lines
      .slice(timingIndex + 1)
      .join('\n')
      .replace(/<\d{1,2}:\d{2}(?::\d{2})?\.\d{3}>/g, '') // karaoke timestamps
      .trim();
    pushCue(cues, {
      start: parseClock(match[1] ?? ''),
      end: parseClock(match[2] ?? ''),
      text: sanitizeMarkup(decodeEntities(body)),
    });
  }
  return cues;
}

function vttEscape(text: string): string {
  // Escape & and < that are not part of the allowed markup.
  return text.replace(/&/g, '&amp;').replace(/<(?!\/?[ibu]>)/g, '&lt;');
}

export function writeVtt(cues: readonly Cue[]): string {
  const body = cues
    .map(
      (cue) =>
        `${formatClock(cue.start, '.')} --> ${formatClock(cue.end, '.')}\n${vttEscape(cue.text.replace(/-->/g, '→'))}\n`,
    )
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

// -------------------------------------------------------------------- SBV

export function readSbv(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of normalizeNewlines(text).split(/\n{2,}/)) {
    const lines = block.trim().split('\n');
    const match = /^(\d+:\d{1,2}:\d{1,2}\.\d{1,3}),(\d+:\d{1,2}:\d{1,2}\.\d{1,3})$/.exec(
      (lines[0] ?? '').trim(),
    );
    if (!match) continue;
    pushCue(cues, {
      start: parseClock(match[1] ?? ''),
      end: parseClock(match[2] ?? ''),
      text: sanitizeMarkup(lines.slice(1).join('\n').trim()),
    });
  }
  if (cues.length === 0 && text.trim() !== '') throw new SubtitleError('no subtitle cues found');
  return cues;
}

export function writeSbv(cues: readonly Cue[]): string {
  return cues
    .map(
      (cue) =>
        `${formatClock(cue.start, '.', 1)},${formatClock(cue.end, '.', 1)}\n${stripMarkup(cue.text)}\n`,
    )
    .join('\n');
}

// --------------------------------------------------------------- ASS / SSA

function assTextToCue(text: string): string {
  let out = '';
  let open = { i: false, b: false, u: false };
  const parts = text.split(/(\{[^}]*\})/);
  for (const part of parts) {
    if (part.startsWith('{') && part.endsWith('}')) {
      for (const tag of ['i', 'b', 'u'] as const) {
        const match = new RegExp(`\\\\${tag}(\\d)`).exec(part);
        if (match) {
          const on = match[1] !== '0';
          if (on && !open[tag]) out += `<${tag}>`;
          if (!on && open[tag]) out += `</${tag}>`;
          open = { ...open, [tag]: on };
        }
      }
      continue;
    }
    out += part.replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ');
  }
  for (const tag of ['u', 'b', 'i'] as const) if (open[tag]) out += `</${tag}>`;
  return out.trim();
}

export function readAss(text: string): Cue[] {
  const cues: Cue[] = [];
  let inEvents = false;
  let fields: string[] = [];
  for (const raw of normalizeNewlines(text).split('\n')) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      inEvents = /^\[events\]$/i.test(line);
      continue;
    }
    if (!inEvents) continue;
    if (/^format:/i.test(line)) {
      fields = line
        .slice(line.indexOf(':') + 1)
        .split(',')
        .map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue:/i.test(line)) continue;
    const order =
      fields.length > 0
        ? fields
        : [
            'layer',
            'start',
            'end',
            'style',
            'name',
            'marginl',
            'marginr',
            'marginv',
            'effect',
            'text',
          ];
    const values = line.slice(line.indexOf(':') + 1).split(',');
    const textIndex = order.indexOf('text');
    const head = values.slice(0, textIndex).map((v) => v.trim());
    const body = values.slice(textIndex).join(',');
    const start = parseAssTime(head[order.indexOf('start')] ?? '');
    const end = parseAssTime(head[order.indexOf('end')] ?? '');
    pushCue(cues, { start, end, text: assTextToCue(body) });
  }
  if (cues.length === 0 && text.trim() !== '' && !/\[events\]/i.test(text))
    throw new SubtitleError('no [Events] section');
  return cues.sort((a, b) => a.start - b.start);
}

function cueTextToAss(text: string): string {
  return text
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
    .replace(/<(\/?)([ibu])>/g, (_, close: string, tag: string) => `{\\${tag}${close ? 0 : 1}}`)
    .replace(/\n/g, '\\N');
}

export function writeAss(cues: readonly Cue[], title = 'Vanillate Convert'): string {
  const header = [
    '[Script Info]',
    `Title: ${title.replace(/[\r\n]/g, ' ')}`,
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,40,40,50,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = cues.map(
    (cue) =>
      `Dialogue: 0,${formatAssTime(cue.start)},${formatAssTime(cue.end)},Default,,0,0,0,,${cueTextToAss(cue.text)}`,
  );
  return `${[...header, ...events].join('\n')}\n`;
}

// ---------------------------------------------------------------- MicroDVD

export function readMicroDvd(text: string, fps: number): Cue[] {
  const cues: Cue[] = [];
  let rate = fps;
  normalizeNewlines(text)
    .split('\n')
    .forEach((line, index) => {
      const match = /^\{(\d+)\}\{(\d*)\}(.*)$/.exec(line.trim());
      if (!match) return;
      const startFrame = Number(match[1]);
      const endFrame = match[2] === '' ? startFrame : Number(match[2]);
      const body = match[3] ?? '';
      // A first cue like {1}{1}23.976 declares the frame rate.
      if (index === 0 && startFrame <= 1 && endFrame <= 1 && /^\d+(\.\d+)?$/.test(body.trim())) {
        const declared = Number(body.trim());
        if (declared > 0 && declared < 1000) rate = declared;
        return;
      }
      const textBody = body
        .replace(/\{[yY]:i\}(.*)/g, '<i>$1</i>')
        .replace(/\{[yY]:b\}(.*)/g, '<b>$1</b>')
        .replace(/\{[^}]*\}/g, '')
        .replace(/\|/g, '\n')
        .replace(/\/(?=\S)/g, '');
      pushCue(cues, {
        start: Math.round((startFrame * 1000) / rate),
        end: Math.round((endFrame * 1000) / rate),
        text: sanitizeMarkup(textBody.trim()),
      });
    });
  if (cues.length === 0 && text.trim() !== '') throw new SubtitleError('no MicroDVD lines found');
  return cues;
}

export function writeMicroDvd(cues: readonly Cue[], fps: number): string {
  return `${cues
    .map((cue) => {
      const start = Math.round((cue.start * fps) / 1000);
      const end = Math.max(start, Math.round((cue.end * fps) / 1000));
      return `{${start}}{${end}}${stripMarkup(cue.text).replace(/\n/g, '|')}`;
    })
    .join('\n')}\n`;
}

// --------------------------------------------------------------- TTML/DFXP

interface TtmlTiming {
  frameRate: number;
  tickRate: number;
}

export function parseTtmlTime(value: string | undefined, timing: TtmlTiming): number {
  if (value === undefined) return Number.NaN;
  const v = value.trim();
  const clock = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?(?::(\d+(?:\.\d+)?))?$/.exec(v);
  if (clock) {
    const [, h = '0', m = '0', s = '0', frac, frames] = clock;
    let ms = ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
    if (frac !== undefined) ms += Number(`0.${frac}`) * 1000;
    if (frames !== undefined) ms += (Number(frames) / timing.frameRate) * 1000;
    return Math.round(ms);
  }
  const offset = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/.exec(v);
  if (offset) {
    const amount = Number(offset[1]);
    switch (offset[2] ?? '') {
      case 'h':
        return Math.round(amount * 3_600_000);
      case 'm':
        return Math.round(amount * 60_000);
      case 's':
        return Math.round(amount * 1000);
      case 'ms':
        return Math.round(amount);
      case 'f':
        return Math.round((amount / timing.frameRate) * 1000);
      case 't':
        return Math.round((amount / timing.tickRate) * 1000);
      default:
        return Number.NaN;
    }
  }
  return Number.NaN;
}

type XmlNode = Record<string, unknown>;

/** Line break sentinel for <br/> (a private-use character that `\s` does not match). */
const BR = '\uE000';

function nodeText(nodes: unknown): string {
  if (!Array.isArray(nodes)) return '';
  let out = '';
  for (const child of nodes as XmlNode[]) {
    for (const [key, value] of Object.entries(child)) {
      if (key === ':@') continue;
      if (key === '#text') out += String(value);
      else if (key.replace(/^.*:/, '') === 'br') out += BR;
      else out += nodeText(value);
    }
  }
  return out;
}

export function readTtml(text: string): Cue[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    preserveOrder: true,
    trimValues: false,
    processEntities: {
      enabled: true,
      maxEntityCount: 20,
      maxEntitySize: 1000,
      maxExpandedLength: 50_000,
      maxTotalExpansions: 500,
    },
  });
  const tree = parser.parse(text) as XmlNode[];
  const cues: Cue[] = [];
  let timing: TtmlTiming = { frameRate: 30, tickRate: 1 };

  const visit = (nodes: XmlNode[], parentOffset: number): void => {
    for (const node of nodes) {
      const attrs = (node[':@'] ?? {}) as Record<string, string>;
      for (const [key, value] of Object.entries(node)) {
        if (key === ':@' || key === '#text' || !Array.isArray(value)) continue;
        const local = key.replace(/^.*:/, '');
        if (local === 'tt') {
          const rate = Number(attrs['ttp:frameRate'] ?? attrs.frameRate ?? 30);
          const multiplier = (attrs['ttp:frameRateMultiplier'] ?? '1 1').split(/\s+/).map(Number);
          const tick = Number(attrs['ttp:tickRate'] ?? attrs.tickRate ?? rate);
          const factor = (multiplier[0] ?? 1) / (multiplier[1] ?? 1);
          timing = {
            frameRate: rate * (Number.isFinite(factor) && factor > 0 ? factor : 1) || 30,
            tickRate: tick || 1,
          };
        }
        const begin = parseTtmlTime(attrs.begin, timing);
        const offset = parentOffset + (Number.isFinite(begin) ? begin : 0);
        if (local === 'p') {
          const end = parseTtmlTime(attrs.end, timing);
          const dur = parseTtmlTime(attrs.dur, timing);
          const start = Number.isFinite(begin) ? parentOffset + begin : Number.NaN;
          const stop = Number.isFinite(end)
            ? parentOffset + end
            : Number.isFinite(dur)
              ? start + dur
              : Number.NaN;
          // Source whitespace (including newlines) is not significant in TTML; only <br/> is.
          const body = nodeText(value)
            .replace(/\s+/g, ' ')
            .split(BR)
            .map((line) => line.trim())
            .join('\n')
            .trim();
          pushCue(cues, { start, end: stop, text: sanitizeMarkup(body) });
          continue;
        }
        visit(value as XmlNode[], local === 'tt' ? 0 : offset);
      }
    }
  };
  visit(tree, 0);
  if (cues.length === 0 && text.trim() !== '') throw new SubtitleError('no timed paragraphs found');
  return cues.sort((a, b) => a.start - b.start);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function writeTtml(cues: readonly Cue[], lang = 'en'): string {
  const paragraphs = cues
    .map(
      (cue) =>
        `      <p begin="${formatClock(cue.start, '.')}" end="${formatClock(cue.end, '.')}">${stripMarkup(
          cue.text,
        )
          .split('\n')
          .map(escapeXml)
          .join('<br/>')}</p>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="${escapeXml(lang)}">
  <body>
    <div>
${paragraphs}
    </div>
  </body>
</tt>
`;
}

// --------------------------------------------------------------- plain text

export function writeTranscript(cues: readonly Cue[]): string {
  const lines: string[] = [];
  for (const cue of cues) {
    const text = stripMarkup(cue.text)
      .replace(/\s*\n\s*/g, ' ')
      .trim();
    if (text !== '' && lines[lines.length - 1] !== text) lines.push(text);
  }
  return `${lines.join('\n')}\n`;
}
