/**
 * Applies pending PostgreSQL migrations: `pnpm db:migrate`, or
 * `node packages/jobs/src/cli/migrate.ts` in the worker image (needs DATABASE_URL).
 * Safe to run on every deploy: applied migrations are recorded and skipped.
 */
import { migrate } from '../postgres.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const applied = await migrate(url);
process.stdout.write(
  applied.length > 0 ? `applied ${applied.join(', ')}\n` : 'database is up to date\n',
);
