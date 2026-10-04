/**
 * Catalog validation: schema checks (zod) plus referential integrity and invariants that a
 * schema cannot express. Used by tests, CI (`pnpm catalog:check`) and optionally at startup.
 *
 * Exposed as the `@vanillate/core/validate` subpath so that browser bundles never include zod.
 */
import { z } from 'zod';

import { compileRegistry, CatalogCompileError } from '../registry/compile.ts';
import { DERIVED_LIMITATION_IDS } from '../registry/quality.ts';
import { CATEGORY_IDS } from './constants.ts';
import {
  categorySchema,
  engineSchema,
  formatSchema,
  limitationSchema,
  limitsFileSchema,
  optionSchema,
  popularFileSchema,
  ruleSchema,
  toolSchema,
  type RawCatalog,
  type RawOption,
  type RawOptionRef,
} from './schema.ts';

export interface CatalogIssue {
  path: string;
  message: string;
}

export interface CatalogValidation {
  ok: boolean;
  issues: CatalogIssue[];
  catalog: RawCatalog | null;
}

/** Maximum number of head bytes the detectors read; signatures must fit inside. */
export const DETECTION_HEAD_BYTES = 65536;

const rawCatalogSchema = z.object({
  categories: z.array(categorySchema),
  formats: z.array(formatSchema),
  engines: z.array(engineSchema),
  options: z.array(optionSchema),
  limitations: z.array(limitationSchema),
  rules: z.array(ruleSchema),
  tools: z.array(toolSchema),
  limits: limitsFileSchema,
  popular: popularFileSchema,
});

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

function optionValueIssue(option: RawOption, value: unknown): string | null {
  switch (option.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected a boolean';
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'expected a number';
      if (option.type === 'integer' && !Number.isInteger(value)) return 'expected an integer';
      if (option.min !== undefined && value < option.min) return `below min ${option.min}`;
      if (option.max !== undefined && value > option.max) return `above max ${option.max}`;
      return null;
    }
    case 'enum':
      return option.choices?.some((c) => c.value === value) ? null : 'not one of the choices';
    case 'color':
      return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? null : 'expected #rrggbb';
    case 'text': {
      if (typeof value !== 'string') return 'expected a string';
      if (option.maxLength !== undefined && value.length > option.maxLength) return 'too long';
      return option.pattern && !new RegExp(option.pattern).test(value)
        ? 'does not match pattern'
        : null;
    }
  }
}

