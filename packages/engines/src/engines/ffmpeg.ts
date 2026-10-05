/**
 * FFmpeg adapter: audio/video transcoding, audio extraction, animated GIF, subtitle
 * extraction and video compression.
 *
 * Security: the demuxer is forced from the detected format (`-f`, or a demuxer allowlist),
 * only the `file` protocol is allowed, stdin is closed, decoders refuse frames above the
 * pixel limit, and every input is probed with ffprobe first so duration and stream checks
 * run before any decoding work. Output duration is capped as a second line of defence.
 */
import { join } from 'node:path';

import { VanillateError, type ErrorCode } from '@vanillate/core';

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
  num,
  onlyInput,
  runOptions,
  sibling,
  str,
} from '../util.ts';

// ------------------------------------------------------------------ demuxers

/** Demuxer(s) allowed per input format. One entry forces it; several form an allowlist. */
const DEMUXERS: Record<string, readonly string[]> = {
  mp3: ['mp3'],
  wav: ['wav'],
  flac: ['flac'],
  aac: ['aac'],
  m4a: ['mov'],
  m4r: ['mov'],
  alac: ['mov'],
  ogg: ['ogg'],
  opus: ['ogg'],
  aiff: ['aiff'],
  wma: ['asf'],
  amr: ['amr'],
  ac3: ['ac3', 'eac3'],
  dts: ['dts'],
  ape: ['ape'],
  mka: ['matroska'],
  mp4: ['mov'],
  m4v: ['mov'],
  mov: ['mov'],
  mkv: ['matroska'],
  webm: ['matroska'],
  avi: ['avi'],
  wmv: ['asf'],
  asf: ['asf'],
  flv: ['flv'],
  mpg: ['mpeg', 'mpegvideo'],
  vob: ['mpeg'],
  ts: ['mpegts'],
  m2ts: ['mpegts'],
  '3gp': ['mov'],
  '3g2': ['mov'],
  ogv: ['ogg'],
  rm: ['rm'],
  gif: ['gif'],
  apng: ['apng'],
};

function demuxerArgs(format: string): string[] {
  const demuxers = DEMUXERS[format];
  if (!demuxers) {
    throw new VanillateError('conversion-unsupported', { detail: `ffmpeg cannot read ${format}` });
  }
  return demuxers.length === 1
    ? ['-f', demuxers[0] ?? '']
    : ['-format_whitelist', demuxers.join(',')];
}

const FAILURES: [RegExp, ErrorCode][] = [
  [/exceeds specified max pixel count|Picture size \d+x\d+ is invalid/i, 'image-too-large'],
  [
    /Invalid data found when processing input|moov atom not found|could not find codec parameters|EBML header parsing failed|Header missing|Error while decoding stream|no decoder|Decoder .* not found|Error opening input/i,
    'input-corrupt',
  ],
];

// ------------------------------------------------------------------ probing

interface StreamInfo {
  index: number;
  type: string;
  codec: string;
  width: number;
  height: number;
  /** Average frame rate; null when unknown. */
  frameRate: number | null;
  frameRateText: string | null;
  sampleRate: number;
  channels: number;
  sampleFormat: string;
  bits: number;
  attachedPic: boolean;
}

export interface MediaInfo {
  duration: number | null;
  streams: StreamInfo[];
}

function rational(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const [n, d] = text.split('/').map(Number);
  if (n === undefined || !Number.isFinite(n) || n <= 0) return null;
  const value = d === undefined ? n : d > 0 ? n / d : NaN;
  return Number.isFinite(value) && value > 0 && value < 1000 ? value : null;
}

