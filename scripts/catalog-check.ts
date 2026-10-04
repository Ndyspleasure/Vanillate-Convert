/**
 * Validates the catalog (schema, references, expansion) and checks that every JSON file on
 * disk is aggregated by `catalog/index.ts`. Exits non-zero on any issue.
 *
 *   pnpm catalog:check
 */
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { CATALOG_FILES } from '@vanillate/catalog';
import { catalog, getRegistry } from '@vanillate/core';
import { validateCatalog } from '@vanillate/core/validate';

const root = join(import.meta.dirname, '..', 'catalog');

function listJson(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'schema' ? [] : listJson(path);
    return entry.name.endsWith('.json') && !['package.json', 'tsconfig.json'].includes(entry.name)
      ? [relative(root, path)]
      : [];
  });
}

let failed = false;
const onDisk = listJson(root).sort();
const listed = new Set<string>(CATALOG_FILES);
for (const file of onDisk) {
  if (!listed.has(file)) {
    console.error(`✗ catalog/${file} exists but is not imported by catalog/index.ts`);
    failed = true;
  }
}
for (const file of listed) {
  if (!onDisk.includes(file)) {
    console.error(`✗ catalog/index.ts lists ${file}, which does not exist`);
    failed = true;
  }
}

const result = validateCatalog(catalog);
for (const issue of result.issues) console.error(`✗ ${issue.path}: ${issue.message}`);
failed ||= !result.ok;

if (!failed) {
  const registry = getRegistry();
  const browserOnly = getRegistry({ disabledModes: ['server'] });
  console.log(
    `✓ catalog valid: ${registry.formats.length} formats, ${registry.engines.length} engines, ` +
      `${registry.conversions.length} conversions (${registry.indexableConversions().length} indexable), ` +
      `${registry.tools.length} tools; browser-only deployment offers ` +
      `${browserOnly.offeredConversions().length} conversions and ${browserOnly.offeredTools().length} tools.`,
  );
}
process.exit(failed ? 1 : 0);