export function validateCatalog(input: unknown): CatalogValidation {
  const issues: CatalogIssue[] = [];
  const parsed = rawCatalogSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ path: issue.path.join('.'), message: issue.message });
    }
    return { ok: false, issues, catalog: null };
  }
  const catalog = input as RawCatalog;
  const add = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  // ---- uniqueness
  const sections = {
    categories: catalog.categories.map((c) => c.id),
    formats: catalog.formats.map((f) => f.id),
    engines: catalog.engines.map((e) => e.id),
    options: catalog.options.map((o) => o.id),
    limitations: catalog.limitations.map((l) => l.id),
    rules: catalog.rules.map((r) => r.id),
    tools: catalog.tools.map((t) => t.id),
  };
  for (const [section, ids] of Object.entries(sections)) {
    for (const dupe of duplicates(ids)) add(section, `duplicate id "${dupe}"`);
  }
  for (const id of CATEGORY_IDS) {
    if (!sections.categories.includes(id)) add('categories', `missing category "${id}"`);
  }

  const formatIds = new Set(sections.formats);
  const engineById = new Map(catalog.engines.map((e) => [e.id, e]));
  const optionById = new Map(catalog.options.map((o) => [o.id, o]));
  const limitationIds = new Set(sections.limitations);

  // ---- formats
  const aliasOwner = new Map<string, string>();
  for (const format of catalog.formats) {
    const path = `formats.${format.id}`;
    if (format.id === 'to' || format.id === 'ke') add(path, 'id collides with a slug separator');
    for (const dupe of duplicates(format.extensions)) add(path, `duplicate extension "${dupe}"`);
    for (const dupe of duplicates(format.mimeTypes)) add(path, `duplicate MIME type "${dupe}"`);
    if (format.alsoIn?.includes(format.category)) add(path, 'alsoIn repeats the primary category');
    for (const alias of format.aliases ?? []) {
      if (formatIds.has(alias)) add(path, `alias "${alias}" collides with a format id`);
      const owner = aliasOwner.get(alias);
      if (owner !== undefined) add(path, `alias "${alias}" already used by "${owner}"`);
      aliasOwner.set(alias, format.id);
    }
    for (const [i, signature] of (format.signatures ?? []).entries()) {
      for (const condition of signature) {
        const length =
          condition.hex !== undefined ? condition.hex.length / 2 : (condition.ascii?.length ?? 0);
        const offset = condition.offset ?? 0;
        const end = offset + (condition.within ?? 0) + length;
        if (offset >= 0 && end > DETECTION_HEAD_BYTES) {
          add(
            `${path}.signatures[${i}]`,
            `reaches byte ${end}, beyond the ${DETECTION_HEAD_BYTES}-byte detection window`,
          );
        }
        if (offset < 0 && condition.within !== undefined)
          add(`${path}.signatures[${i}]`, '`within` cannot be used at negative offsets');
      }
    }
    if (format.sniff?.type === 'text') {
      try {
        new RegExp(format.sniff.pattern, format.sniff.flags);
      } catch (error) {
        add(`${path}.sniff`, `invalid pattern: ${(error as Error).message}`);
      }
    }
    if (format.notes === undefined && format.status === 'unsupported') {
      // An unsupported format should explain why on its page.
      add(path, 'unsupported formats need notes explaining the status');
    }
  }

  // ---- engines
  for (const engine of catalog.engines) {
    for (const side of ['read', 'write'] as const) {
      for (const id of engine.capabilities[side]) {
        if (!formatIds.has(id))
          add(`engines.${engine.id}.capabilities.${side}`, `unknown format "${id}"`);
      }
      for (const dupe of duplicates(engine.capabilities[side])) {
        add(`engines.${engine.id}.capabilities.${side}`, `duplicate format "${dupe}"`);
      }
    }
  }

  // ---- options
  for (const option of catalog.options) {
    const path = `options.${option.id}`;
    if (option.pattern !== undefined) {
      try {
        new RegExp(option.pattern);
      } catch (error) {
        add(path, `invalid pattern: ${(error as Error).message}`);
      }
      if (!option.pattern.startsWith('^') || !option.pattern.endsWith('$'))
        add(path, 'patterns must be anchored');
    }
    if (option.default !== undefined) {
      const problem = optionValueIssue(option, option.default);
      if (problem) add(path, `default ${JSON.stringify(option.default)}: ${problem}`);
    }
    if (option.choices) {
      for (const dupe of duplicates(option.choices.map((c) => String(c.value))))
        add(path, `duplicate choice "${dupe}"`);
    }
  }
  const checkOptionRef = (path: string, ref: RawOptionRef): void => {
    const id = typeof ref === 'string' ? ref : ref.id;
    const base = optionById.get(id);
    if (!base) {
      add(path, `unknown option "${id}"`);
      return;
    }
    if (typeof ref === 'string') return;
    if (ref.choices) {
      if (base.type !== 'enum') add(path, `option "${id}" is not an enum`);
      for (const value of ref.choices) {
        if (!base.choices?.some((c) => c.value === value))
          add(path, `option "${id}" has no choice ${JSON.stringify(value)}`);
      }
    }
    const narrowed: RawOption = {
      ...base,
      ...(ref.min !== undefined ? { min: ref.min } : {}),
      ...(ref.max !== undefined ? { max: ref.max } : {}),
      ...(ref.choices
        ? { choices: base.choices?.filter((c) => ref.choices?.includes(c.value)) }
        : {}),
    };
    if (ref.default !== undefined) {
      const problem = optionValueIssue(narrowed, ref.default);
      if (problem) add(path, `default for "${id}": ${problem}`);
    }
  };

  // ---- limitations used by code must exist
  for (const id of DERIVED_LIMITATION_IDS) {
    if (!limitationIds.has(id)) add('limitations', `derived limitation "${id}" is missing`);
  }

  // ---- rules
  for (const rule of catalog.rules) {
    const path = `rules.${rule.id}`;
    const engines = rule.steps.map((id) => engineById.get(id));
    engines.forEach((engine, i) => {
      if (!engine) add(path, `unknown engine "${rule.steps[i]}"`);
      else if (engine.mode !== rule.mode)
        add(path, `engine "${engine.id}" is a ${engine.mode} engine`);
    });
    const via = rule.via ?? [];
    if (via.length !== rule.steps.length - 1)
      add(path, `expected ${rule.steps.length - 1} "via" format(s)`);
    via.forEach((id, i) => {
      if (!formatIds.has(id)) add(path, `unknown via format "${id}"`);
      const producer = engines[i];
      const consumer = engines[i + 1];
      if (producer && !producer.capabilities.write.includes(id))
        add(path, `${producer.id} cannot write via format "${id}"`);
      if (consumer && !consumer.capabilities.read.includes(id))
        add(path, `${consumer.id} cannot read via format "${id}"`);
    });
    const selectorIds = [
      ...(rule.from.formats ?? []),
      ...(rule.from.exclude ?? []),
      ...(rule.to.formats ?? []),
      ...(rule.to.exclude ?? []),
    ];
    for (const id of selectorIds)
      if (!formatIds.has(id)) add(path, `unknown format "${id}" in selector`);
    const first = engines[0];
    const last = engines[engines.length - 1];
    for (const id of rule.from.formats ?? []) {
      if (first && formatIds.has(id) && !first.capabilities.read.includes(id))
        add(path, `${first.id} cannot read "${id}"`);
    }
    for (const id of rule.to.formats ?? []) {
      if (last && formatIds.has(id) && !last.capabilities.write.includes(id))
        add(path, `${last.id} cannot write "${id}"`);
    }
    for (const [i, ref] of (rule.options ?? []).entries())
      checkOptionRef(`${path}.options[${i}]`, ref);
    for (const id of rule.limitations ?? [])
      if (!limitationIds.has(id)) add(path, `unknown limitation "${id}"`);
    const pairIds = [...(rule.exclude ?? []), ...(rule.overrides ?? [])].flatMap((pair) => [
      ...[pair.from ?? []].flat(),
      ...[pair.to ?? []].flat(),
    ]);
    for (const id of pairIds)
      if (!formatIds.has(id)) add(path, `unknown format "${id}" in exclude/override`);
    for (const [i, override] of (rule.overrides ?? []).entries()) {
      for (const [j, ref] of [
        ...(override.options ?? []),
        ...(override.addOptions ?? []),
      ].entries()) {
        checkOptionRef(`${path}.overrides[${i}].options[${j}]`, ref);
      }
      for (const id of override.limitations ?? [])
        if (!limitationIds.has(id)) add(path, `unknown limitation "${id}"`);
    }
  }

  // ---- tools
  for (const tool of catalog.tools) {
    const path = `tools.${tool.id}`;
    for (const id of tool.inputs)
      if (id !== '*' && !formatIds.has(id)) add(path, `unknown input format "${id}"`);
    if (tool.output !== 'same' && tool.output !== 'detect' && !formatIds.has(tool.output)) {
      add(path, `unknown output format "${tool.output}"`);
    }
    for (const id of tool.limitations ?? [])
      if (!limitationIds.has(id)) add(path, `unknown limitation "${id}"`);
    for (const [i, route] of tool.routes.entries()) {
      const engine = engineById.get(route.engine);
      if (!engine) add(`${path}.routes[${i}]`, `unknown engine "${route.engine}"`);
      else if (engine.mode !== route.mode)
        add(`${path}.routes[${i}]`, `engine "${engine.id}" is a ${engine.mode} engine`);
      for (const [j, ref] of (route.options ?? []).entries())
        checkOptionRef(`${path}.routes[${i}].options[${j}]`, ref);
    }
  }

  // ---- compile: catches anything the checks above missed and validates expansion
  if (issues.length === 0) {
    try {
      const registry = compileRegistry(catalog);
      for (const rule of catalog.rules) {
        if (!registry.conversions.some((c) => c.routes.some((r) => r.ruleId === rule.id))) {
          add(`rules.${rule.id}`, 'rule expands to no conversion pairs');
        }
      }
      for (const [from, to] of catalog.popular.conversions) {
        if (!registry.conversion(from, to)?.offered)
          add('popular', `"${from} → ${to}" is not an offered conversion`);
      }
      for (const id of catalog.popular.tools) {
        if (!registry.tool(id)?.offered) add('popular', `tool "${id}" is not offered`);
      }
      const usedLimitations = new Set<string>([
        ...registry.conversions.flatMap((c) => c.routes.flatMap((r) => r.limitations)),
        ...registry.tools.flatMap((t) => t.limitations),
      ]);
      for (const id of limitationIds)
        if (!usedLimitations.has(id)) add('limitations', `limitation "${id}" is never used`);
      const usedOptions = new Set<string>([
        ...registry.conversions.flatMap((c) => c.routes.flatMap((r) => r.options.map((o) => o.id))),
        ...registry.tools.flatMap((t) => t.routes.flatMap((r) => r.options.map((o) => o.id))),
      ]);
      for (const option of catalog.options) {
        if (!usedOptions.has(option.id)) add('options', `option "${option.id}" is never used`);
      }
    } catch (error) {
      if (error instanceof CatalogCompileError) add('compile', error.message);
      else throw error;
    }
  }

  return { ok: issues.length === 0, issues, catalog: issues.length === 0 ? catalog : null };
}
