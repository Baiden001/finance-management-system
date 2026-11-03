#!/usr/bin/env node
// LIVE isolation check against the two real Supabase projects. Requires both projects, seeded, with one accountant each.
// Env: RES_URL RES_ANON RES_EMAIL RES_PASSWORD  ASH_URL ASH_ANON ASH_EMAIL ASH_PASSWORD
import { createClient } from '@supabase/supabase-js';
const e = process.env; const need = ['RES_URL','RES_ANON','RES_EMAIL','RES_PASSWORD','ASH_URL','ASH_ANON','ASH_EMAIL','ASH_PASSWORD'];
const miss = need.filter((k) => !e[k]); if (miss.length) { console.error('Missing env: ' + miss.join(', ')); process.exit(2); }
let failed = 0; const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };
const mk = (u, k) => createClient(u, k, { auth: { persistSession: false } });
const res = mk(e.RES_URL, e.RES_ANON), ash = mk(e.ASH_URL, e.ASH_ANON);
const a = await res.auth.signInWithPassword({ email: e.RES_EMAIL, password: e.RES_PASSWORD }); check('Resilience accountant can sign in to Resilience', !a.error);
const b = await ash.auth.signInWithPassword({ email: e.ASH_EMAIL, password: e.ASH_PASSWORD }); check('Ash Elite accountant can sign in to Ash Elite', !b.error);
check('Resilience credentials are rejected by Ash Elite', !!(await mk(e.ASH_URL, e.ASH_ANON).auth.signInWithPassword({ email: e.RES_EMAIL, password: e.RES_PASSWORD })).error);
check('Ash Elite credentials are rejected by Resilience', !!(await mk(e.RES_URL, e.RES_ANON).auth.signInWithPassword({ email: e.ASH_EMAIL, password: e.ASH_PASSWORD })).error);
const codeA = (await res.from('company_settings').select('company_code').single()).data?.company_code, codeB = (await ash.from('company_settings').select('company_code').single()).data?.company_code;
check('Resilience project is bound to resilience', codeA === 'resilience', codeA); check('Ash Elite project is bound to ashelite', codeB === 'ashelite', codeB);
// A token minted by project A must not work against project B
const tokenA = a.data.session?.access_token; const cross = createClient(e.ASH_URL, e.ASH_ANON, { global: { headers: { Authorization: `Bearer ${tokenA}` } }, auth: { persistSession: false } });
const r = await cross.from('journals').select('id').limit(1); check('Resilience session token cannot read Ash Elite data', !!r.error || (r.data ?? []).length === 0, r.error?.message ?? 'no rows');
const anon = await mk(e.RES_URL, e.RES_ANON).from('journals').select('id').limit(1); check('Anonymous cannot read ledger', !!anon.error || (anon.data ?? []).length === 0);
const sa = await res.storage.from('documents').list(''); check('Documents bucket is not public', !(await fetch(`${e.RES_URL}/storage/v1/object/public/documents/x`)).ok);
void sa; console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll isolation checks passed'); process.exit(failed ? 1 : 0);
