/**
 * Compiles the raw catalog into a queryable registry.
 *
 * Conversion rules are expanded into concrete routes:
 *
 *   from-candidates = selector(rule.from) ∩ firstEngine.read
 *   to-candidates   = selector(rule.to)   ∩ lastEngine.write
 *   routes          = from × to − identity − exclusions, then overrides
 *
 * Each route's effective status is the worst of the rule/override status, every step
 * engine's status cap and both formats' editorial status. Limitations are the rule's
 * explicit ones plus those derived from format traits (see `quality.ts`).
 *
 * The compiler is pure, deterministic and dependency-free so it can run in the browser,
 * in serverless functions and in workers alike.
 */
import {
  ENGINE_STATUS_CAP,
  bestStatus,
  isIndexable,
  isOffered,
  worstStatus,
  type CategoryId,
  type EngineStatus,
  type ProcessingMode,
  type Status,
} from '../catalog/constants.ts';
import type {
  RawCatalog,
  RawEngine,
  RawFormat,
  RawOption,
  RawOptionRef,
  RawRule,
  RawRuleOverride,
  RawSelector,
} from '../catalog/schema.ts';
import { deriveLimitations, deriveQuality, sortLimitations } from './quality.ts';
import { Registry } from './registry.ts';
import type {
  Category,
  Conversion,
  Engine,
  Format,
  Limitation,
  OptionDef,
  RegistryEnvironment,
  Route,
  RouteStep,
  Tool,
  ToolRoute,
} from './types.ts';

/** Defaults for optional catalog fields. The JSON schema documents the same values. */
export const CATALOG_DEFAULTS = {
  formatStatus: 'stable' as Status,
  formatPopularity: 10,
  ruleCardinality: '1:1' as const,
  ruleBatch: 'per-file' as const,
  toolPopularity: 10,
};

export class CatalogCompileError extends Error {
  override name = 'CatalogCompileError';
}

function normalizeFormat(raw: RawFormat): Format {
  return {
    id: raw.id,
    label: raw.label,
    name: raw.name,
    description: raw.description,
    category: raw.category,
    categories: [raw.category, ...(raw.alsoIn ?? []).filter((c) => c !== raw.category)],
    extensions: raw.extensions,
    mimeTypes: raw.mimeTypes,
    aliases: raw.aliases ?? [],
    signatures: (raw.signatures ?? []).map((signature) =>
      signature.map((condition) => ({ ...condition, offset: condition.offset ?? 0 })),
    ),
    sniff: raw.sniff ?? null,
    traits: raw.traits ?? [],
    status: raw.status ?? CATALOG_DEFAULTS.formatStatus,
    popularity: raw.popularity ?? CATALOG_DEFAULTS.formatPopularity,
    notes: raw.notes ?? null,
    support: { browser: null, server: null },
    readable: false,
    writable: false,
    engines: [],
  };
}

function normalizeEngine(raw: RawEngine, env: RegistryEnvironment): Engine {
  let status: EngineStatus = raw.status;
  if (env.disabledModes?.includes(raw.mode)) status = 'disabled';
  const forced = env.engineStatus?.[raw.id];
  if (forced !== undefined) status = forced;
  return {
    id: raw.id,
    name: raw.name,
    mode: raw.mode,
    status,
    description: raw.description,
    homepage: raw.homepage,
    license: raw.license,
    licenseNotes: raw.licenseNotes ?? null,
    binaries: raw.binaries ?? [],
    pool: raw.pool ?? null,
    read: raw.capabilities.read,
    write: raw.capabilities.write,
  };
}

function normalizeOption(raw: RawOption): OptionDef {
  return {
    id: raw.id,
    type: raw.type,
    label: raw.label,
    help: raw.help ?? null,
    advanced: raw.advanced ?? false,
    default: raw.default ?? null,
    min: raw.min ?? null,
    max: raw.max ?? null,
    step: raw.step ?? null,
    unit: raw.unit ?? null,
    choices: raw.choices ?? null,
    pattern: raw.pattern ?? null,
    maxLength: raw.maxLength ?? null,
  };
}

/** Resolves option references (ids or narrowing objects), memoized per distinct reference. */
class OptionResolver {
  private readonly cache = new Map<string, OptionDef>();
  private readonly options: ReadonlyMap<string, OptionDef>;

  constructor(options: ReadonlyMap<string, OptionDef>) {
    this.options = options;
  }