function int(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

/** Parses `ffprobe -of json` output defensively (the input file controls most values). */
export function parseProbe(json: string): MediaInfo {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new VanillateError('input-corrupt', { detail: 'ffprobe returned invalid JSON' });
  }
  const root = (data ?? {}) as { format?: { duration?: unknown }; streams?: unknown };
  const duration = Number(root.format?.duration);
  const streams = Array.isArray(root.streams) ? root.streams : [];
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    streams: streams.map((raw: unknown): StreamInfo => {
      const s = (raw ?? {}) as Record<string, unknown>;
      const disposition = (s.disposition ?? {}) as Record<string, unknown>;
      const frameRateText =
        typeof s.avg_frame_rate === 'string' && rational(s.avg_frame_rate) !== null
          ? s.avg_frame_rate
          : typeof s.r_frame_rate === 'string' && rational(s.r_frame_rate) !== null
            ? s.r_frame_rate
            : null;
      return {
        index: int(s.index),
        type: typeof s.codec_type === 'string' ? s.codec_type : '',
        codec: typeof s.codec_name === 'string' ? s.codec_name : '',
        width: int(s.width),
        height: int(s.height),
        frameRate: rational(frameRateText),
        frameRateText,
        sampleRate: int(s.sample_rate),
        channels: int(s.channels),
        sampleFormat: typeof s.sample_fmt === 'string' ? s.sample_fmt : '',
        bits: int(s.bits_per_raw_sample),
        attachedPic: int(disposition.attached_pic) === 1,
      };
    }),
  };
}

function ffmpegBinary(ctx: EngineContext): string {
  return ctx.binaries.ffmpeg ?? 'ffmpeg';
}

async function probeMedia(input: EngineFile, ctx: EngineContext): Promise<MediaInfo> {
  const options = runOptions(ctx);
  const result = await ctx.runner.run(
    sibling(ffmpegBinary(ctx), 'ffprobe'),
    [
      '-v',
      'error',
      '-hide_banner',
      '-protocol_whitelist',
      'file',
      ...demuxerArgs(input.format),
      '-show_entries',
      'format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels,sample_fmt,bits_per_raw_sample:stream_disposition=attached_pic',
      '-of',
      'json',
      `file:${input.path}`,
    ],
    { ...options, timeoutMs: Math.min(options.timeoutMs, 60_000) },
  );
  assertSuccess(result, 'ffprobe', FAILURES);
  const info = parseProbe(result.stdout);
  if (info.duration !== null && info.duration > ctx.limits.maxDurationSeconds) {
    throw new VanillateError('media-too-long', { detail: `${Math.round(info.duration)} s` });
  }
  const video = videoStream(info);
  if (video && video.width * video.height > ctx.limits.maxPixels) {
    throw new VanillateError('image-too-large', { detail: `${video.width}×${video.height}` });
  }
  return info;
}

function videoStream(info: MediaInfo): StreamInfo | undefined {
  return info.streams.find((s) => s.type === 'video' && !s.attachedPic);
}

function audioStream(info: MediaInfo): StreamInfo | undefined {
  return info.streams.find((s) => s.type === 'audio');
}

const encoderCache = new Map<string, Promise<Set<string>>>();

/** Encoders compiled into this FFmpeg build (cached per binary). */
function encoders(ctx: EngineContext): Promise<Set<string>> {
  const binary = ffmpegBinary(ctx);
  let cached = encoderCache.get(binary);
  if (!cached) {
    cached = ctx.runner
      .run(binary, ['-hide_banner', '-encoders'], { ...runOptions(ctx), timeoutMs: 15_000 })
      .then((result) => {
        const names = new Set<string>();
        for (const line of result.stdout.split('\n')) {
          const match = /^\s[VAS][A-Z.]{5}\s+(\S+)/.exec(line);
          if (match?.[1]) names.add(match[1]);
        }
        return names;
      });
    encoderCache.set(binary, cached);
    cached.catch(() => encoderCache.delete(binary));
  }
  return cached;
}

// ------------------------------------------------------------------ running

interface RunSpec {
  /** Expected output duration, for progress. */
  duration: number | null;
  /** Progress range covered by this invocation. */
  range: [number, number];
}

