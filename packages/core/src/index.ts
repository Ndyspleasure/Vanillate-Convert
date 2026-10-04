/**
 * @vanillate/core — isomorphic domain core.
 *
 * Safe to import from browsers, serverless functions and workers. Zod-based catalog validation
 * is available separately from `@vanillate/core/validate`.
 */
export * from './catalog/constants.ts';
export type * from './catalog/schema.ts';
export * from './registry/types.ts';
export { Registry, normalizeToken } from './registry/registry.ts';
export { compileRegistry, CatalogCompileError, CATALOG_DEFAULTS } from './registry/compile.ts';
export { deriveLimitations, deriveQuality, DERIVED_LIMITATION_IDS } from './registry/quality.ts';
export { catalog, getRegistry } from './registry/default.ts';
