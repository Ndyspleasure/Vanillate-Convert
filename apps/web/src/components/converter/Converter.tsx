'use client';

/**
 * The converter widget: choose files → see the detected format → pick a target (or the page's
 * preset) → set options → convert in the browser or on the server → download.
 *
 * Everything it offers comes from the registry; where a conversion runs is decided by the
 * router (browser first when supported and within limits, otherwise server when available).
 */
import { zipSync } from 'fflate';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { BrowserOutputFile, BrowserTask, ImageSupport } from '@vanillate/browser-engines';
import {
  defaultOptionValues,
  errorMessage,
  formatBytes,
  selectRoute,
  toVanillateError,
  validateOptions,
  type CategoryId,
  type Conversion,
  type OptionValue,
  type OptionValues,
  type Route,
  type ToolRoute,
} from '@vanillate/core';

import { useI18n } from '@/i18n/client.tsx';
import { format } from '@/i18n/format.ts';

import { detectBrowserFile } from './detect.ts';
import { OptionsForm, type OptionState } from './OptionsForm.tsx';
import { clientRegistry } from './registry.ts';
import { runInBrowser } from './run-browser.ts';
import { runOnServer, type ServerTarget } from './run-server.ts';

export type ConverterPreset =
  | { kind: 'open' }
  | { kind: 'conversion'; from: string; to: string }
  | { kind: 'tool'; toolId: string };

interface Entry {
  id: string;
  file: File;
  format: string | null;
  detecting: boolean;
}

interface Result {
  key: string;
  name: string;
  size: number;
  href: string;
  /** Present for browser results (used for "download all"). */
  bytes?: Uint8Array;
  expiresAt?: string;
}

interface Progress {
  label: string;
  fraction: number | null;
}

/** Formats every browser can decode/encode, assumed until the feature probe finishes. */
const BASELINE: ImageSupport = {
  decode: ['jpg', 'png', 'gif', 'bmp', 'ico', 'svg'],
  encode: ['png', 'jpg', 'bmp', 'ico', 'tiff', 'pdf'],
};

let nextId = 0;
const newEntryId = (): string => `f${(nextId += 1)}`;

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

