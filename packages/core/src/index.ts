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
export * from './detection/detect.ts';
export {
  decodeText,
  looksLikeText,
  stripBom,
  detectBom,
  type DecodedText,
  type TextEncodingName,
} from './detection/text.ts';
export { listZip, isZip, type ZipListing } from './detection/zip.ts';
export * from './errors/codes.ts';
export * from './options/validate.ts';
export * from './routing/slugs.ts';
export * from './routing/select.ts';
export * from './jobs/model.ts';
export * from './search/search.ts';
export * from './util/bytes.ts';
export * from './util/ids.ts';
export * from './util/filename.ts';
export * from './util/logger.ts';
