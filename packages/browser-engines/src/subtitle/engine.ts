/**
 * Browser subtitle engine: conversions through the cue model, and a timing shift tool that
 * rewrites times in place so styling, notes and cue settings survive.
 */
import { VanillateError } from '@vanillate/core';

import type { BrowserEngine, BrowserOutputFile, BrowserTask, TaskContext } from '../types.ts';
import { corrupt, onlyInput, readText, textOutput } from '../util.ts';
import {
  formatClock,
  parseClock,
  readAss,
  readMicroDvd,
  readSbv,
  readSrt,
  readTtml,
  readVtt,
  writeAss,
  writeMicroDvd,
  writeSbv,
  writeSrt,
  writeTranscript,
  writeTtml,
  writeVtt,
  type Cue,
} from './codecs.ts';

function fpsOption(options: Record<string, unknown>): number {
  const fps = Number(options.subtitleFps);
  return Number.isFinite(fps) && fps > 0 ? fps : 23.976;
}

export function readCues(format: string, text: string, options: Record<string, unknown>): Cue[] {
  try {
    switch (format) {
      case 'srt':
        return readSrt(text);
      case 'vtt':
        return readVtt(text);
      case 'sbv':
        return readSbv(text);
      case 'ass':
      case 'ssa':
        return readAss(text);
      case 'sub':
        return readMicroDvd(text, fpsOption(options));
      case 'ttml':
      case 'dfxp':
        return readTtml(text);
      default:
        throw new VanillateError('conversion-unsupported', {
          detail: `cannot read ${format} subtitles`,
        });
    }
  } catch (error) {
    throw corrupt(error);
  }
}

export function writeCues(
  format: string,
  cues: readonly Cue[],
  options: Record<string, unknown>,
  title: string,
): string {
  switch (format) {
    case 'srt':
      return writeSrt(cues);
    case 'vtt':
      return writeVtt(cues);
    case 'sbv':
      return writeSbv(cues);
    case 'ass':
      return writeAss(cues, title);
    case 'sub':
      return writeMicroDvd(cues, fpsOption(options));
    case 'ttml':
    case 'dfxp':
      return writeTtml(cues);
    case 'txt':
      return writeTranscript(cues);
    default:
      throw new VanillateError('conversion-unsupported', {
        detail: `cannot write ${format} subtitles`,
      });
  }
}

// ------------------------------------------------------------------ shift

function shiftCues(cues: readonly Cue[], offset: number): Cue[] {
  return cues
    .map((cue) => ({ ...cue, start: Math.max(0, cue.start + offset), end: cue.end + offset }))
    .filter((cue) => cue.end > 0);
}

function shiftVtt(text: string, offset: number): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const out: string[] = [];
  blocks.forEach((block, index) => {
    if (index === 0) {
      out.push(block);
      return;
    }
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0 || timingIndex > 1 || /^(NOTE|STYLE|REGION)\b/.test(lines[0] ?? '')) {
      out.push(block);
      return;
    }
    const match = /^\s*([\d:.]+)\s*-->\s*([\d:.]+)(.*)$/.exec(lines[timingIndex] ?? '');
    if (!match) {
      out.push(block);
      return;
    }
    const end = parseClock(match[2] ?? '') + offset;
    if (end <= 0) return;
    const start = Math.max(0, parseClock(match[1] ?? '') + offset);
    lines[timingIndex] = `${formatClock(start, '.')} --> ${formatClock(end, '.')}${match[3] ?? ''}`;
    out.push(lines.join('\n'));
  });
  return `${out.join('\n\n').trimEnd()}\n`;
}

function shiftAss(text: string, offset: number): string {
  let fields: string[] = [];
  let inEvents = false;
  const out: string[] = [];
  const formatAss = (ms: number): string => {
    const centis = Math.max(0, Math.round(ms / 10));
    const h = Math.floor(centis / 360_000);
    const m = Math.floor((centis % 360_000) / 6000);
    const s = Math.floor((centis % 6000) / 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(centis % 100).padStart(2, '0')}`;
  };
  const parseAss = (value: string): number => {
    const match = /^\s*(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,2})\s*$/.exec(value);
    if (!match) return Number.NaN;
    return (
      ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 +
      Number((match[4] ?? '0').padEnd(2, '0')) * 10
    );
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (/^\[.*\]$/.test(trimmed)) inEvents = /^\[events\]$/i.test(trimmed);
    if (inEvents && /^format:/i.test(trimmed)) {
      fields = trimmed
        .slice(trimmed.indexOf(':') + 1)
        .split(',')
        .map((f) => f.trim().toLowerCase());
    }
    if (!inEvents || !/^(dialogue|comment):/i.test(trimmed)) {
      out.push(line);
      continue;
    }
    const colon = line.indexOf(':');
    const values = line.slice(colon + 1).split(',');
    const startIndex = fields.indexOf('start');
    const endIndex = fields.indexOf('end');
    if (startIndex < 0 || endIndex < 0) {
      out.push(line);
      continue;
    }
    const end = parseAss(values[endIndex] ?? '') + offset;
    if (!(end > 0)) continue;
    values[startIndex] = formatAss(Math.max(0, parseAss(values[startIndex] ?? '') + offset));
    values[endIndex] = formatAss(end);
    out.push(`${line.slice(0, colon + 1)}${values.join(',')}`);
  }
  return out.join('\n');
}

function shift(
  format: string,
  text: string,
  offset: number,
  options: Record<string, unknown>,
  title: string,
): string {
  switch (format) {
    case 'vtt':
      readVtt(text); // validates
      return shiftVtt(text, offset);
    case 'ass':
    case 'ssa':
      readAss(text);
      return shiftAss(text, offset);
    case 'srt':
    case 'sbv':
      return writeCues(format, shiftCues(readCues(format, text, options), offset), options, title);
    default:
      throw new VanillateError('conversion-unsupported', { detail: `cannot shift ${format}` });
  }
}

function convert(
  task: Extract<BrowserTask, { kind: 'conversion' }>,
  ctx: TaskContext,
): BrowserOutputFile[] {
  const input = onlyInput(task.inputs);
  const cues = readCues(task.from, readText(input), task.options);
  ctx.progress(0.6);
  return [
    textOutput(ctx.registry, input, task.to, writeCues(task.to, cues, task.options, input.name)),
  ];
}

function runTool(
  task: Extract<BrowserTask, { kind: 'tool' }>,
  ctx: TaskContext,
): BrowserOutputFile[] {
  if (task.operation !== 'shift')
    throw new VanillateError('conversion-unsupported', { detail: task.operation });
  const input = onlyInput(task.inputs);
  const offset = Number(task.options.offsetMs ?? 0);
  let result: string;
  try {
    result = shift(
      input.format,
      readText(input),
      Number.isFinite(offset) ? offset : 0,
      task.options,
      input.name,
    );
  } catch (error) {
    throw corrupt(error);
  }
  return [{ ...textOutput(ctx.registry, input, input.format, result), name: input.name }];
}

export const subtitleEngine: BrowserEngine = (task, ctx) =>
  Promise.resolve(task.kind === 'conversion' ? convert(task, ctx) : runTool(task, ctx));