/** Runs ffmpeg with progress reporting; returns the last output timestamp in seconds. */
async function ffmpeg(ctx: EngineContext, args: string[], spec: RunSpec): Promise<number> {
  let outTime = 0;
  let pending = '';
  const [start, end] = spec.range;
  const result = await ctx.runner.run(
    ffmpegBinary(ctx),
    ['-hide_banner', '-nostdin', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', ...args],
    runOptions(ctx, {
      stdoutLimit: 64 * 1024,
      onStdout: (chunk) => {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const match = /^out_time_us=(\d+)/.exec(line);
          if (!match) continue;
          outTime = Number(match[1]) / 1e6;
          if (spec.duration) {
            ctx.progress(start + (end - start) * Math.min(1, outTime / spec.duration));
          }
        }
      },
    }),
  );
  assertSuccess(result, 'ffmpeg', FAILURES);
  return outTime;
}

function inputArgs(input: EngineFile, ctx: EngineContext): string[] {
  return [
    '-threads',
    '2',
    '-max_pixels',
    String(ctx.limits.maxPixels),
    '-protocol_whitelist',
    'file',
    ...demuxerArgs(input.format),
    '-i',
    `file:${input.path}`,
  ];
}

/** Output options shared by every conversion: thread cap and duration cap. */
function outputCaps(ctx: EngineContext): string[] {
  return ['-threads', '2', '-t', String(ctx.limits.maxDurationSeconds + 1)];
}

function checkTruncation(info: MediaInfo, outTime: number, ctx: EngineContext): void {
  if (info.duration === null && outTime >= ctx.limits.maxDurationSeconds) {
    throw new VanillateError('media-too-long', { detail: 'duration unknown; output hit the cap' });
  }
}

/** Global tags of the source; Ogg keeps them on the audio stream instead. */
function metadataArgs(input: EngineFile, info: MediaInfo): string[] {
  return ['ogg', 'opus', 'ogv'].includes(input.format) && audioStream(info)
    ? ['-map_metadata', '0:s:a:0']
    : ['-map_metadata', '0'];
}

// ------------------------------------------------------------------ audio

interface AudioTarget {
  muxer: string;
  /** Encoder, or a resolver based on the source stream. */
  codec: string | ((source: StreamInfo) => string[]);
  lossy: boolean;
  /** Highest sample rate the encoder accepts (user choices above it are clamped). */
  maxRate?: number;
  extra?: string[];
}

const hiRes = (source: StreamInfo): boolean => source.bits > 16;

/** Codecs Matroska can hold as-is (remuxed without re-encoding). */
const MKA_COPY = new Set([
  'mp3',
  'mp2',
  'aac',
  'flac',
  'vorbis',
  'opus',
  'ac3',
  'eac3',
  'dts',
  'alac',
  'truehd',
  'wavpack',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_s32le',
  'pcm_f32le',
]);

const AUDIO: Record<string, AudioTarget> = {
  mp3: {
    muxer: 'mp3',
    codec: 'libmp3lame',
    lossy: true,
    maxRate: 48000,
    extra: ['-id3v2_version', '3'],
  },
  wav: {
    muxer: 'wav',
    codec: (s) => ['-c:a', hiRes(s) ? 'pcm_s24le' : 'pcm_s16le'],
    lossy: false,
  },
  flac: {
    muxer: 'flac',
    codec: (s) => ['-c:a', 'flac', '-sample_fmt', hiRes(s) ? 's32' : 's16'],
    lossy: false,
  },
  aac: { muxer: 'adts', codec: 'aac', lossy: true },
  m4a: { muxer: 'ipod', codec: 'aac', lossy: true, extra: ['-movflags', '+faststart'] },
  m4r: { muxer: 'ipod', codec: 'aac', lossy: true, extra: ['-movflags', '+faststart'] },
  alac: {
    muxer: 'ipod',
    codec: (s) => ['-c:a', 'alac', '-sample_fmt', hiRes(s) ? 's32p' : 's16p'],
    lossy: false,
    extra: ['-movflags', '+faststart'],
  },
  ogg: { muxer: 'ogg', codec: 'libvorbis', lossy: true },
  opus: { muxer: 'opus', codec: 'libopus', lossy: true },
  aiff: {
    muxer: 'aiff',
    codec: (s) => ['-c:a', hiRes(s) ? 'pcm_s24be' : 'pcm_s16be'],
    lossy: false,
  },
  wma: { muxer: 'asf', codec: 'wmav2', lossy: true, maxRate: 48000 },
  ac3: { muxer: 'ac3', codec: 'ac3', lossy: true },
  mka: { muxer: 'matroska', codec: 'copy', lossy: false },
};

