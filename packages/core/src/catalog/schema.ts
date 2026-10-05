/**
 * Zod schemas for the raw catalog (the JSON files under `/catalog`).
 *
 * The catalog is the single source of truth for formats, engines, conversion rules,
 * options, limitations, limits and tools. These schemas are used by:
 *   - `validateCatalog()` (tests, CI and the `catalog:check` script),
 *   - `scripts/catalog-schema.ts` to emit JSON Schema files for editor validation.
 *
 * Runtime code paths (web app, worker) consume the catalog through `compileRegistry()`,
 * which does not depend on zod, so this module is never bundled into the browser.
 *
 * The schemas only *validate* authored data; they never transform it. Defaults for optional
 * fields are applied in one place: `registry/defaults.ts`.
 */
import { z } from 'zod';

import {
  CATEGORY_IDS,
  CARDINALITIES,
  BATCH_MODES,
  ENGINE_STATUSES,
  LIMITATION_SEVERITIES,
  METADATA_POLICIES,
  OPTION_TYPES,
  PROCESSING_MODES,
  STATUSES,
  TOOL_KINDS,
  TRAITS,
  WORKER_POOLS,
} from './constants.ts';

const id = z
  .string()
  .regex(/^[a-z0-9]+$/, 'ids must be lowercase alphanumeric (no separators)')
  .max(24);
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/, 'must be a lowercase slug')
  .max(64);
const extension = z
  .string()
  .regex(/^[a-z0-9]+(?:\.[a-z0-9]+)*$/, 'extensions are lowercase, without a leading dot')
  .max(16);
const mimeType = z
  .string()
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/, 'invalid MIME type');

export const localizedTextSchema = z.strictObject({
  en: z.string().min(1),
  id: z.string().min(1),
});

export const categoryIdSchema = z.enum(CATEGORY_IDS);
export const statusSchema = z.enum(STATUSES);
export const engineStatusSchema = z.enum(ENGINE_STATUSES);
export const processingModeSchema = z.enum(PROCESSING_MODES);
export const traitSchema = z.enum(TRAITS);
export const metadataPolicySchema = z.enum(METADATA_POLICIES);
export const cardinalitySchema = z.enum(CARDINALITIES);
export const batchModeSchema = z.enum(BATCH_MODES);
export const workerPoolSchema = z.enum(WORKER_POOLS);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categorySchema = z.strictObject({
  id: categoryIdSchema,
  name: localizedTextSchema,
  description: localizedTextSchema,
  /** Display order in navigation (ascending). */
  order: z.number().int().min(0),
  /** Material Symbols-like icon key used by the UI; purely presentational. */
  icon: z.string().min(1).max(32),
});

export const categoriesFileSchema = z.strictObject({
  $schema: z.string().optional(),
  categories: z.array(categorySchema).min(1),
});

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

const hexBytes = z
  .string()
  .regex(/^(?:[0-9A-F]{2})+$/, 'hex must be uppercase pairs without spaces');

/**
 * One condition of a file signature. A signature matches when every condition matches.
 * `offset` may be negative to address bytes relative to the end of the file.
 * `search` scans for the bytes anywhere in `[offset, offset + within)`.
 */
export const signatureConditionSchema = z
  .strictObject({
    offset: z.number().int().min(-65536).max(65536).optional(),
    hex: hexBytes.optional(),
    ascii: z.string().min(1).max(64).optional(),
    mask: hexBytes.optional(),
    within: z.number().int().min(1).max(65536).optional(),
  })
  .refine((c) => (c.hex === undefined) !== (c.ascii === undefined), {
    message: 'exactly one of `hex` or `ascii` is required',
  })
  .refine((c) => c.mask === undefined || (c.hex !== undefined && c.mask.length === c.hex.length), {
    message: '`mask` requires `hex` of the same length',
  })
  .refine((c) => c.mask === undefined || c.within === undefined, {
    message: '`mask` cannot be combined with `within`',
  });

export const signatureSchema = z.array(signatureConditionSchema).min(1).max(4);

/**
 * Content sniffers for formats that have no reliable magic bytes or that share a
 * container (ZIP, OLE2, Ogg, ISO-BMFF...). Implemented in `detection/`.
 */
