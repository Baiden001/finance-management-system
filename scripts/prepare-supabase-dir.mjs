#!/usr/bin/env node
// Builds build/<company>/supabase/ (migrations with CLI-style timestamps, seed.sql, config.toml) so the Supabase CLI can be used:
//   node scripts/prepare-supabase-dir.mjs resilience && cd build/resilience && supabase link --project-ref <REF> && supabase db push
import fs from 'node:fs'; import path from 'node:path';
import { migrationFiles, seedFiles, read, root, COMPANIES } from './lib-migrations.mjs';
const company = process.argv[2];
if (!COMPANIES.includes(company)) { console.error(`Usage: node scripts/prepare-supabase-dir.mjs <${COMPANIES.join('|')}>`); process.exit(2); }
const out = path.join(root, 'build', company, 'supabase'); fs.rmSync(path.join(root, 'build', company), { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'migrations'), { recursive: true });
migrationFiles(company).forEach((f, i) => fs.writeFileSync(path.join(out, 'migrations', `${String(20260101000000 + i)}_${f.name.split('/')[1].replace(/\.sql$/, '')}.sql`), read(f.file)));
fs.writeFileSync(path.join(out, 'seed.sql'), seedFiles(company).map((f) => read(f)).join('\n\n'));
fs.writeFileSync(path.join(out, 'config.toml'), read(path.join(root, 'supabase', 'config.toml')).replace('project_id = "finance-management"', `project_id = "fms-${company}"`));
console.log(`Prepared ${path.relative(root, out)} (${fs.readdirSync(path.join(out, 'migrations')).length} migrations)`);