function audioArgs(to: string, options: Record<string, unknown>, source: StreamInfo): string[] {
  const target = AUDIO[to];
  if (!target) throw new VanillateError('conversion-unsupported', { detail: `ffmpeg audio ${to}` });
  const sampleRate = num(options.sampleRate, 0);
  const channels = str(options.channels, 'source');
  const args: string[] = [];
  const reshape = sampleRate > 0 || channels !== 'source';
  if (target.codec === 'copy') {
    // Matroska audio: remux when nothing changes, otherwise re-encode losslessly.
    if (!reshape && MKA_COPY.has(source.codec)) args.push('-c:a', 'copy');
    else args.push('-c:a', 'flac', '-sample_fmt', hiRes(source) ? 's32' : 's16');
  } else if (typeof target.codec === 'string') {
    args.push('-c:a', target.codec);
  } else {
    args.push(...target.codec(source));
  }
  if (target.lossy) args.push('-b:a', `${num(options.audioBitrate, 192)}k`);
  if (sampleRate > 0) args.push('-ar', String(Math.min(sampleRate, target.maxRate ?? sampleRate)));
  if (channels === 'mono') args.push('-ac', '1');
  else if (channels === 'stereo') args.push('-ac', '2');
  else if (to === 'opus' && source.channels > 2) {
    // libopus only accepts standard surround layouts.
    args.push('-af', 'aformat=channel_layouts=7.1|5.1|stereo');
  }
  args.push(...(target.extra ?? []), '-f', target.muxer);
  return args;
}

async function convertAudio(
  input: EngineFile,
  to: string,
  options: Record<string, unknown>,
  out: string,
  ctx: EngineContext,
): Promise<void> {
  const info = await probeMedia(input, ctx);
  const audio = audioStream(info);
  if (!audio) throw new VanillateError('no-audio-track');
  ctx.progress(0.05);
  const outTime = await ffmpeg(
    ctx,
    [
      '-y',
      ...inputArgs(input, ctx),
      '-map',
      `0:${audio.index}`,
      '-vn',
      '-sn',
      '-dn',
      ...metadataArgs(input, info),
      ...audioArgs(to, options, audio),
      ...outputCaps(ctx),
      `file:${out}`,
    ],
    { duration: info.duration, range: [0.05, 1] },
  );
  checkTruncation(info, outTime, ctx);
}

// ------------------------------------------------------------------ video

type VideoCodec = 'h264' | 'h265' | 'vp9' | 'av1' | 'mpeg4' | 'mpeg2' | 'theora' | 'wmv2';
type Quality = 'high' | 'balanced' | 'small';
type AudioCodec = 'aac' | 'opus' | 'mp3' | 'wma' | 'mp2' | 'vorbis';

interface VideoTarget {
  muxer: string;
  /** Allowed codecs; the first is the default. */
  codecs: readonly VideoCodec[];
  audio: (codec: VideoCodec) => AudioCodec;
  extra?: (codec: VideoCodec) => string[];
}

const FASTSTART = (): string[] => ['-movflags', '+faststart'];

