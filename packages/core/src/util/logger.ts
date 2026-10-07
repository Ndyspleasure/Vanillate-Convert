/**
 * Structured logger (JSON lines). Isomorphic; the sink defaults to the console.
 *
 * Privacy: never log file contents, full file names or tokens. Keys that look sensitive are
 * redacted automatically and signed URLs have their query strings removed.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY =
  /(token|secret|password|passwd|authorization|cookie|signature|credential|apikey|api_key|private)/i;
const SIGNED_URL = /([?&])(x-amz-[^&=]*|sig|signature|token|expires)=[^&\s"]*/gi;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string')
    return value.length > 2000
      ? `${value.slice(0, 2000)}…`
      : value.replace(SIGNED_URL, '$1$2=[redacted]');
  if (value instanceof Error)
    return { name: value.name, message: redact(value.message, depth + 1) };
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

export interface LoggerOptions {
  level?: LogLevel;
  fields?: LogFields;
  sink?: (line: string, level: LogLevel) => void;
}

const consoleSink = (line: string, level: LogLevel): void => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  // eslint-disable-next-line no-console -- the logger is the one place allowed to write logs
  else console.log(line);
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const min = LEVELS[options.level ?? 'info'];
  const base = options.fields ?? {};
  const sink = options.sink ?? consoleSink;
  const write = (level: LogLevel, event: string, fields?: LogFields): void => {
    if (LEVELS[level] < min) return;
    const record = redact({ t: new Date().toISOString(), level, event, ...base, ...fields });
    sink(JSON.stringify(record), level);
  };
  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    child: (fields) => createLogger({ ...options, fields: { ...base, ...fields } }),
  };
}