export const sniffSchema = z.discriminatedUnion('type', [
  /** ZIP based: matched by an exact entry name or a name prefix, or by the `mimetype` entry. */
  z.strictObject({
    type: z.literal('zip'),
    entries: z.array(z.string().min(1)).optional(),
    entryPrefixes: z.array(z.string().min(1)).optional(),
    mimetype: z.string().optional(),
  }),
  /** OLE2 compound files: matched by a stream name stored in the directory. */
  z.strictObject({ type: z.literal('ole'), streams: z.array(z.string().min(1)).min(1) }),
  /** Text formats: matched by a regular expression over the decoded head of the file. */
  z.strictObject({
    type: z.literal('text'),
    pattern: z.string().min(1),
    flags: z
      .string()
      .regex(/^[imsu]*$/)
      .optional(),
  }),
  /** JSON documents (optionally requiring a top-level key). */
  z.strictObject({ type: z.literal('json'), requireKeys: z.array(z.string()).optional() }),
  /** Newline-delimited JSON. */
  z.strictObject({ type: z.literal('ndjson') }),
  /** XML documents with a given root element name (and optional namespace substring). */
  z.strictObject({
    type: z.literal('xml'),
    root: z.string().min(1).optional(),
    namespace: z.string().min(1).optional(),
  }),
  /** A TAR archive inside a compression stream (decompressed head is inspected when possible). */
  z.strictObject({ type: z.literal('tar-in'), compression: z.enum(['gzip']) }),
]);

export const formatSchema = z.strictObject({
  /** Canonical id. Lowercase alphanumeric only so that slugs like `jpg-to-png` are unambiguous. */
  id,
  /** Short label for UI chips and URLs ("JPG", "MP4"). */
  label: z.string().min(1).max(16),
  name: localizedTextSchema,
  description: localizedTextSchema,
  category: categoryIdSchema,
  /** Secondary categories the format is also listed under (e.g. SVG in image + vector). */
  alsoIn: z.array(categoryIdSchema).optional(),
  /** File extensions, primary first. */
  extensions: z.array(extension).min(1),
  /** MIME types, primary first. */
  mimeTypes: z.array(mimeType).min(1),
  /** Alternative names accepted in search and URLs (e.g. `jpeg` for `jpg`). */
  aliases: z.array(id).optional(),
  signatures: z.array(signatureSchema).optional(),
  sniff: sniffSchema.optional(),
  traits: z.array(traitSchema).optional(),
  /**
   * Editorial cap on support for this format. The effective status of a conversion is the
   * worst of: this status, the rule status and the engine status.
   */
  status: statusSchema.optional(),
  /** 0–100, used for ordering and popular lists. Not a quality signal. */
  popularity: z.number().int().min(0).max(100).optional(),
  /** Extra notes shown on the format page. */
  notes: localizedTextSchema.optional(),
});

export const formatsFileSchema = z.strictObject({
  $schema: z.string().optional(),
  formats: z.array(formatSchema).min(1),
});

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

export const engineSchema = z
  .strictObject({
    id: slug,
    name: z.string().min(1),
    mode: processingModeSchema,
    status: engineStatusSchema,
    description: z.string().min(1),
    homepage: z.url(),
    license: z.string().min(1),
    /** Licensing notes relevant to running or redistributing the engine. */
    licenseNotes: z.string().optional(),
    /** Server engines: executables probed by workers (first found wins). */
    binaries: z.array(z.string().regex(/^[a-zA-Z0-9._-]+$/)).optional(),
    /** Server engines: the worker pool that runs the engine. */
    pool: workerPoolSchema.optional(),
    capabilities: z.strictObject({
      read: z.array(id).min(1),
      write: z.array(id).min(1),
    }),
  })
  .refine((e) => e.mode === 'browser' || (e.binaries?.length ?? 0) > 0, {
    message: 'server engines must declare at least one binary',
  })
  .refine((e) => e.mode === 'browser' || e.pool !== undefined, {
    message: 'server engines must declare a worker pool',
  });

export const engineFileSchema = z.strictObject({
  $schema: z.string().optional(),
  engine: engineSchema,
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const optionValue = z.union([z.string(), z.number(), z.boolean()]);

export const optionChoiceSchema = z.strictObject({
  value: z.union([z.string(), z.number()]),
  label: localizedTextSchema,
});

export const optionSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
    type: z.enum(OPTION_TYPES),
    label: localizedTextSchema,
    help: localizedTextSchema.optional(),
    /** Advanced options are collapsed by default in the UI. */
    advanced: z.boolean().optional(),
    default: optionValue.optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    unit: z.string().max(8).optional(),
    choices: z.array(optionChoiceSchema).optional(),
    /** For `text` options: allowed pattern (anchored) and maximum length. */
    pattern: z.string().optional(),
    maxLength: z.number().int().positive().max(1000).optional(),
  })
  .refine((o) => o.type !== 'enum' || (o.choices?.length ?? 0) > 0, {
    message: 'enum options need choices',
  })
  .refine((o) => o.type !== 'text' || (o.pattern !== undefined && o.maxLength !== undefined), {
    message: 'text options need a pattern and maxLength',
  })
  .refine((o) => o.type !== 'integer' || (o.min !== undefined && o.max !== undefined), {
    message: 'integer options need min and max',
  })
  .refine((o) => o.type !== 'number' || (o.min !== undefined && o.max !== undefined), {
    message: 'number options need min and max',
  });