const VIDEO: Record<string, VideoTarget> = {
  mp4: { muxer: 'mp4', codecs: ['h264', 'h265', 'av1'], audio: () => 'aac', extra: FASTSTART },
  m4v: { muxer: 'mp4', codecs: ['h264'], audio: () => 'aac', extra: FASTSTART },
  mov: { muxer: 'mov', codecs: ['h264', 'h265'], audio: () => 'aac', extra: FASTSTART },
  mkv: {
    muxer: 'matroska',
    codecs: ['h264', 'h265', 'vp9', 'av1'],
    audio: (c) => (c === 'vp9' || c === 'av1' ? 'opus' : 'aac'),
  },
  webm: { muxer: 'webm', codecs: ['vp9', 'av1'], audio: () => 'opus' },
  avi: {
    muxer: 'avi',
    codecs: ['mpeg4', 'h264'],
    audio: () => 'mp3',
    extra: (c) => (c === 'mpeg4' ? ['-tag:v', 'XVID'] : []),
  },
  wmv: { muxer: 'asf', codecs: ['wmv2'], audio: () => 'wma' },
  flv: { muxer: 'flv', codecs: ['h264'], audio: () => 'aac' },
  mpg: { muxer: 'vob', codecs: ['mpeg2'], audio: () => 'mp2' },
  ts: {
    muxer: 'mpegts',
    codecs: ['h264', 'h265', 'mpeg2'],
    audio: (c) => (c === 'mpeg2' ? 'mp2' : 'aac'),
  },
  '3gp': {
    muxer: '3gp',
    codecs: ['h264'],
    audio: () => 'aac',
    extra: () => ['-profile:v', 'baseline', '-level:v', '3.1', ...FASTSTART()],
  },
  ogv: { muxer: 'ogg', codecs: ['theora'], audio: () => 'vorbis' },
};

const CRF: Record<'h264' | 'h265' | 'vp9' | 'av1', Record<Quality, number>> = {
  h264: { high: 18, balanced: 23, small: 28 },
  h265: { high: 20, balanced: 26, small: 30 },
  vp9: { high: 24, balanced: 32, small: 40 },
  av1: { high: 26, balanced: 34, small: 44 },
};

/** Quantizer for legacy codecs (lower is better), or Theora quality (higher is better). */
const QSCALE: Record<Quality, number> = { high: 2, balanced: 4, small: 7 };
const THEORA_QUALITY: Record<Quality, number> = { high: 9, balanced: 7, small: 5 };

/** Codecs with a fixed timebase that need constant frame rate. */
const CFR_CODECS = new Set<VideoCodec>(['mpeg4', 'mpeg2', 'wmv2', 'theora']);
const MPEG2_RATES = [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60];
const MPEG2_RATE_TEXT = ['24000/1001', '24', '25', '30000/1001', '30', '50', '60000/1001', '60'];

function videoCodecArgs(codec: VideoCodec, quality: Quality, available: Set<string>): string[] {
  switch (codec) {
    case 'h264':
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(CRF.h264[quality])];
    case 'h265':
      return [
        '-c:v',
        'libx265',
        '-preset',
        'medium',
        '-crf',
        String(CRF.h265[quality]),
        '-x265-params',
        'log-level=error',
      ];
    case 'vp9':
      return [
        '-c:v',
        'libvpx-vp9',
        '-crf',
        String(CRF.vp9[quality]),
        '-b:v',
        '0',
        '-deadline',
        'good',
        '-cpu-used',
        '4',
        '-row-mt',
        '1',
      ];
    case 'av1':
      if (available.has('libsvtav1')) {
        return ['-c:v', 'libsvtav1', '-crf', String(CRF.av1[quality]), '-preset', '8'];
      }
      if (available.has('libaom-av1')) {
        return [
          '-c:v',
          'libaom-av1',
          '-crf',
          String(CRF.av1[quality]),
          '-b:v',
          '0',
          '-cpu-used',
          '6',
          '-row-mt',
          '1',
        ];
      }
      throw new VanillateError('conversion-unsupported', { detail: 'no AV1 encoder available' });
    case 'mpeg4':
      return ['-c:v', 'mpeg4', '-q:v', String(QSCALE[quality])];
    case 'mpeg2':
      return ['-c:v', 'mpeg2video', '-q:v', String(QSCALE[quality])];
    case 'wmv2':
      return ['-c:v', 'wmv2', '-q:v', String(QSCALE[quality])];
    case 'theora':
      return ['-c:v', 'libtheora', '-q:v', String(THEORA_QUALITY[quality])];
  }
}

