// Shared helpers: ordered migration list per company, seed list.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const COMPANIES = ['resilience', 'ashelite'];
export function migrationFiles(company) {
  if (!COMPANIES.includes(company)) throw new Error(`Unknown company "${company}" (expected ${COMPANIES.join(' | ')})`);
  const dir = (d) => fs.readdirSync(path.join(root, 'supabase/migrations', d)).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ name: `${d}/${f}`, file: path.join(root, 'supabase/migrations', d, f) }));
  return [...dir('common'), ...dir(company)];
}
export function seedFiles(company) {
  return [path.join(root, 'supabase/seed', `${company}.sql`), path.join(root, 'supabase/seed/common.sql')];
}
export const read = (f) => fs.readFileSync(f, 'utf8');
export { root };
