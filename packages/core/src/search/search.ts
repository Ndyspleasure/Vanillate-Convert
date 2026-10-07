/**
 * Registry search: formats, conversions, tools and categories, in both languages.
 *
 * Understands "heic to jpg", "heic ke jpg", "heic → jpg", "heic jpg", single format names
 * or aliases ("jpeg", "word", "photoshop") and free text matched against localized names.
 * Only offered entries are returned.
 */
import type { Locale } from '../catalog/constants.ts';
import type { Registry } from '../registry/registry.ts';
import type { Category, Conversion, Format, Tool } from '../registry/types.ts';

export type SearchResult =
  | { type: 'conversion'; score: number; conversion: Conversion }
  | { type: 'format'; score: number; format: Format }
  | { type: 'tool'; score: number; tool: Tool }
  | { type: 'category'; score: number; category: Category };

const CONNECTORS = new Set(['to', 'ke', 'into', 'menjadi', 'jadi', '2', '->', '→', '=>']);
const STOP_WORDS = new Set([
  'convert',
  'converter',
  'konversi',
  'ubah',
  'file',
  'files',
  'online',
  'free',
  'gratis',
  'format',
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[→]/g, ' → ')
    .replace(/[^a-z0-9.→\s>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length > 0);
}

function textScore(haystack: string, queryTokens: readonly string[]): number {
  if (queryTokens.length === 0) return 0;
  const hay = normalize(haystack);
  const words = new Set(hay.split(' '));
  let score = 0;
  for (const token of queryTokens) {
    if (words.has(token)) score += 2;
    else if (token.length >= 3 && hay.includes(token)) score += 1;
    else return 0; // every token must match somewhere
  }
  return score / queryTokens.length;
}

export function search(
  query: string,
  registry: Registry,
  locale: Locale,
  limit = 20,
): SearchResult[] {
  const all = tokens(query);
  if (all.length === 0) return [];
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const add = (key: string, result: SearchResult): void => {
    if (seen.has(key)) return;
    seen.add(key);
    results.push(result);
  };

  // "A to B" / "A B": a direct conversion.
  const meaningful = all.filter((t) => !STOP_WORDS.has(t));
  const formatTokens = meaningful.filter((t) => !CONNECTORS.has(t));
  if (formatTokens.length === 2) {
    const from = registry.resolveFormat(formatTokens[0]!);
    const to = registry.resolveFormat(formatTokens[1]!);
    const conversion = from && to ? registry.conversion(from.id, to.id) : undefined;
    if (conversion?.offered)
      add(`c:${conversion.key}`, { type: 'conversion', score: 100, conversion });
  }

  // A single format: the format itself and its most popular conversions.
  if (formatTokens.length === 1) {
    const format = registry.resolveFormat(formatTokens[0]!);
    if (format) {
      add(`f:${format.id}`, { type: 'format', score: 90, format });
      registry
        .conversionsFrom(format.id)
        .slice(0, 6)
        .forEach((conversion, i) =>
          add(`c:${conversion.key}`, { type: 'conversion', score: 80 - i, conversion }),
        );
      registry
        .conversionsTo(format.id)
        .slice(0, 4)
        .forEach((conversion, i) =>
          add(`c:${conversion.key}`, { type: 'conversion', score: 70 - i, conversion }),
        );
    }
  }

  // Free text over tools, formats and categories.
  const textTokens = meaningful.length > 0 ? meaningful : all;
  for (const tool of registry.offeredTools()) {
    const score = Math.max(
      textScore(`${tool.name[locale]} ${tool.id.replace(/-/g, ' ')}`, textTokens) * 30,
      textScore(tool.description[locale], textTokens) * 10,
    );
    if (score > 0) add(`t:${tool.id}`, { type: 'tool', score: 40 + score, tool });
  }
  for (const format of registry.formats) {
    if (!format.readable && !format.writable) continue;
    const names = `${format.label} ${format.name.en} ${format.name.id} ${format.aliases.join(' ')} ${format.extensions.join(' ')}`;
    const score = Math.max(
      textScore(names, textTokens) * 25,
      textScore(format.description[locale], textTokens) * 8,
    );
    if (score > 0)
      add(`f:${format.id}`, { type: 'format', score: 30 + score + format.popularity / 20, format });
  }
  for (const category of registry.visibleCategories()) {
    const score =
      textScore(`${category.name.en} ${category.name.id} ${category.id}`, textTokens) * 25;
    if (score > 0) add(`g:${category.id}`, { type: 'category', score: 35 + score, category });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