/** A rule/tool may reference an option by id or narrow it. */
export const optionRefSchema = z.union([
  z.string(),
  z.strictObject({
    id: z.string(),
    default: optionValue.optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    /** Restrict enum choices to this subset (values). */
    choices: z.array(z.union([z.string(), z.number()])).optional(),
  }),
]);

export const optionsFileSchema = z.strictObject({
  $schema: z.string().optional(),
  options: z.array(optionSchema).min(1),
});

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

export const limitationSchema = z.strictObject({
  id: slug,
  severity: z.enum(LIMITATION_SEVERITIES),
  text: localizedTextSchema,
});

export const limitationsFileSchema = z.strictObject({
  $schema: z.string().optional(),
  limitations: z.array(limitationSchema).min(1),
});

// ---------------------------------------------------------------------------
// Conversion rules
// ---------------------------------------------------------------------------

export const selectorSchema = z.strictObject({
  categories: z.array(categoryIdSchema).optional(),
  formats: z.array(id).optional(),
  traits: z.array(traitSchema).optional(),
  exclude: z.array(id).optional(),
});

const pairSelector = z.strictObject({
  from: z.union([id, z.array(id)]).optional(),
  to: z.union([id, z.array(id)]).optional(),
});

/**
 * Pair-specific adjustments. Overrides are applied in order; `limitations` and `addOptions`
 * accumulate, `options` replaces the option list, scalar fields replace earlier values.
 */
export const ruleOverrideSchema = pairSelector.extend({
  status: statusSchema.optional(),
  limitations: z.array(slug).optional(),
  cardinality: cardinalitySchema.optional(),
  options: z.array(optionRefSchema).optional(),
  addOptions: z.array(optionRefSchema).optional(),
  imperfect: z.boolean().optional(),
});

export const ruleSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  description: z.string().min(1),
  mode: processingModeSchema,
  /** Engines executed in order. Multi-step pipelines declare intermediate formats in `via`. */
  steps: z.array(slug).min(1).max(3),
  via: z.array(id).optional(),
  from: selectorSchema,
  to: selectorSchema,
  /** Allow `from === to` (re-encode). Off by default. */
  identity: z.boolean().optional(),
  status: statusSchema,
  /** Lower is preferred when several routes serve the same pair. */
  priority: z.number().int().min(0).max(1000),
  cardinality: cardinalitySchema.optional(),
  batch: batchModeSchema.optional(),
  options: z.array(optionRefSchema).optional(),
  metadata: metadataPolicySchema,
  limitations: z.array(slug).optional(),
  /** Marks conversions whose output is known to be imperfect (e.g. PDF → DOCX). */
  imperfect: z.boolean().optional(),
  /** Explicit pairs that must not be generated. */
  exclude: z.array(pairSelector).optional(),
  overrides: z.array(ruleOverrideSchema).optional(),
});

export const rulesFileSchema = z.strictObject({
  $schema: z.string().optional(),
  rules: z.array(ruleSchema).min(1),
});

// ---------------------------------------------------------------------------
// Tools (operations that are not plain A → B conversions)
// ---------------------------------------------------------------------------

export const toolRouteSchema = z.strictObject({
  engine: slug,
  mode: processingModeSchema,
  operation: z.string().regex(/^[a-z][a-z0-9-]*$/),
  status: statusSchema,
  priority: z.number().int().min(0).max(1000),
  options: z.array(optionRefSchema).optional(),
  /** Input formats this route handles (a subset of the tool's inputs); defaults to all. */
  inputs: z
    .array(z.union([id, z.literal('*')]))
    .min(1)
    .optional(),
});

export const toolSchema = z.strictObject({
  id: slug,
  name: localizedTextSchema,
  description: localizedTextSchema,
  category: categoryIdSchema,
  kind: z.enum(TOOL_KINDS),
  /** Accepted input formats. `*` accepts any file, including unknown formats. */
  inputs: z.array(z.union([id, z.literal('*')])).min(1),
  /** Whether the tool also accepts pasted text instead of a file. */
  acceptsText: z.boolean().optional(),
  /** `same` keeps the input format; otherwise the output format id. `detect` sniffs the result. */
  output: z.union([z.literal('same'), z.literal('detect'), id]),
  cardinality: cardinalitySchema,
  metadata: metadataPolicySchema,
  limitations: z.array(slug).optional(),
  routes: z.array(toolRouteSchema).min(1),
  popularity: z.number().int().min(0).max(100).optional(),
});