function audioCodecArgs(codec: AudioCodec, bitrate: number): string[] {
  switch (codec) {
    case 'aac':
      return ['-c:a', 'aac', '-b:a', `${bitrate}k`];
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', `${bitrate}k`];
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', `${bitrate}k`];
    case 'wma':
      return ['-c:a', 'wmav2', '-b:a', `${Math.min(bitrate, 192)}k`];
    case 'mp2':
      return ['-c:a', 'mp2', '-b:a', `${Math.min(bitrate, 384)}k`];
    case 'vorbis':
      return ['-c:a', 'libvorbis', '-b:a', `${bitrate}k`];
  }
}

/** Output frame rate for codecs that need CFR (MPEG-2 only allows standard rates). */
function cfrRate(codec: VideoCodec, requested: number, source: StreamInfo): string | null {
  if (!CFR_CODECS.has(codec) && requested <= 0) return null;
  if (codec === 'mpeg2') {
    const rate = requested > 0 ? requested : Math.min(source.frameRate ?? 25, 60);
    let best = 0;
    for (const [i, candidate] of MPEG2_RATES.entries()) {
      if (Math.abs(candidate - rate) < Math.abs((MPEG2_RATES[best] ?? 0) - rate)) best = i;
    }
    return MPEG2_RATE_TEXT[best] ?? '25';
  }
  if (requested > 0) return String(requested);
  if (source.frameRate === null || source.frameRateText === null) return '25';
  return source.frameRate > 60 ? '60' : source.frameRateText;
}

/**
 * Video filter graph: optional alpha flattening onto white (for codecs without alpha), even
 * dimensions (required by 4:2:0 chroma), optional downscale (never upscale) and frame rate.
 */
export function videoFilters(
  resolution: number,
  rate: string | null,
  flatten: boolean,
  pixelFormat: string,
): string {
  const scale =
    resolution > 0
      ? `scale=-2:'min(${resolution},trunc(ih/2)*2)'`
      : `scale='trunc(iw/2)*2':'trunc(ih/2)*2'`;
  const chain = [scale, ...(rate ? [`fps=${rate}`] : []), `format=${pixelFormat}`].join(',');
  if (!flatten) return chain;
  return (
    '[0:v]format=rgba,split[bg0][fg];' +
    '[bg0]drawbox=x=0:y=0:w=iw:h=ih:c=white@1:replace=1:t=fill[bg];' +
    `[bg][fg]overlay=format=auto,${chain}[v]`
  );
}

interface VideoJob {
  input: EngineFile;
  to: string;
  out: string;
  quality: Quality;
  codec?: string;
  resolution: number;
  fps: number;
  removeAudio: boolean;
  audioBitrate: number;
  keepMetadata: boolean;
}

