/**
 * The default registry compiled from `@vanillate/catalog`.
 *
 * The JSON is validated in CI (`pnpm catalog:check` and the catalog tests), so the cast below
 * is backed by a test rather than by runtime parsing, which keeps zod out of client bundles.
 */
import { rawCatalog } from '@vanillate/catalog';

import type { RawCatalog } from '../catalog/schema.ts';
import { compileRegistry } from './compile.ts';
import type { Registry } from './registry.ts';
import type { RegistryEnvironment } from './types.ts';

export const catalog = rawCatalog as unknown as RawCatalog;

const cache = new Map<string, Registry>();

/** Returns a memoized registry for the environment (compiled once per distinct environment). */
export function getRegistry(env: RegistryEnvironment = {}): Registry {
  const key = JSON.stringify({
    engineStatus: Object.entries(env.engineStatus ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    disabledModes: [...(env.disabledModes ?? [])].sort(),
  });
  let registry = cache.get(key);
  if (!registry) {
    registry = compileRegistry(catalog, env);
    cache.set(key, registry);
  }
  return registry;
}
