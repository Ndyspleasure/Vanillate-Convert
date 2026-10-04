import type { CategoryId, ProcessingMode } from '../catalog/constants.ts';
import type { RawLimits, RawPopular } from '../catalog/schema.ts';
import type {
  ArchiveLimits,
  Category,
  Conversion,
  Engine,
  Format,
  Limitation,
  MediaLimits,
  ModeLimits,
  OptionDef,
  PopularEntries,
  RateLimitPolicy,
  RetentionPolicy,
  Route,
  Tool,
  ToolRoute,
} from './types.ts';

export interface RegistryData {
  formats: Format[];
  engines: Engine[];
  options: OptionDef[];
  limitations: Limitation[];
  categories: Category[];
  conversions: Conversion[];
  tools: Tool[];
  limits: RawLimits;
  popular: RawPopular;
}

/** Normalizes a user-supplied format token: `.JPG`, `jpeg`, `JPG ` → `jpg`/`jpeg`. */
export function normalizeToken(token: string): string {
  return token.trim().toLowerCase().replace(/^\.+/, '');
}

/**
 * Read-only, indexed view over the compiled catalog. Construct it with `compileRegistry()`.
 */
export class Registry {
  readonly formats: readonly Format[];
  readonly engines: readonly Engine[];
  readonly options: readonly OptionDef[];
  readonly limitations: readonly Limitation[];
  readonly categories: readonly Category[];
  readonly conversions: readonly Conversion[];
  readonly tools: readonly Tool[];

  private readonly limitsData: RawLimits;
  private readonly popularData: RawPopular;
  private readonly formatById = new Map<string, Format>();
  private readonly tokenToFormat = new Map<string, string>();
  private readonly extensionIndex = new Map<string, Format[]>();
  private readonly mimeIndex = new Map<string, Format[]>();
  private readonly engineById = new Map<string, Engine>();
  private readonly optionById = new Map<string, OptionDef>();
  private readonly limitationById = new Map<string, Limitation>();
  private readonly categoryById = new Map<CategoryId, Category>();
  private readonly conversionByKey = new Map<string, Conversion>();
  private readonly conversionsFromIndex = new Map<string, Conversion[]>();
  private readonly conversionsToIndex = new Map<string, Conversion[]>();
  private readonly routeById = new Map<string, Route>();
  private readonly toolById = new Map<string, Tool>();
  private readonly toolRouteById = new Map<string, ToolRoute>();

  constructor(data: RegistryData) {
    this.formats = data.formats;
    this.engines = data.engines;
    this.options = data.options;
    this.limitations = data.limitations;
    this.categories = data.categories;
    this.conversions = data.conversions;
    this.tools = data.tools;
    this.limitsData = data.limits;
    this.popularData = data.popular;

    const byPopularity = [...data.formats].sort(
      (a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id),
    );
    for (const format of byPopularity) {
      this.formatById.set(format.id, format);
      for (const ext of format.extensions) push(this.extensionIndex, ext, format);
      for (const mime of format.mimeTypes) push(this.mimeIndex, mime, format);
    }
    // Ids win over aliases, aliases win over extensions.
    for (const format of byPopularity) {
      for (const ext of format.extensions)
        if (!this.tokenToFormat.has(ext)) this.tokenToFormat.set(ext, format.id);
    }
    for (const format of byPopularity)
      for (const alias of format.aliases) this.tokenToFormat.set(alias, format.id);
    for (const format of byPopularity) this.tokenToFormat.set(format.id, format.id);

    for (const engine of data.engines) this.engineById.set(engine.id, engine);
    for (const option of data.options) this.optionById.set(option.id, option);
    for (const limitation of data.limitations) this.limitationById.set(limitation.id, limitation);
    for (const category of data.categories) this.categoryById.set(category.id, category);
    for (const conversion of data.conversions) {
      this.conversionByKey.set(conversion.key, conversion);
      push(this.conversionsFromIndex, conversion.from, conversion);
      push(this.conversionsToIndex, conversion.to, conversion);
      for (const route of conversion.routes) this.routeById.set(route.id, route);
    }
    for (const tool of data.tools) {
      this.toolById.set(tool.id, tool);
      for (const route of tool.routes) this.toolRouteById.set(route.id, route);
    }
    const byTargetPopularity = (field: 'from' | 'to') => (a: Conversion, b: Conversion) =>
      (this.formatById.get(b[field])?.popularity ?? 0) -
        (this.formatById.get(a[field])?.popularity ?? 0) || a.key.localeCompare(b.key);
    for (const list of this.conversionsFromIndex.values()) list.sort(byTargetPopularity('to'));
    for (const list of this.conversionsToIndex.values()) list.sort(byTargetPopularity('from'));
  }

