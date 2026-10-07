/**
 * Compiled registry types. These are the shapes the web app, API and workers consume.
 * Everything here is plain data (JSON-serializable) so it can cross the server/client
 * boundary and be cached.
 */
import type {
  BatchMode,
  Cardinality,
  CategoryId,
  EngineStatus,
  LimitationSeverity,
  Locale,
  MetadataPolicy,
  OptionType,
  ProcessingMode,
  Status,
  ToolKind,
  Trait,
  WorkerPool,
} from '../catalog/constants.ts';
import type { Signature, Sniff } from '../catalog/schema.ts';

export type LocalizedText = Record<Locale, string>;

export interface Category {
  id: CategoryId;
  name: LocalizedText;
  description: LocalizedText;
  order: number;
  icon: string;
  /** Formats whose primary category is this one. */
  formatIds: string[];
  /** Formats listed here as a secondary category. */
  relatedFormatIds: string[];
}

export interface FormatSupport {
  browser: Status | null;
  server: Status | null;
}

export interface Format {
  id: string;
  label: string;
  name: LocalizedText;
  description: LocalizedText;
  category: CategoryId;
  /** Primary category first, then secondary categories. */
  categories: CategoryId[];
  extensions: string[];
  mimeTypes: string[];
  aliases: string[];
  signatures: Signature[];
  sniff: Sniff | null;
  traits: Trait[];
  /** Editorial status cap from the catalog. */
  status: Status;
  popularity: number;
  notes: LocalizedText | null;
  // ---- derived from offered routes ----
  /** Best offered route status per processing mode (input or output side). */
  support: FormatSupport;
  /** The format can be converted *from*. */
  readable: boolean;
  /** The format can be converted *to*. */
  writable: boolean;
  /** Engines used by offered routes touching this format. */
  engines: string[];
}

export interface Engine {
  id: string;
  name: string;
  mode: ProcessingMode;
  /** Effective status after environment overrides. */
  status: EngineStatus;
  description: string;
  homepage: string;
  license: string;
  licenseNotes: string | null;
  binaries: string[];
  pool: WorkerPool | null;
  read: string[];
  write: string[];
}

export type OptionValue = string | number | boolean;

export interface OptionChoice {
  value: string | number;
  label: LocalizedText;
}

export interface OptionDef {
  id: string;
  type: OptionType;
  label: LocalizedText;
  help: LocalizedText | null;
  advanced: boolean;
  default: OptionValue | null;
  min: number | null;
  max: number | null;
  step: number | null;
  unit: string | null;
  choices: OptionChoice[] | null;
  pattern: string | null;
  maxLength: number | null;
}

export interface Limitation {
  id: string;
  severity: LimitationSeverity;
  text: LocalizedText;
}

export interface RouteStep {
  engine: string;
  from: string;
  to: string;
}

export interface Route {
  /** Stable id: `<ruleId>:<from>-<to>`. */
  id: string;
  ruleId: string;
  from: string;
  to: string;
  mode: ProcessingMode;
  steps: RouteStep[];
  engines: string[];
  /** Worker pool for server routes. */
  pool: WorkerPool | null;
  /** Effective status (worst of rule, engines and format caps). */
  status: Status;
  priority: number;
  cardinality: Cardinality;
  batch: BatchMode;
  options: OptionDef[];
  metadata: MetadataPolicy;
  /** Limitation ids, explicit and derived, warnings first. */
  limitations: string[];
  imperfect: boolean;
  offered: boolean;
}

export interface QualityModel {
  lossless: boolean;
  lossy: boolean;
  metadataChanging: boolean;
  resolutionChanging: boolean;
  structureChanging: boolean;
  potentiallyImperfect: boolean;
}

export interface Conversion {
  /** `<from>:<to>` */
  key: string;
  from: string;
  to: string;
  /** All routes, offered first, then by priority (browser before server on ties). */
  routes: Route[];
  /** Best offered route status, or `unsupported`. */
  status: Status;
  offered: boolean;
  indexable: boolean;
  modes: ProcessingMode[];
  /** Limitations of the preferred route. */
  limitations: string[];
  quality: QualityModel;
  popularity: number;
}

export interface ToolRoute {
  /** Stable id: `<toolId>:<engine>:<operation>`. */
  id: string;
  toolId: string;
  engine: string;
  mode: ProcessingMode;
  operation: string;
  status: Status;
  priority: number;
  options: OptionDef[];
  pool: WorkerPool | null;
  offered: boolean;
  /** Input formats this route handles; `*` accepts any file. */
  inputs: string[];
}

export interface Tool {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  category: CategoryId;
  kind: ToolKind;
  /** Accepted input format ids; `*` accepts any file. */
  inputs: string[];
  acceptsText: boolean;
  /** `same`, `detect` or a format id. */
  output: string;
  cardinality: Cardinality;
  metadata: MetadataPolicy;
  limitations: string[];
  popularity: number;
  routes: ToolRoute[];
  status: Status;
  offered: boolean;
  indexable: boolean;
}

export interface ModeLimits {
  maxInputBytes: number;
  maxTotalInputBytes: number;
  maxOutputBytes: number;
  maxFilesPerJob: number;
  maxJobSeconds: number;
}

export interface ArchiveLimits {
  maxEntries: number;
  maxExtractedBytes: number;
  maxCompressionRatio: number;
  maxPathLength: number;
  maxDepth: number;
}

export interface MediaLimits {
  maxDurationSeconds: number;
  maxPixels: number;
  maxPages: number;
}

export interface RetentionPolicy {
  abandonedUploadSeconds: number;
  outputSeconds: number;
  failedSeconds: number;
  signedUrlSeconds: number;
  jobRecordSeconds: number;
}

export interface RateLimitPolicy {
  jobsPerHour: number;
  jobsPerMinute: number;
}

/** Deployment-specific adjustments applied at compile time. */
export interface RegistryEnvironment {
  /** Force engine statuses (e.g. `{ libreoffice: 'disabled' }`). */
  engineStatus?: Readonly<Record<string, EngineStatus>>;
  /** Disable every engine of these modes (e.g. `['server']` when no workers exist). */
  disabledModes?: readonly ProcessingMode[];
}

export interface PopularEntries {
  conversions: Conversion[];
  tools: Tool[];
}