async function convertVideo(job: VideoJob, ctx: EngineContext): Promise<void> {
  const target = VIDEO[job.to];
  if (!target)
    throw new VanillateError('conversion-unsupported', { detail: `ffmpeg video ${job.to}` });
  const info = await probeMedia(job.input, ctx);
  const video = videoStream(info);
  const audio = job.removeAudio ? undefined : audioStream(info);
  if (!video && !audio) throw new VanillateError('input-corrupt', { detail: 'no usable streams' });
  const codec: VideoCodec =
    target.codecs.find((c) => c === job.codec) ?? (target.codecs[0] as VideoCodec);
  const available = await encoders(ctx);
  ctx.progress(0.05);

  const args = ['-y', ...inputArgs(job.input, ctx)];
  if (video) {
    const animated = job.input.format === 'gif' || job.input.format === 'apng';
    // VP9 keeps transparency (yuva420p); other codecs get it flattened onto white.
    const keepAlpha = animated && codec === 'vp9';
    const rate = cfrRate(codec, job.fps, video);
    const pixelFormat = keepAlpha ? 'yuva420p' : 'yuv420p';
    if (animated && !keepAlpha) {
      args.push('-filter_complex', videoFilters(job.resolution, rate, true, pixelFormat));
      args.push('-map', '[v]');
    } else {
      args.push('-map', `0:${video.index}`);
      args.push('-vf', videoFilters(job.resolution, rate, false, pixelFormat));
    }
    // Animations have irregular frame timing; keep it instead of duplicating frames.
    if (animated && !rate) args.push('-fps_mode', 'vfr');
    args.push(...videoCodecArgs(codec, job.quality, available));
    if (codec === 'h265' && (job.to === 'mp4' || job.to === 'mov')) args.push('-tag:v', 'hvc1');
  } else {
    args.push('-vn');
  }
  if (audio) {
    args.push('-map', `0:${audio.index}`, ...audioCodecArgs(target.audio(codec), job.audioBitrate));
  } else {
    args.push('-an');
  }
  args.push(
    '-sn',
    '-dn',
    ...(job.keepMetadata ? metadataArgs(job.input, info) : ['-map_metadata', '-1']),
    ...(target.extra?.(codec) ?? []),
    ...outputCaps(ctx),
    '-f',
    target.muxer,
    `file:${job.out}`,
  );
  const outTime = await ffmpeg(ctx, args, { duration: info.duration, range: [0.05, 1] });
  checkTruncation(info, outTime, ctx);
}

// ------------------------------------------------------------------ gif

async function videoToGif(
  input: EngineFile,
  options: Record<string, unknown>,
  out: string,
  ctx: EngineContext,
): Promise<void> {
  const info = await probeMedia(input, ctx);
  if (!videoStream(info)) throw new VanillateError('input-corrupt', { detail: 'no video stream' });
  const fps = num(options.fps, 10);
  const width = num(options.width, 480);
  const base = `fps=${fps},scale='min(${width},iw)':-2:flags=lanczos`;
  const palette = join(ctx.workDir, 'tmp', 'palette.png');
  // Two passes keep memory bounded: the palette pass streams, then frames are mapped.
  await ffmpeg(
    ctx,
    [
      '-y',
      ...inputArgs(input, ctx),
      '-map',
      '0:v:0',
      '-vf',
      `${base},palettegen=stats_mode=diff`,
      ...outputCaps(ctx),
      '-update',
      '1',
      '-frames:v',
      '1',
      '-f',
      'image2',
      `file:${palette}`,
    ],
    { duration: info.duration, range: [0.05, 0.4] },
  );
  const outTime = await ffmpeg(
    ctx,
    [
      '-y',
      ...inputArgs(input, ctx),
      '-f',
      'png_pipe',
      '-i',
      `file:${palette}`,
      '-filter_complex',
      `[0:v:0]${base}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[v]`,
      '-map',
      '[v]',
      '-an',
      '-loop',
      options.loop === false ? '-1' : '0',
      ...outputCaps(ctx),
      '-f',
      'gif',
      `file:${out}`,
    ],
    { duration: info.duration, range: [0.4, 1] },
  );
  checkTruncation(info, outTime, ctx);
}

// ------------------------------------------------------------------ subtitles

const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'webvtt',
  'mov_text',
  'text',
  'microdvd',
  'subviewer',
]);

const SUBTITLE_TARGETS: Record<string, { codec: string; muxer: string }> = {
  srt: { codec: 'srt', muxer: 'srt' },
  vtt: { codec: 'webvtt', muxer: 'webvtt' },
  ass: { codec: 'ass', muxer: 'ass' },
};

