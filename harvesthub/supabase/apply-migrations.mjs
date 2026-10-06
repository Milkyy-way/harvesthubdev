#!/usr/bin/env node
// Applies supabase/migrations/*.sql to a Postgres database, in order, each
// file in its own transaction (stops at the first error). Every migration
// is written to be safe to re-run, so running this again is harmless.
//
// Seed files (sample farms and products for development) are SKIPPED
// unless you pass --include-seed. Never seed the production project: fake
// farms would show up for real customers.
//
// Usage (from the harvesthub/ folder):
//   node supabase/apply-migrations.mjs "<connection string>"
//   node supabase/apply-migrations.mjs "<connection string>" --from 0027   # only 0027 and later
//
// The connection string is in Supabase -> Project Settings -> Database ->
// Connection string ("Session pooler" URI, with your database password).
// Needs psql (installed with PostgreSQL). Set PSQL=<path to psql> if it
// isn't on your PATH and isn't in C:\Program Files\PostgreSQL\<version>\bin.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED_FILES = new Set(['0010_seed_sample_farmers_and_products.sql']);

const args = process.argv.slice(2);
const connection = args.find((a) => !a.startsWith('--') && !/^\d{4}$/.test(a)) ?? process.env.DATABASE_URL;
const includeSeed = args.includes('--include-seed');
const fromIndex = args.indexOf('--from');
const from = fromIndex >= 0 ? args[fromIndex + 1] : '0000';

if (!connection) {
  console.error('Pass the database connection string (or set DATABASE_URL). See the comment at the top of this file.');
  process.exit(1);
}

function findPsql() {
  if (process.env.PSQL) return process.env.PSQL;
  if (spawnSync('psql', ['--version']).status === 0) return 'psql';
  const root = 'C:\\Program Files\\PostgreSQL';
  if (existsSync(root)) {
    const versions = readdirSync(root).filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      const candidate = join(root, v, 'bin', 'psql.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  console.error('psql not found. Install PostgreSQL (for its command-line tools) or set PSQL=<path to psql>.');
  process.exit(1);
}

const psql = findPsql();
const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const files = readdirSync(dir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) >= from)
  .sort();

for (const file of files) {
  if (SEED_FILES.has(file) && !includeSeed) {
    console.log(`skip  ${file} (seed data; --include-seed to apply)`);
    continue;
  }
  process.stdout.write(`apply ${file} ... `);
  const result = spawnSync(psql, [connection, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-1', '-f', join(dir, file)], {
    encoding: 'utf8',
    env: { ...process.env, PGOPTIONS: '--client-min-messages=warning' },
  });
  if (result.status !== 0) {
    console.log('FAILED');
    console.error(result.stderr || result.stdout || result.error?.message);
    console.error(`\nStopped at ${file}; nothing from this file was applied. Fix the problem and re-run (earlier files are safe to re-apply).`);
    process.exit(1);
  }
  console.log('ok');
}
console.log(`\nDone: ${files.length} file(s) checked.`);
