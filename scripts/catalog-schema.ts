/**
 * Generates JSON Schema files from the zod catalog schemas so editors can validate and
 * autocomplete catalog JSON (`"$schema": "../schema/formats.schema.json"`).
 *
 *   pnpm catalog:schema            write files
 *   pnpm catalog:schema --check    fail if files are out of date (CI)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  categoriesFileSchema,
  engineFileSchema,
  formatsFileSchema,
  limitationsFileSchema,
  limitsFileSchema,
  optionsFileSchema,
  popularFileSchema,
  rulesFileSchema,
  toolsFileSchema,
} from '@vanillate/core/schema';
import { z } from 'zod';

const outDir = join(import.meta.dirname, '..', 'catalog', 'schema');
const check = process.argv.includes('--check');

const schemas: Record<string, z.ZodType> = {
  'categories.schema.json': categoriesFileSchema,
  'formats.schema.json': formatsFileSchema,
  'engine.schema.json': engineFileSchema,
  'options.schema.json': optionsFileSchema,
  'limitations.schema.json': limitationsFileSchema,
  'rules.schema.json': rulesFileSchema,
  'tools.schema.json': toolsFileSchema,
  'limits.schema.json': limitsFileSchema,
  'popular.schema.json': popularFileSchema,
};

mkdirSync(outDir, { recursive: true });
let stale = false;
for (const [file, schema] of Object.entries(schemas)) {
  const json = `${JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }), null, 2)}\n`;
  const path = join(outDir, file);
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== json) {
      console.error(`✗ catalog/schema/${file} is out of date — run pnpm catalog:schema`);
      stale = true;
    }
  } else {
    writeFileSync(path, json);
    console.log(`wrote catalog/schema/${file}`);
  }
}
process.exit(stale ? 1 : 0);