  resolve(ref: RawOptionRef, context: string): OptionDef {
    const key = typeof ref === 'string' ? ref : JSON.stringify(ref);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const id = typeof ref === 'string' ? ref : ref.id;
    const base = this.options.get(id);
    if (!base) throw new CatalogCompileError(`${context}: unknown option "${id}"`);
    let resolved = base;
    if (typeof ref !== 'string') {
      const narrowedChoices =
        ref.choices && base.choices
          ? ref.choices.map((value) => {
              const choice = base.choices?.find((c) => c.value === value);
              if (!choice) {
                throw new CatalogCompileError(
                  `${context}: option "${id}" has no choice ${JSON.stringify(value)}`,
                );
              }
              return choice;
            })
          : base.choices;
      resolved = {
        ...base,
        default: ref.default ?? base.default,
        min: ref.min ?? base.min,
        max: ref.max ?? base.max,
        choices: narrowedChoices,
      };
    }
    this.cache.set(key, resolved);
    return resolved;
  }

  resolveList(refs: readonly RawOptionRef[], context: string): OptionDef[] {
    const out = new Map<string, OptionDef>();
    for (const ref of refs) {
      const def = this.resolve(ref, context);
      out.set(def.id, def);
    }
    return [...out.values()];
  }
}

function matchesPair(
  selector: { from?: string | string[]; to?: string | string[] },
  from: string,
  to: string,
): boolean {
  const match = (value: string | string[] | undefined, candidate: string): boolean =>
    value === undefined || (Array.isArray(value) ? value.includes(candidate) : value === candidate);
  return match(selector.from, from) && match(selector.to, to);
}

function selectFormats(
  selector: RawSelector,
  formats: readonly Format[],
  formatById: ReadonlyMap<string, Format>,
): string[] {
  const picked = new Set<string>();
  for (const id of selector.formats ?? []) if (formatById.has(id)) picked.add(id);
  if (selector.categories) {
    const categories = new Set<CategoryId>(selector.categories);
    for (const format of formats) if (categories.has(format.category)) picked.add(format.id);
  }
  let ids = [...picked];
  if (selector.traits && selector.traits.length > 0) {
    const required = selector.traits;
    ids = ids.filter((id) => {
      const format = formatById.get(id);
      return format !== undefined && required.every((trait) => format.traits.includes(trait));
    });
  }
  const excluded = new Set(selector.exclude ?? []);
  return ids.filter((id) => !excluded.has(id));
}

interface PairSettings {
  status: Status;
  cardinality: Route['cardinality'];
  imperfect: boolean;
  optionRefs: RawOptionRef[];
  explicit: string[];
}

/** Applies matching overrides, in order, on top of the rule's settings for one pair. */
function resolvePair(rule: RawRule, from: string, to: string): PairSettings {
  const settings: PairSettings = {
    status: rule.status,
    cardinality: rule.cardinality ?? CATALOG_DEFAULTS.ruleCardinality,
    imperfect: rule.imperfect ?? false,
    optionRefs: [...(rule.options ?? [])],
    explicit: [...(rule.limitations ?? [])],
  };
  for (const override of rule.overrides ?? []) {
    if (matchesPair(override, from, to)) applyOverride(settings, override);
  }
  return settings;
}

function applyOverride(settings: PairSettings, override: RawRuleOverride): void {
  if (override.status) settings.status = override.status;
  if (override.cardinality) settings.cardinality = override.cardinality;
  if (override.imperfect !== undefined) settings.imperfect = override.imperfect;
  if (override.options) settings.optionRefs = [...override.options];
  if (override.addOptions) settings.optionRefs = [...settings.optionRefs, ...override.addOptions];
  if (override.limitations) settings.explicit.push(...override.limitations);
}

function engineCap(engine: Engine): Status {
  return ENGINE_STATUS_CAP[engine.status];
}

interface ExpandContext {
  formats: readonly Format[];
  formatById: ReadonlyMap<string, Format>;
  engineById: ReadonlyMap<string, Engine>;
  limitationById: ReadonlyMap<string, Limitation>;
  options: OptionResolver;
}