  // ---------------------------------------------------------------- formats

  format(id: string): Format | undefined {
    return this.formatById.get(id);
  }

  requireFormat(id: string): Format {
    const format = this.formatById.get(id);
    if (!format) throw new Error(`Unknown format "${id}"`);
    return format;
  }

  /** Resolves an id, alias or extension (case-insensitive, leading dots ignored). */
  resolveFormat(token: string): Format | undefined {
    const id = this.tokenToFormat.get(normalizeToken(token));
    return id === undefined ? undefined : this.formatById.get(id);
  }

  /** Formats that use the extension, most popular first. */
  formatsByExtension(extension: string): readonly Format[] {
    return this.extensionIndex.get(normalizeToken(extension)) ?? [];
  }

  /** Formats that declare the MIME type (parameters ignored), most popular first. */
  formatsByMime(mime: string): readonly Format[] {
    const bare = mime.split(';')[0]?.trim().toLowerCase() ?? '';
    return this.mimeIndex.get(bare) ?? [];
  }

  // ------------------------------------------------------------ conversions

  conversion(from: string, to: string): Conversion | undefined {
    return this.conversionByKey.get(`${from}:${to}`);
  }

  /** Conversions from a format, ordered by target popularity. */
  conversionsFrom(formatId: string, { offeredOnly = true } = {}): Conversion[] {
    const list = this.conversionsFromIndex.get(formatId) ?? [];
    return offeredOnly ? list.filter((c) => c.offered) : [...list];
  }

  /** Conversions into a format, ordered by source popularity. */
  conversionsTo(formatId: string, { offeredOnly = true } = {}): Conversion[] {
    const list = this.conversionsToIndex.get(formatId) ?? [];
    return offeredOnly ? list.filter((c) => c.offered) : [...list];
  }

  offeredConversions(): Conversion[] {
    return this.conversions.filter((c) => c.offered);
  }

  indexableConversions(): Conversion[] {
    return this.conversions.filter((c) => c.indexable);
  }

  route(id: string): Route | undefined {
    return this.routeById.get(id);
  }

  /** The preferred offered route of a conversion for a mode, if any. */
  preferredRoute(conversion: Conversion, mode?: ProcessingMode): Route | undefined {
    return conversion.routes.find((r) => r.offered && (mode === undefined || r.mode === mode));
  }

  // ------------------------------------------------------------------ tools

  tool(id: string): Tool | undefined {
    return this.toolById.get(id);
  }

  toolRoute(id: string): ToolRoute | undefined {
    return this.toolRouteById.get(id);
  }

  offeredTools(): Tool[] {
    return this.tools.filter((t) => t.offered);
  }

  /** Offered tools that accept the format (tools accepting any file are included). */
  toolsFor(formatId: string): Tool[] {
    return this.tools.filter(
      (t) => t.offered && (t.inputs.includes(formatId) || t.inputs.includes('*')),
    );
  }

  // ------------------------------------------------------ catalog metadata

  engine(id: string): Engine | undefined {
    return this.engineById.get(id);
  }

  option(id: string): OptionDef | undefined {
    return this.optionById.get(id);
  }

  limitation(id: string): Limitation | undefined {
    return this.limitationById.get(id);
  }

  category(id: string): Category | undefined {
    return this.categoryById.get(id as CategoryId);
  }

  /** Categories that contain at least one format, in navigation order. */
  visibleCategories(): Category[] {
    return this.categories.filter((c) => c.formatIds.length > 0);
  }

  // ----------------------------------------------------------------- limits

  limitsFor(mode: ProcessingMode, category: CategoryId): ModeLimits {
    const defaults = this.limitsData.defaults[mode];
    const override = this.limitsData.categories[category]?.[mode] ?? {};
    return { ...defaults, ...override };
  }

  get archiveLimits(): ArchiveLimits {
    return this.limitsData.archive;
  }

  get mediaLimits(): MediaLimits {
    return this.limitsData.media;
  }

  get retention(): RetentionPolicy {
    return this.limitsData.retention;
  }

  get rateLimits(): RateLimitPolicy {
    return this.limitsData.rateLimits;
  }

  // ---------------------------------------------------------------- popular

  /** Curated popular entries that are actually offered in this deployment. */
  popular(): PopularEntries {
    const conversions = this.popularData.conversions
      .map(([from, to]) => this.conversion(from, to))
      .filter((c): c is Conversion => c !== undefined && c.offered);
    const tools = this.popularData.tools
      .map((id) => this.tool(id))
      .filter((t): t is Tool => t !== undefined && t.offered);
    return { conversions, tools };
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