export function Converter({
  preset,
  serverProcessing,
}: {
  preset: ConverterPreset;
  serverProcessing: boolean;
}) {
  const { locale, t } = useI18n();
  const c = t.converter;
  const registry = useMemo(() => clientRegistry(serverProcessing), [serverProcessing]);
  const tool = preset.kind === 'tool' ? registry.tool(preset.toolId) : undefined;

  const [entries, setEntries] = useState<Entry[]>([]);
  /** The target picked in the "Convert to" list (pages without a preset target). */
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);
  /** Option values the user changed, by option id; everything else uses the route's defaults. */
  const [edited, setEdited] = useState<OptionState>({});
  /** Option errors from the last attempt, for the route they were checked against. */
  const [optionErrors, setOptionErrors] = useState<{
    routeId: string;
    errors: Record<string, string>;
  } | null>(null);
  const [phase, setPhase] = useState<'select' | 'running' | 'done'>('select');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [imageSupport, setImageSupport] = useState<ImageSupport>(BASELINE);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    let alive = true;
    void import('@vanillate/browser-engines')
      .then((engines) => engines.detectImageSupport())
      .then((support) => {
        if (alive) setImageSupport(support);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      abortRef.current?.abort();
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  // ------------------------------------------------------------------ derived state
  // Computed on each render: registry lookups are cheap and nothing here feeds an effect.

  const formats = entries.map((e) => e.format);
  const detecting = entries.some((e) => e.detecting);
  const label = (id: string | null): string =>
    id ? (registry.format(id)?.label ?? id) : c.unknown;

  /** The common input format, when every file has the same detected format. */
  const source =
    entries.length > 0 && !detecting && formats.every((f) => f !== null && f === formats[0])
      ? (formats[0] ?? null)
      : null;

  let targets: readonly Conversion[] = [];
  if (preset.kind === 'conversion' && source) {
    const preferred = registry.conversion(source, preset.to);
    targets = preferred?.offered ? [preferred] : [];
  } else if (preset.kind === 'open' && source) {
    targets = registry.conversionsFrom(source);
  }

  /** The page's target, else the user's choice while it applies to these files, else the first. */
  const target =
    preset.kind === 'conversion'
      ? preset.to
      : preset.kind === 'open'
        ? targets.some((conversion) => conversion.to === chosenTarget)
          ? chosenTarget
          : (targets[0]?.to ?? null)
        : null;

  const conversion =
    preset.kind !== 'tool' && source && target ? registry.conversion(source, target) : undefined;

  let routes: readonly (Route | ToolRoute)[] = [];
  if (preset.kind === 'tool') {
    if (tool && entries.length > 0 && !detecting)
      routes = registry.toolRoutesFor(tool, formats).filter((r) => r.offered);
  } else {
    routes = conversion?.routes.filter((r) => r.offered) ?? [];
  }

  const category: CategoryId | null =
    preset.kind === 'tool'
      ? (tool?.category ?? null)
      : source
        ? registry.requireFormat(source).category
        : null;

  const browserSupports = (candidate: Route | ToolRoute): boolean => {
    if (candidate.mode !== 'browser') return true;
    const engine = 'engines' in candidate ? candidate.engines[0] : candidate.engine;
    if (engine === 'browser-archive') return typeof DecompressionStream !== 'undefined';
    if (engine !== 'browser-image') return true;
    if (!formats.every((f) => f !== null && imageSupport.decode.includes(f))) return false;
    const output =
      'to' in candidate ? candidate.to : tool?.output === 'same' ? formats[0] : tool?.output;
    return typeof output === 'string' && imageSupport.encode.includes(output);
  };

  const selection =
    routes.length > 0 && category
      ? selectRoute(
          routes,
          category,
          entries.map((e) => ({ size: e.file.size })),
          { serverAvailable: serverProcessing, browserSupports },
          registry,
        )
      : null;

  const route = selection?.ok ? selection.route : null;
  const combine =
    route === null
      ? false
      : 'cardinality' in route
        ? route.cardinality === 'n:1'
        : tool?.cardinality === 'n:1';

  // Defaults of the current route, with the user's changes to options that still exist.
  const values: OptionState = {};
  if (route) {
    Object.assign(values, defaultOptionValues(route.options));
    for (const def of route.options)
      if (Object.hasOwn(edited, def.id)) values[def.id] = edited[def.id];
  }
  const fieldErrors = route && optionErrors?.routeId === route.id ? optionErrors.errors : {};

  // ------------------------------------------------------------------ problems with the files

  const problems: string[] = [];
  for (const entry of entries) {
    if (entry.detecting) continue;
    if (preset.kind === 'tool') {
      const accepted =
        tool?.inputs.includes('*') ||
        (entry.format !== null && tool?.inputs.includes(entry.format));
      if (!accepted) problems.push(format(c.notAccepted, { name: entry.file.name }));
    } else if (entry.format === null) {
      problems.push(`${entry.file.name}: ${c.unknown}`);
    } else if (
      preset.kind === 'conversion' &&
      !registry.conversion(entry.format, preset.to)?.offered
    ) {
      problems.push(
        format(c.mismatch, { detected: label(entry.format), expected: label(preset.from) }),
      );
    }
  }
  if (
    preset.kind !== 'tool' &&
    problems.length === 0 &&
    entries.length > 1 &&
    !detecting &&
    !source
  ) {
    problems.push(c.mixedFormats);
  }

  // ------------------------------------------------------------------ actions

  const resetResults = (): void => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];
    setResults([]);
  };

  const addFiles = (files: readonly File[]): void => {
    if (files.length === 0 || phase === 'running') return;
    resetResults();
    setError(null);
    setPhase('select');
    const added = files.map((file) => ({ id: newEntryId(), file, format: null, detecting: true }));
    setEntries((current) => [...current, ...added]);
    for (const entry of added) {
      void detectBrowserFile(entry.file, registry)
        .then((detection) => detection.format)
        .catch(() => null)
        .then((detected) => {
          setEntries((current) =>
            current.map((e) =>
              e.id === entry.id ? { ...e, format: detected, detecting: false } : e,
            ),
          );
        });
    }
  };

  const usePastedText = (): void => {
    if (pasted.trim() === '' || !tool) return;
    const firstFormat = tool.inputs.find((id) => id !== '*');
    const ext = firstFormat ? (registry.format(firstFormat)?.extensions[0] ?? 'txt') : 'txt';
    addFiles([new File([pasted], `text.${ext}`, { type: 'text/plain' })]);
    setPasting(false);
    setPasted('');
  };

  const removeEntry = (id: string): void => {
    setEntries((current) => current.filter((e) => e.id !== id));
    resetResults();
    setPhase('select');
  };

  const clearAll = (): void => {
    setEntries([]);
    resetResults();
    setError(null);
    setPhase('select');
  };

  const optionErrorText = (code: string, id: string): string => {
    const def = route?.options.find((o) => o.id === id);
    const templates = c.optionErrors as Record<string, string>;
    return format(templates[code] ?? templates.type ?? '', {
      min: def?.min ?? '',
      max: def?.max ?? '',
    });
  };

  const start = async (): Promise<void> => {
    if (!route) return;
    const validation = validateOptions(route.options, values);
    if (!validation.ok) {
      setOptionErrors({
        routeId: route.id,
        errors: Object.fromEntries(
          validation.errors.map((e) => [e.id, optionErrorText(e.code, e.id)]),
        ),
      });
      return;
    }
    setOptionErrors(null);
    const controller = new AbortController();
    abortRef.current = controller;
    resetResults();
    setError(null);
    setPhase('running');
    setProgress({ label: c.preparing, fraction: null });
    try {
      const produced =
        route.mode === 'browser'
          ? await runBrowserRoute(route, validation.values, controller.signal)
          : await runServerRoute(validation.values, controller.signal);
      setResults(produced);
      setPhase('done');
    } catch (failure) {
      setPhase('select');
      if (!isAbort(failure)) setError(errorMessage(toVanillateError(failure).code, locale));
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const runBrowserRoute = async (
    chosen: Route | ToolRoute,
    options: OptionValues,
    signal: AbortSignal,
  ): Promise<Result[]> => {
    const batches = combine ? [entries] : entries.map((e) => [e]);
    const outputs: BrowserOutputFile[] = [];
    for (const [index, batch] of batches.entries()) {
      const inputs = await Promise.all(
        batch.map(async (e) => ({
          name: e.file.name,
          format: e.format ?? 'bin',
          bytes: new Uint8Array(await e.file.arrayBuffer()),
        })),
      );
      const task: BrowserTask =
        'steps' in chosen
          ? {
              kind: 'conversion',
              routeId: chosen.id,
              engine: chosen.steps[0]?.engine ?? '',
              from: chosen.from,
              to: chosen.to,
              options,
              inputs,
            }
          : {
              kind: 'tool',
              routeId: chosen.id,
              engine: chosen.engine,
              toolId: chosen.toolId,
              operation: chosen.operation,
              options,
              inputs,
            };
      const produced = await runInBrowser(task, serverProcessing, signal, (fraction) =>
        setProgress({ label: c.converting, fraction: (index + fraction) / batches.length }),
      );
      outputs.push(...produced);
    }
    return outputs.map((output, index) => {
      const href = URL.createObjectURL(
        new Blob([output.bytes as BlobPart], { type: output.mimeType }),
      );
      urlsRef.current.push(href);
      return {
        key: `r${index}`,
        name: output.path ?? output.name,
        size: output.bytes.length,
        href,
        bytes: output.bytes,
      };
    });
  };

  const runServerRoute = async (options: OptionValues, signal: AbortSignal): Promise<Result[]> => {
    const serverTarget: ServerTarget =
      preset.kind === 'tool'
        ? { kind: 'tool', toolId: preset.toolId }
        : { kind: 'conversion', from: source ?? '', to: target ?? '' };
    const batches = combine ? [entries] : entries.map((e) => [e]);
    const results: Result[] = [];
    for (const [index, batch] of batches.entries()) {
      const outputs = await runOnServer({
        target: serverTarget,
        options,
        files: batch.map((e) => ({ file: e.file, format: e.format ?? 'bin' })),
        locale,
        signal,
        onProgress: ({ stage, fraction }) => {
          const overall = (index + fraction) / batches.length;
          const percent = Math.round(fraction * 100);
          const text =
            stage === 'uploading'
              ? format(c.uploading, { percent })
              : stage === 'processing'
                ? format(c.processing, { percent })
                : stage === 'queued'
                  ? c.queued
                  : c.finalizing;
          setProgress({ label: text, fraction: stage === 'queued' ? null : overall });
        },
      });
      results.push(
        ...outputs.map((o, i) => ({
          key: `s${index}-${i}`,
          name: o.name,
          size: o.size,
          href: o.url,
          expiresAt: o.expiresAt,
        })),
      );
    }
    return results;
  };

  const cancel = (): void => abortRef.current?.abort();

  const downloadAll = (): void => {
    const files: Record<string, Uint8Array> = {};
    for (const result of results) if (result.bytes) files[result.name] = result.bytes;
    const zip = zipSync(files, { level: 0 });
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'vanillate-convert.zip';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // ------------------------------------------------------------------ rendering

  const acceptIds =
    preset.kind === 'conversion'
      ? [preset.from]
      : preset.kind === 'tool'
        ? (tool?.inputs ?? [])
        : [];
  const acceptTokens = acceptIds.includes('*')
    ? []
    : acceptIds.flatMap((id) => {
        const f = registry.format(id);
        return f ? [...f.extensions.map((ext) => `.${ext}`), ...f.mimeTypes] : [];
      });
  const accept = acceptTokens.length > 0 ? acceptTokens.join(',') : undefined;

  const acceptsText = preset.kind === 'tool' && tool?.acceptsText === true;
  const running = phase === 'running';
  const blocked = selection && !selection.ok ? errorMessage(selection.code, locale) : null;
  const canStart =
    route !== null && problems.length === 0 && !detecting && entries.length > 0 && !running;
  const status = route?.status;
  const limitationIds =
    preset.kind === 'tool' ? (tool?.limitations ?? []) : (conversion?.limitations ?? []);
  const retentionMinutes = Math.round(registry.retention.outputSeconds / 60);
  // Errors are announced by their role="alert" notice, not repeated here.
  const liveMessage = running ? (progress?.label ?? '') : phase === 'done' ? c.done : '';

  return (
    <section
      className="converter"
      aria-label={preset.kind === 'tool' ? (tool?.name[locale] ?? c.start) : c.start}
    >
      {phase !== 'done' && (
        <div
          className={`dropzone${dragging ? ' dropzone--active' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles([...event.dataTransfer.files]);
          }}
        >
          <p className="dropzone__title">{c.dropTitle}</p>
          <p className="muted">{c.dropHint}</p>
          <div className="dropzone__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => inputRef.current?.click()}
              disabled={running}
            >
              {c.choose}
            </button>
            {acceptsText && (
              <button
                type="button"
                className="button"
                onClick={() => setPasting((v) => !v)}
                aria-expanded={pasting}
                disabled={running}
              >
                {c.pasteInstead}
              </button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept={accept}
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
          {pasting && (
            <div className="field" style={{ marginTop: '1rem', textAlign: 'left' }}>
              <label htmlFor="pasted-text">{c.pasteLabel}</label>
              <textarea
                id="pasted-text"
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                spellCheck={false}
              />
              <div>
                <button
                  type="button"
                  className="button"
                  onClick={usePastedText}
                  disabled={pasted.trim() === ''}
                >
                  {c.usePasted}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {entries.length > 0 && phase !== 'done' && (
        <>
          <h3 className="visually-hidden">{c.fileList}</h3>
          <ul className="file-list">
            {entries.map((entry) => (
              <li key={entry.id} className="file-row">
                <span className="file-row__name">{entry.file.name}</span>
                <span className="file-row__meta">
                  {formatBytes(entry.file.size, locale)} ·{' '}
                  {entry.detecting
                    ? c.detecting
                    : format(c.detected, { format: label(entry.format) })}
                </span>
                <button
                  type="button"
                  className="button button--small"
                  onClick={() => removeEntry(entry.id)}
                  disabled={running}
                  aria-label={format(c.remove, { name: entry.file.name })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {problems.map((problem) => (
        <p key={problem} className="notice notice--warning" role="alert">
          {problem}
        </p>
      ))}

      {phase !== 'done' && entries.length > 0 && problems.length === 0 && !detecting && (
        <>
          {preset.kind === 'open' && (
            <div className="converter__controls">
              <div className="field">
                <label htmlFor="target-format">{c.convertTo}</label>
                {targets.length > 0 ? (
                  <select
                    id="target-format"
                    value={target ?? ''}
                    onChange={(event) => setChosenTarget(event.target.value)}
                    disabled={running}
                  >
                    {targets.map((conv) => (
                      <option key={conv.to} value={conv.to}>
                        {label(conv.to)} — {registry.format(conv.to)?.name[locale]}
                        {conv.status === 'experimental' ? ` (${t.status.experimental})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="muted">{c.noTargets}</p>
                )}
              </div>
            </div>
          )}

          {status === 'experimental' && (
            <p className="notice notice--experimental">{c.experimental}</p>
          )}
          {status === 'limited' && <p className="notice notice--limited">{c.limited}</p>}
          {status === 'deprecated' && <p className="notice notice--deprecated">{c.deprecated}</p>}

          {route && (
            <>
              <OptionsForm
                options={route.options}
                values={values}
                errors={fieldErrors}
                onChange={(id: string, value: OptionValue | undefined) =>
                  setEdited((v) => ({ ...v, [id]: value }))
                }
              />
              {limitationIds.length > 0 && (
                <details>
                  <summary>{c.limitations}</summary>
                  <ul className="limitations">
                    {limitationIds.map((id) => {
                      const limitation = registry.limitation(id);
                      return limitation ? (
                        <li key={id} className={`severity-${limitation.severity}`}>
                          {limitation.text[locale]}
                        </li>
                      ) : null;
                    })}
                  </ul>
                </details>
              )}
            </>
          )}

          {blocked && !route && <p className="notice notice--warning">{blocked}</p>}

          <div className="converter__controls">
            {running ? (
              <button type="button" className="button" onClick={cancel}>
                {c.cancel}
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary"
                onClick={() => void start()}
                disabled={!canStart}
              >
                {preset.kind === 'tool' ? c.startTool : c.start}
              </button>
            )}
            {!running && (
              <button type="button" className="button button--link" onClick={clearAll}>
                {c.clear}
              </button>
            )}
          </div>
          {route && (
            <p className="mode-note">
              {route.mode === 'browser'
                ? c.modeBrowser
                : format(c.modeServer, { minutes: retentionMinutes })}
            </p>
          )}
        </>
      )}

      {running && progress && (
        <div className="progress">
          <p>{progress.label}</p>
          <div
            className="progress__bar"
            role="progressbar"
            aria-label={c.progressLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              progress.fraction === null ? undefined : Math.round(progress.fraction * 100)
            }
          >
            <div
              className="progress__fill"
              style={{ width: `${Math.round((progress.fraction ?? 0.05) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="notice notice--error" role="alert">
          <strong>{c.errorTitle}.</strong> {error}
        </div>
      )}

      {phase === 'done' && (
        <>
          <h3>{c.results}</h3>
          <ul className="results">
            {results.map((result) => (
              <li key={result.key} className="result-row">
                <span className="result-row__name">{result.name}</span>
                <span className="muted">{formatBytes(result.size, locale)}</span>
                <a
                  className="button button--primary button--small"
                  href={result.href}
                  download={basename(result.name)}
                >
                  {c.download}
                </a>
              </li>
            ))}
          </ul>
          <div className="converter__controls">
            {results.length > 1 && results.every((r) => r.bytes) && (
              <button type="button" className="button" onClick={downloadAll}>
                {c.downloadAll}
              </button>
            )}
            <button type="button" className="button" onClick={clearAll}>
              {c.again}
            </button>
          </div>
        </>
      )}

      <div className="visually-hidden" aria-live="polite">
        {liveMessage}
      </div>
    </section>
  );
}