function expandRule(rule: RawRule, ctx: ExpandContext): Route[] {
  const engines = rule.steps.map((id) => {
    const engine = ctx.engineById.get(id);
    if (!engine) throw new CatalogCompileError(`rule ${rule.id}: unknown engine "${id}"`);
    if (engine.mode !== rule.mode) {
      throw new CatalogCompileError(
        `rule ${rule.id}: engine ${id} runs in ${engine.mode}, rule is ${rule.mode}`,
      );
    }
    return engine;
  });
  const first = engines[0];
  const last = engines[engines.length - 1];
  if (!first || !last) throw new CatalogCompileError(`rule ${rule.id}: no steps`);
  const via = rule.via ?? [];
  if (via.length !== engines.length - 1) {
    throw new CatalogCompileError(
      `rule ${rule.id}: needs ${engines.length - 1} intermediate format(s)`,
    );
  }

  const fromIds = selectFormats(rule.from, ctx.formats, ctx.formatById).filter((id) =>
    first.read.includes(id),
  );
  const toIds = selectFormats(rule.to, ctx.formats, ctx.formatById).filter((id) =>
    last.write.includes(id),
  );
  const engineStatus = engines.map(engineCap).reduce(worstStatus, 'stable' as Status);
  const pools = new Set(engines.map((e) => e.pool));
  const pool = first.pool;
  if (rule.mode === 'server' && pools.size > 1) {
    throw new CatalogCompileError(`rule ${rule.id}: pipeline steps must share one worker pool`);
  }

  const routes: Route[] = [];
  for (const from of fromIds) {
    for (const to of toIds) {
      if (from === to && !(rule.identity ?? false)) continue;
      if ((rule.exclude ?? []).some((pair) => matchesPair(pair, from, to))) continue;

      const pair = resolvePair(rule, from, to);
      const { status, cardinality, imperfect, optionRefs, explicit } = pair;

      const fromFormat = ctx.formatById.get(from);
      const toFormat = ctx.formatById.get(to);
      if (!fromFormat || !toFormat) continue;
      const effective = [status, engineStatus, fromFormat.status, toFormat.status].reduce(
        worstStatus,
      );
      const derived = deriveLimitations(fromFormat, toFormat, {
        cardinality,
        metadata: rule.metadata,
      });
      const steps: RouteStep[] = engines.map((engine, index) => ({
        engine: engine.id,
        from: index === 0 ? from : (via[index - 1] ?? from),
        to: index === engines.length - 1 ? to : (via[index] ?? to),
      }));
      routes.push({
        id: `${rule.id}:${from}-${to}`,
        ruleId: rule.id,
        from,
        to,
        mode: rule.mode,
        steps,
        engines: engines.map((e) => e.id),
        pool: rule.mode === 'server' ? pool : null,
        status: effective,
        priority: rule.priority,
        cardinality,
        batch: rule.batch ?? CATALOG_DEFAULTS.ruleBatch,
        options: ctx.options.resolveList(optionRefs, `rule ${rule.id} (${from}→${to})`),
        metadata: rule.metadata,
        limitations: sortLimitations([...derived, ...explicit], ctx.limitationById),
        imperfect,
        offered: isOffered(effective),
      });
    }
  }
  return routes;
}

const MODE_ORDER: Record<ProcessingMode, number> = { browser: 0, server: 1 };

function compareRoutes(a: Route, b: Route): number {
  return (
    Number(b.offered) - Number(a.offered) ||
    a.priority - b.priority ||
    MODE_ORDER[a.mode] - MODE_ORDER[b.mode] ||
    a.id.localeCompare(b.id)
  );
}

function buildConversion(from: Format, to: Format, routes: Route[]): Conversion {
  routes.sort(compareRoutes);
  const offeredRoutes = routes.filter((route) => route.offered);
  const primary = offeredRoutes[0] ?? routes[0];
  const status = offeredRoutes.map((r) => r.status).reduce(bestStatus, 'unsupported' as Status);
  const offered = offeredRoutes.length > 0;
  const limitations = primary ? primary.limitations : [];
  return {
    key: `${from.id}:${to.id}`,
    from: from.id,
    to: to.id,
    routes,
    status,
    offered,
    indexable: offered && isIndexable(status),
    modes: [...new Set(offeredRoutes.map((r) => r.mode))].sort(
      (a, b) => MODE_ORDER[a] - MODE_ORDER[b],
    ),
    limitations,
    quality: deriveQuality(
      limitations,
      primary?.metadata ?? 'unsupported',
      primary?.imperfect ?? false,
    ),
    popularity: Math.round(Math.sqrt(from.popularity * to.popularity)),
  };
}