export const toolsFileSchema = z.strictObject({
  $schema: z.string().optional(),
  tools: z.array(toolSchema).min(1),
});

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const bytes = z
  .number()
  .int()
  .positive()
  .max(64 * 1024 ** 3);

export const modeLimitsSchema = z.strictObject({
  maxInputBytes: bytes,
  maxTotalInputBytes: bytes,
  maxOutputBytes: bytes,
  maxFilesPerJob: z.number().int().positive().max(1000),
  maxJobSeconds: z
    .number()
    .int()
    .positive()
    .max(24 * 3600),
});

export const limitsFileSchema = z.strictObject({
  $schema: z.string().optional(),
  defaults: z.strictObject({
    browser: modeLimitsSchema,
    server: modeLimitsSchema,
  }),
  /** Per-category overrides (partial). */
  categories: z.partialRecord(
    categoryIdSchema,
    z.strictObject({
      browser: modeLimitsSchema.partial().optional(),
      server: modeLimitsSchema.partial().optional(),
    }),
  ),
  archive: z.strictObject({
    maxEntries: z.number().int().positive(),
    maxExtractedBytes: bytes,
    maxCompressionRatio: z.number().positive(),
    maxPathLength: z.number().int().positive(),
    maxDepth: z.number().int().min(0),
  }),
  media: z.strictObject({
    maxDurationSeconds: z.number().int().positive(),
    maxPixels: z.number().int().positive(),
    maxPages: z.number().int().positive(),
  }),
  retention: z.strictObject({
    /** Seconds an unsubmitted upload may stay before cleanup. */
    abandonedUploadSeconds: z.number().int().positive(),
    /** Seconds outputs stay downloadable after completion. */
    outputSeconds: z.number().int().positive(),
    /** Seconds a failed or cancelled job's files are kept. */
    failedSeconds: z.number().int().positive(),
    /** Lifetime of signed download/upload URLs. */
    signedUrlSeconds: z.number().int().positive(),
    /** Seconds a job record (metadata only, never file contents) is kept after it ends. */
    jobRecordSeconds: z.number().int().positive(),
  }),
  rateLimits: z.strictObject({
    jobsPerHour: z.number().int().positive(),
    jobsPerMinute: z.number().int().positive(),
  }),
});

// ---------------------------------------------------------------------------
// Popular entries (curated ordering for the homepage)
// ---------------------------------------------------------------------------

export const popularFileSchema = z.strictObject({
  $schema: z.string().optional(),
  conversions: z.array(z.tuple([id, id])).max(100),
  tools: z.array(slug).max(50),
});

// ---------------------------------------------------------------------------
// Inferred types (authored shape; optional fields are defaulted by the compiler)
// ---------------------------------------------------------------------------

export type RawCategory = z.infer<typeof categorySchema>;
export type RawFormat = z.infer<typeof formatSchema>;
export type RawEngine = z.infer<typeof engineSchema>;
export type RawOption = z.infer<typeof optionSchema>;
export type RawOptionChoice = z.infer<typeof optionChoiceSchema>;
export type RawOptionRef = z.infer<typeof optionRefSchema>;
export type RawLimitation = z.infer<typeof limitationSchema>;
export type RawRule = z.infer<typeof ruleSchema>;
export type RawRuleOverride = z.infer<typeof ruleOverrideSchema>;
export type RawSelector = z.infer<typeof selectorSchema>;
export type RawTool = z.infer<typeof toolSchema>;
export type RawToolRoute = z.infer<typeof toolRouteSchema>;
export type RawLimits = z.infer<typeof limitsFileSchema>;
export type RawModeLimits = z.infer<typeof modeLimitsSchema>;
export type RawPopular = z.infer<typeof popularFileSchema>;
export type SignatureCondition = z.infer<typeof signatureConditionSchema>;
export type Signature = z.infer<typeof signatureSchema>;
export type Sniff = z.infer<typeof sniffSchema>;

/** The complete authored catalog, aggregated from the JSON files. */
export interface RawCatalog {
  categories: RawCategory[];
  formats: RawFormat[];
  engines: RawEngine[];
  options: RawOption[];
  limitations: RawLimitation[];
  rules: RawRule[];
  tools: RawTool[];
  limits: RawLimits;
  popular: RawPopular;
}
