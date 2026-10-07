/**
 * Enumerations shared by the catalog schema (validation) and runtime code (compiler, UI,
 * workers). Kept free of dependencies so that browser bundles can import them cheaply.
 */

export const LOCALES = ['id', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'id';

export const CATEGORY_IDS = [
  'image',
  'pdf',
  'document',
  'spreadsheet',
  'presentation',
  'audio',
  'video',
  'archive',
  'data',
  'developer',
  'ebook',
  'subtitle',
  'font',
  'vector',
  '3d',
  'cad',
  'scientific',
  'web',
  'metadata',
  'specialized',
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

/** Ordered from best to worst. The order is significant (see `worstStatus`). */
export const STATUSES = [
  'stable',
  'supported',
  'limited',
  'experimental',
  'deprecated',
  'unsupported',
] as const;
export type Status = (typeof STATUSES)[number];

/** Statuses that may be offered to users as a normal choice. */
export const OFFERED_STATUSES: readonly Status[] = [
  'stable',
  'supported',
  'limited',
  'experimental',
  'deprecated',
];

/** Statuses that may be indexed by search engines (experimental/deprecated are not). */
export const INDEXABLE_STATUSES: readonly Status[] = ['stable', 'supported', 'limited'];

export const ENGINE_STATUSES = [
  'available',
  'unavailable',
  'degraded',
  'disabled',
  'experimental',
  'deprecated',
] as const;
export type EngineStatus = (typeof ENGINE_STATUSES)[number];

/** The best route status an engine in the given state can provide. */
export const ENGINE_STATUS_CAP: Record<EngineStatus, Status> = {
  available: 'stable',
  degraded: 'limited',
  experimental: 'experimental',
  deprecated: 'deprecated',
  unavailable: 'unsupported',
  disabled: 'unsupported',
};

export const PROCESSING_MODES = ['browser', 'server'] as const;
export type ProcessingMode = (typeof PROCESSING_MODES)[number];

export const TRAITS = [
  // pictures
  'raster',
  'vector',
  'lossy',
  'lossless',
  'alpha',
  'animation',
  'multipage',
  'palette',
  'hdr',
  'raw',
  'layered',
  // text & documents
  'text',
  'binary',
  'structured',
  'tabular',
  'richtext',
  'layout',
  'markup',
  'macro',
  // media
  'audio',
  'video',
  'container',
  'styled',
  'timed',
  // files
  'archive',
  'compressed',
  'diskimage',
  // specialized
  'font',
  'model3d',
  'cad',
  'scientific',
  // policy
  'proprietary',
  'legacy',
  'sensitive',
] as const;
export type Trait = (typeof TRAITS)[number];

export const METADATA_POLICIES = ['preserve', 'strip', 'transform', 'unsupported'] as const;
export type MetadataPolicy = (typeof METADATA_POLICIES)[number];

export const CARDINALITIES = ['1:1', '1:n', 'n:1', 'n:n'] as const;
export type Cardinality = (typeof CARDINALITIES)[number];

export const BATCH_MODES = [
  'per-file',
  'multi-file',
  'order-sensitive',
  'structure-sensitive',
] as const;
export type BatchMode = (typeof BATCH_MODES)[number];

export const WORKER_POOLS = [
  'image',
  'media',
  'document',
  'archive',
  'data',
  'specialized',
] as const;
export type WorkerPool = (typeof WORKER_POOLS)[number];

export const OPTION_TYPES = ['integer', 'number', 'boolean', 'enum', 'color', 'text'] as const;
export type OptionType = (typeof OPTION_TYPES)[number];

export const LIMITATION_SEVERITIES = ['info', 'warning'] as const;
export type LimitationSeverity = (typeof LIMITATION_SEVERITIES)[number];

export const TOOL_KINDS = [
  'compress',
  'transform',
  'extract',
  'combine',
  'split',
  'inspect',
  'encode',
  'format',
] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

/** Returns the worse of two statuses. */
export function worstStatus(a: Status, b: Status): Status {
  return STATUSES.indexOf(a) >= STATUSES.indexOf(b) ? a : b;
}

/** Returns the better of two statuses. */
export function bestStatus(a: Status, b: Status): Status {
  return STATUSES.indexOf(a) <= STATUSES.indexOf(b) ? a : b;
}

export function isOffered(status: Status): boolean {
  return OFFERED_STATUSES.includes(status);
}

export function isIndexable(status: Status): boolean {
  return INDEXABLE_STATUSES.includes(status);
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
