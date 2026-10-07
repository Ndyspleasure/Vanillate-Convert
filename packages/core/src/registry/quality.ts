/**
 * Derives conversion limitations and the quality model from format traits.
 *
 * This keeps the catalog small: a rule does not need to say that PNG → JPG loses
 * transparency, because PNG has the `alpha` trait and JPG does not. Rules only declare
 * limitations that cannot be derived (e.g. "first sheet only" for spreadsheet → CSV).
 */
import type { Cardinality, MetadataPolicy, Trait } from '../catalog/constants.ts';
import type { Format, Limitation, QualityModel } from './types.ts';

/** Limitation ids produced by `deriveLimitations`; validated to exist in the catalog. */
export const DERIVED_LIMITATION_IDS = [
  'lossy-output',
  'no-quality-restore',
  'transparency-lost',
  'animation-lost',
  'first-page-only',
  'one-file-per-page',
  'rasterized',
  'text-only',
  'audio-only',
  'audio-removed',
  'structure-flattened',
  'colors-reduced',
  'hdr-tone-mapped',
  'styling-lost',
  'metadata-removed',
  'macros-removed',
] as const;

const STRUCTURE_CHANGING = new Set([
  'text-only',
  'structure-flattened',
  'first-page-only',
  'audio-only',
  'layout-may-change',
  'first-sheet-only',
  'animation-lost',
  'styling-lost',
  'macros-removed',
  'timing-removed',
  'pdf-reflow',
  'layers-flattened',
  'mesh-only',
]);

const RESOLUTION_CHANGING = new Set(['rasterized', 'icon-size', 'one-file-per-page']);

interface DeriveContext {
  cardinality: Cardinality;
  metadata: MetadataPolicy;
}

function has(format: Format, trait: Trait): boolean {
  return format.traits.includes(trait);
}

/** Plain text output: text-based but carrying no markup, structure or tabular semantics. */
function isPlainText(format: Format): boolean {
  return (
    has(format, 'text') &&
    !has(format, 'markup') &&
    !has(format, 'richtext') &&
    !has(format, 'structured') &&
    !has(format, 'tabular') &&
    !has(format, 'layout') &&
    !has(format, 'vector') &&
    !has(format, 'model3d') &&
    !has(format, 'cad') &&
    !has(format, 'styled') &&
    !has(format, 'timed')
  );
}

function isPicture(format: Format): boolean {
  return has(format, 'raster') || has(format, 'vector');
}

export function deriveLimitations(from: Format, to: Format, ctx: DeriveContext): string[] {
  const out: string[] = [];
  const add = (id: (typeof DERIVED_LIMITATION_IDS)[number]): void => {
    if (!out.includes(id)) out.push(id);
  };

  // Formats that support both modes (WebP, AVIF...) are encoded lossily unless the user
  // chooses lossless, so they are reported as lossy as well.
  if (has(to, 'lossy')) add('lossy-output');
  if (has(from, 'lossy') && has(to, 'lossless') && !has(to, 'lossy')) {
    if ((has(from, 'audio') && has(to, 'audio')) || (has(from, 'raster') && has(to, 'raster'))) {
      add('no-quality-restore');
    }
  }
  if (isPicture(from) && has(to, 'raster') && has(from, 'alpha') && !has(to, 'alpha')) {
    add('transparency-lost');
  }
  if (has(from, 'animation') && !has(to, 'animation') && !has(to, 'video')) {
    if (ctx.cardinality === '1:1' || ctx.cardinality === 'n:1') add('animation-lost');
  }
  if (has(from, 'multipage') && !has(to, 'multipage')) {
    if (ctx.cardinality === '1:n') add('one-file-per-page');
    else if (isPicture(to)) add('first-page-only');
  }
  if (has(from, 'vector') && has(to, 'raster')) add('rasterized');
  if (
    (has(from, 'richtext') || has(from, 'layout') || has(from, 'markup')) &&
    isPlainText(to) &&
    !has(from, 'structured')
  ) {
    add('text-only');
  }
  if (has(from, 'video') && has(to, 'audio') && !has(to, 'video')) add('audio-only');
  if (
    has(from, 'audio') &&
    has(from, 'video') &&
    !has(to, 'audio') &&
    (has(to, 'video') || has(to, 'animation'))
  ) {
    add('audio-removed');
  }
  if (has(from, 'structured') && has(to, 'tabular')) add('structure-flattened');
  if (has(to, 'palette') && !has(from, 'palette') && (has(from, 'raster') || has(from, 'video'))) {
    add('colors-reduced');
  }
  if (has(from, 'hdr') && !has(to, 'hdr')) add('hdr-tone-mapped');
  if (has(from, 'styled') && !has(to, 'styled')) add('styling-lost');
  if (has(from, 'macro') && !has(to, 'macro')) add('macros-removed');
  if (ctx.metadata === 'strip') add('metadata-removed');
  return out;
}

/** Orders limitation ids: warnings first, otherwise keeping the given order. */
export function sortLimitations(
  ids: readonly string[],
  limitations: ReadonlyMap<string, Limitation>,
): string[] {
  const unique = [...new Set(ids)];
  const weight = (id: string): number => (limitations.get(id)?.severity === 'warning' ? 0 : 1);
  return unique
    .map((id, index) => ({ id, index }))
    .sort((a, b) => weight(a.id) - weight(b.id) || a.index - b.index)
    .map((entry) => entry.id);
}

export function deriveQuality(
  limitationIds: readonly string[],
  metadata: MetadataPolicy,
  imperfect: boolean,
): QualityModel {
  const set = new Set(limitationIds);
  const lossy = set.has('lossy-output');
  const structureChanging = [...set].some((id) => STRUCTURE_CHANGING.has(id));
  const resolutionChanging = [...set].some((id) => RESOLUTION_CHANGING.has(id));
  const potentiallyImperfect =
    imperfect ||
    set.has('layout-may-change') ||
    set.has('pdf-reflow') ||
    set.has('experimental-quality');
  return {
    lossy,
    structureChanging,
    resolutionChanging,
    potentiallyImperfect,
    metadataChanging: metadata !== 'preserve',
    lossless:
      !lossy && !structureChanging && !potentiallyImperfect && !set.has('transparency-lost'),
  };
}
