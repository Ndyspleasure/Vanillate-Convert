/**
 * Browser data engine: parse the input into the neutral value model, then serialize it to
 * the target format. Also implements the JSON/XML formatter and minifier tools.
 */
import { VanillateError } from '@vanillate/core';

import type {
  BrowserEngine,
  BrowserInputFile,
  BrowserOutputFile,
  BrowserTask,
  TaskContext,
} from '../types.ts';
import { corrupt, lineColumn, makeOutput, onlyInput, readText, textOutput } from '../util.ts';
import {
  delimiterFor,
  readDelimited,
  readIni,
  readJson,
  readNdjson,
  readToml,
  readXml,
  readYaml,
  writeDelimited,
  writeHtmlTable,
  writeIni,
  writeJson,
  writeMarkdownTable,
  writeNdjson,
  writeSql,
  writeToml,
  writeXml,
  writeYaml,
  type JsonIndent,
  type SqlDialect,
} from './codecs.ts';
import { CsvError } from './csv.ts';
import type { Value } from './model.ts';
import { formatXml, minifyXml, XmlSyntaxError } from './xml-format.ts';
import { writeXlsx } from './xlsx.ts';

/** Turns parser errors into `input-corrupt` with a line/column when available. */
function parseError(error: unknown, text: string): VanillateError {
  if (error instanceof XmlSyntaxError || error instanceof CsvError) {
    const fields: Record<string, string> = { line: String(error.line) };
    if (error instanceof XmlSyntaxError) fields.column = String(error.column);
    return corrupt(error, fields);
  }
  const message = error instanceof Error ? error.message : '';
  const position = /position (\d+)/.exec(message);
  if (position?.[1]) {
    const { line, column } = lineColumn(text, Number(position[1]));
    return corrupt(error, { line: String(line), column: String(column) });
  }
  const yamlPos = (error as { linePos?: [{ line: number; col: number }] }).linePos?.[0];
  if (yamlPos) return corrupt(error, { line: String(yamlPos.line), column: String(yamlPos.col) });
  const tomlPos = error as { line?: number; column?: number };
  if (typeof tomlPos.line === 'number') {
    return corrupt(error, { line: String(tomlPos.line), column: String(tomlPos.column ?? 1) });
  }
  return corrupt(error);
}

export function readValue(format: string, text: string, options: Record<string, unknown>): Value {
  try {
    switch (format) {
      case 'json':
        return readJson(text);
      case 'yaml':
        return readYaml(text);
      case 'toml':
        return readToml(text);
      case 'xml':
        return readXml(text);
      case 'ndjson':
      case 'jsonl':
        return readNdjson(text);
      case 'ini':
        return readIni(text);
      case 'csv':
        return readDelimited(
          text,
          options.csvInputDelimiter ?? 'auto',
          options.csvHeader !== false,
          false,
        );
      case 'tsv':
        return readDelimited(text, '\t', options.csvHeader !== false, true);
      default:
        throw new VanillateError('conversion-unsupported', {
          detail: `browser-data cannot read ${format}`,
        });
    }
  } catch (error) {
    if (error instanceof VanillateError) throw error;
    throw parseError(error, text);
  }
}

export function writeValue(
  format: string,
  value: Value,
  options: Record<string, unknown>,
  title: string,
): string | Uint8Array {
  const header = options.csvHeader !== false;
  switch (format) {
    case 'json':
      return writeJson(value, (options.jsonIndent as JsonIndent | undefined) ?? '2');
    case 'yaml':
      return writeYaml(value);
    case 'toml':
      return writeToml(value);
    case 'xml':
      return writeXml(
        value,
        typeof options.xmlRootName === 'string' ? options.xmlRootName : 'root',
      );
    case 'ndjson':
    case 'jsonl':
      return writeNdjson(value);
    case 'ini':
      return writeIni(value);
    case 'csv':
      return writeDelimited(value, delimiterFor(options.csvDelimiter, ','), header);
    case 'tsv':
      return writeDelimited(value, '\t', header);
    case 'sql':
      return writeSql(
        value,
        typeof options.sqlTable === 'string' ? options.sqlTable : 'data',
        (options.sqlDialect as SqlDialect | undefined) ?? 'standard',
      );
    case 'html':
      return writeHtmlTable(value, title);
    case 'md':
      return writeMarkdownTable(value);
    case 'xlsx':
      return writeXlsx(value, header);
    default:
      throw new VanillateError('conversion-unsupported', {
        detail: `browser-data cannot write ${format}`,
      });
  }
}

function convert(
  task: Extract<BrowserTask, { kind: 'conversion' }>,
  ctx: TaskContext,
): BrowserOutputFile[] {
  const input = onlyInput(task.inputs);
  const text = readText(input);
  ctx.progress(0.3);
  const value = readValue(task.from, text, task.options);
  ctx.progress(0.7);
  let written: string | Uint8Array;
  try {
    written = writeValue(task.to, value, task.options, input.name);
  } catch (error) {
    if (error instanceof VanillateError) throw error;
    // Serialization failures (e.g. too many rows for XLSX) are about the data, not a bug.
    throw corrupt(error);
  }
  return [
    typeof written === 'string'
      ? textOutput(ctx.registry, input, task.to, written)
      : makeOutput(ctx.registry, input, task.to, written),
  ];
}

function runTool(
  task: Extract<BrowserTask, { kind: 'tool' }>,
  ctx: TaskContext,
): BrowserOutputFile[] {
  const input: BrowserInputFile = onlyInput(task.inputs);
  const text = readText(input);
  let result: string;
  try {
    switch (task.operation) {
      case 'json-format':
        result = writeJson(
          readJson(text),
          (task.options.jsonIndent as JsonIndent | undefined) ?? '2',
        );
        break;
      case 'json-minify':
        result = writeJson(readJson(text), 'minify').trimEnd();
        break;
      case 'xml-format':
        result = formatXml(text);
        break;
      case 'xml-minify':
        result = minifyXml(text);
        break;
      default:
        throw new VanillateError('conversion-unsupported', {
          detail: `unknown data operation ${task.operation}`,
        });
    }
  } catch (error) {
    if (error instanceof VanillateError) throw error;
    throw parseError(error, text);
  }
  return [{ ...textOutput(ctx.registry, input, input.format, result), name: input.name }];
}

export const dataEngine: BrowserEngine = (task, ctx) =>
  Promise.resolve(task.kind === 'conversion' ? convert(task, ctx) : runTool(task, ctx));