async function extractSubtitles(
  input: EngineFile,
  to: string,
  out: string,
  ctx: EngineContext,
): Promise<void> {
  const target = SUBTITLE_TARGETS[to];
  if (!target) throw new VanillateError('conversion-unsupported', { detail: `subtitles ${to}` });
  const info = await probeMedia(input, ctx);
  const track = info.streams.find(
    (s) => s.type === 'subtitle' && TEXT_SUBTITLE_CODECS.has(s.codec),
  );
  if (!track) throw new VanillateError('no-subtitle-track');
  await ffmpeg(
    ctx,
    [
      '-y',
      ...inputArgs(input, ctx),
      '-map',
      `0:${track.index}`,
      '-c:s',
      target.codec,
      '-map_metadata',
      '-1',
      '-f',
      target.muxer,
      `file:${out}`,
    ],
    { duration: info.duration, range: [0.05, 1] },
  );
}

// ------------------------------------------------------------------ engine

const AUDIO_TARGETS = new Set(Object.keys(AUDIO));
const VIDEO_TARGETS = new Set(Object.keys(VIDEO));

function quality(value: unknown, fallback: Quality): Quality {
  return value === 'high' || value === 'balanced' || value === 'small' ? value : fallback;
}

async function probe(runner: ProcessRunner): Promise<EngineProbe> {
  try {
    const result = await runner.run('ffmpeg', ['-hide_banner', '-version'], {
      cwd: '/',
      timeoutMs: 10_000,
      writable: [],
    });
    const probeResult = await runner.run('ffprobe', ['-hide_banner', '-version'], {
      cwd: '/',
      timeoutMs: 10_000,
      writable: [],
    });
    if (result.exitCode === 0 && probeResult.exitCode === 0) {
      return { available: true, version: firstLine(result.stdout), binary: 'ffmpeg' };
    }
  } catch {
    // not installed
  }
  return { available: false, version: null, binary: null };
}

async function run(request: EngineRequest, ctx: EngineContext): Promise<EngineOutput[]> {
  const input = onlyInput(request);
  const options = request.options as Record<string, unknown>;
  if (request.kind === 'operation') {
    if (request.operation !== 'compress-video') {
      throw new VanillateError('conversion-unsupported', { detail: `ffmpeg ${request.operation}` });
    }
    const out = join(request.outDir, 'output.mp4');
    await convertVideo(
      {
        input,
        to: 'mp4',
        out,
        quality: quality(options.videoQuality, 'small'),
        codec: 'h264',
        resolution: num(options.resolution, 0),
        fps: 0,
        removeAudio: options.removeAudio === true,
        audioBitrate: 128,
        keepMetadata: true,
      },
      ctx,
    );
    return [{ path: out, format: 'mp4' }];
  }

  const { to } = request;
  const out = join(request.outDir, `output.${extensionOf(ctx, to)}`);
  if (to in SUBTITLE_TARGETS) {
    await extractSubtitles(input, to, out, ctx);
  } else if (to === 'gif') {
    await videoToGif(input, options, out, ctx);
  } else if (AUDIO_TARGETS.has(to)) {
    await convertAudio(input, to, options, out, ctx);
  } else if (VIDEO_TARGETS.has(to)) {
    await convertVideo(
      {
        input,
        to,
        out,
        quality: quality(options.videoQuality, 'balanced'),
        codec: str(options.videoCodec, ''),
        resolution: num(options.resolution, 0),
        fps: num(options.fps, 0),
        removeAudio: options.removeAudio === true,
        audioBitrate: num(options.audioBitrate, 192),
        keepMetadata: true,
      },
      ctx,
    );
  } else {
    throw new VanillateError('conversion-unsupported', { detail: `ffmpeg cannot write ${to}` });
  }
  return [{ path: out, format: to }];
}

export const ffmpegEngine: ServerEngine = { id: 'ffmpeg', probe, run };