function compileTool(raw: RawCatalog['tools'][number], ctx: ExpandContext): Tool {
  const routes: ToolRoute[] = raw.routes.map((route) => {
    const engine = ctx.engineById.get(route.engine);
    if (!engine) throw new CatalogCompileError(`tool ${raw.id}: unknown engine "${route.engine}"`);
    const status = worstStatus(route.status, engineCap(engine));
    return {
      id: `${raw.id}:${route.engine}:${route.operation}`,
      toolId: raw.id,
      engine: route.engine,
      mode: route.mode,
      operation: route.operation,
      status,
      priority: route.priority,
      options: ctx.options.resolveList(route.options ?? [], `tool ${raw.id}`),
      pool: route.mode === 'server' ? engine.pool : null,
      offered: isOffered(status),
      inputs: route.inputs ?? raw.inputs,
    };
  });
  routes.sort(
    (a, b) =>
      Number(b.offered) - Number(a.offered) ||
      a.priority - b.priority ||
      MODE_ORDER[a.mode] - MODE_ORDER[b.mode],
  );
  const offeredRoutes = routes.filter((r) => r.offered);
  const status = offeredRoutes.map((r) => r.status).reduce(bestStatus, 'unsupported' as Status);
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    category: raw.category,
    kind: raw.kind,
    inputs: raw.inputs,
    acceptsText: raw.acceptsText ?? false,
    output: raw.output,
    cardinality: raw.cardinality,
    metadata: raw.metadata,
    limitations: sortLimitations(raw.limitations ?? [], ctx.limitationById),
    popularity: raw.popularity ?? CATALOG_DEFAULTS.toolPopularity,
    routes,
    status,
    offered: offeredRoutes.length > 0,
    indexable: offeredRoutes.length > 0 && isIndexable(status),
  };
}

export function compileRegistry(raw: RawCatalog, env: RegistryEnvironment = {}): Registry {
  const formats = raw.formats.map(normalizeFormat);
  const formatById = new Map(formats.map((f) => [f.id, f]));
  const engines = raw.engines.map((e) => normalizeEngine(e, env));
  const engineById = new Map(engines.map((e) => [e.id, e]));
  const optionById = new Map(raw.options.map((o) => [o.id, normalizeOption(o)]));
  const limitationById = new Map<string, Limitation>(raw.limitations.map((l) => [l.id, l]));
  const ctx: ExpandContext = {
    formats,
    formatById,
    engineById,
    limitationById,
    options: new OptionResolver(optionById),
  };

  // Expand every rule and group the routes per (from, to) pair.
  const routesByKey = new Map<string, Route[]>();
  for (const rule of raw.rules) {
    for (const route of expandRule(rule, ctx)) {
      const key = `${route.from}:${route.to}`;
      const list = routesByKey.get(key);
      if (list) list.push(route);
      else routesByKey.set(key, [route]);
    }
  }

  const conversions: Conversion[] = [];
  for (const routes of routesByKey.values()) {
    const first = routes[0];
    if (!first) continue;
    const from = formatById.get(first.from);
    const to = formatById.get(first.to);
    if (from && to) conversions.push(buildConversion(from, to, routes));
  }
  conversions.sort((a, b) => b.popularity - a.popularity || a.key.localeCompare(b.key));

  const tools = raw.tools.map((tool) => compileTool(tool, ctx));
  tools.sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id));

  // Derived format support from offered routes and tools.
  const engineSets = new Map<string, Set<string>>();
  const touch = (
    formatId: string,
    mode: ProcessingMode,
    status: Status,
    engineIds: readonly string[],
  ): void => {
    const format = formatById.get(formatId);
    if (!format) return;
    const current = format.support[mode];
    format.support[mode] = current === null ? status : bestStatus(current, status);
    let set = engineSets.get(formatId);
    if (!set) engineSets.set(formatId, (set = new Set()));
    for (const id of engineIds) set.add(id);
  };
  for (const conversion of conversions) {
    for (const route of conversion.routes) {
      if (!route.offered) continue;
      touch(route.from, route.mode, route.status, route.engines);
      touch(route.to, route.mode, route.status, route.engines);
      const from = formatById.get(route.from);
      const to = formatById.get(route.to);
      if (from) from.readable = true;
      if (to) to.writable = true;
    }
  }
  for (const tool of tools) {
    for (const route of tool.routes) {
      if (!route.offered) continue;
      for (const input of route.inputs) {
        if (input === '*') continue;
        touch(input, route.mode, route.status, [route.engine]);
      }
    }
  }
  for (const [id, set] of engineSets) {
    const format = formatById.get(id);
    if (format) format.engines = [...set].sort();
  }

  const categories: Category[] = raw.categories
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      order: c.order,
      icon: c.icon,
      formatIds: formats
        .filter((f) => f.category === c.id)
        .sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id))
        .map((f) => f.id),
      relatedFormatIds: formats
        .filter((f) => f.category !== c.id && f.categories.includes(c.id))
        .sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id))
        .map((f) => f.id),
    }))
    .sort((a, b) => a.order - b.order);

  return new Registry({
    formats,
    engines,
    options: [...optionById.values()],
    limitations: raw.limitations,
    categories,
    conversions,
    tools,
    limits: raw.limits,
    popular: raw.popular,
  });
}
