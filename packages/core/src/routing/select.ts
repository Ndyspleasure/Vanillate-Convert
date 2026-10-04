/**
 * Processing router: chooses where a conversion runs.
 *
 * Routes are tried in registry order (offered first, then priority; browser before server on
 * ties). A browser route is used when the browser supports it and the files fit the browser
 * limits; otherwise the next route — usually a server route — is used if server processing is
 * available. The reason is reported when nothing fits so the UI can explain it.
 */
import type { CategoryId, ProcessingMode } from '../catalog/constants.ts';
import type { ErrorCode } from '../errors/codes.ts';
import type { Registry } from '../registry/registry.ts';
import type { ModeLimits, Route, ToolRoute } from '../registry/types.ts';

export interface SelectableFile {
  size: number;
}

export interface RouteEnvironment {
  /** Whether server processing is configured and reachable. */
  serverAvailable: boolean;
  /** Runtime check for browser routes (feature detection, e.g. AVIF decoding). */
  browserSupports?: (route: Route | ToolRoute) => boolean;
  /** Force a mode (e.g. the user chose "process on server"). */
  preferMode?: ProcessingMode;
}

export type RouteSelection<R extends Route | ToolRoute> =
  { ok: true; route: R; mode: ProcessingMode; limits: ModeLimits } | { ok: false; code: ErrorCode };

export function checkFileLimits(
  files: readonly SelectableFile[],
  limits: ModeLimits,
): ErrorCode | null {
  if (files.length === 0) return 'bad-request';
  if (files.length > limits.maxFilesPerJob) return 'too-many-files';
  if (files.some((f) => f.size === 0)) return 'file-empty';
  if (files.some((f) => f.size > limits.maxInputBytes)) return 'file-too-large';
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > limits.maxTotalInputBytes) return 'total-too-large';
  return null;
}

/** Ranks failure reasons so the most helpful one is reported. */
const REASON_ORDER: readonly ErrorCode[] = [
  'file-empty',
  'too-many-files',
  'file-too-large',
  'total-too-large',
  'browser-unsupported',
  'server-processing-disabled',
  'conversion-unsupported',
];

export function selectRoute<R extends Route | ToolRoute>(
  routes: readonly R[],
  category: CategoryId,
  files: readonly SelectableFile[],
  env: RouteEnvironment,
  registry: Registry,
): RouteSelection<R> {
  const reasons: ErrorCode[] = [];
  const ordered = env.preferMode
    ? [...routes].sort(
        (a, b) => Number(b.mode === env.preferMode) - Number(a.mode === env.preferMode),
      )
    : routes;
  for (const route of ordered) {
    if (!route.offered) {
      reasons.push('conversion-unsupported');
      continue;
    }
    if (route.mode === 'browser' && env.browserSupports && !env.browserSupports(route)) {
      reasons.push('browser-unsupported');
      continue;
    }
    if (route.mode === 'server' && !env.serverAvailable) {
      reasons.push('server-processing-disabled');
      continue;
    }
    const limits = registry.limitsFor(route.mode, category);
    const violation = checkFileLimits(files, limits);
    if (violation) {
      reasons.push(violation);
      continue;
    }
    return { ok: true, route, mode: route.mode, limits };
  }
  const code = REASON_ORDER.find((reason) => reasons.includes(reason)) ?? 'conversion-unsupported';
  return { ok: false, code };
}
