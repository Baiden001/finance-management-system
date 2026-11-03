#!/usr/bin/env node
// Creates the accountant login for ONE company's project (service-role key used here only, never in the web app).
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ACCOUNTANT_EMAIL=... ACCOUNTANT_PASSWORD=... node scripts/create-accountant.mjs <company> "Full Name"
import { createClient } from '@supabase/supabase-js';
const [company, fullName = 'Accountant'] = process.argv.slice(2);
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ACCOUNTANT_EMAIL, ACCOUNTANT_PASSWORD } = process.env;
if (!['resilience', 'ashelite'].includes(company) || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ACCOUNTANT_EMAIL || !ACCOUNTANT_PASSWORD) { console.error('Usage: see header of scripts/create-accountant.mjs (all four env vars are required).'); process.exit(2); }
if (ACCOUNTANT_PASSWORD.length < 12) { console.error('Use a password of at least 12 characters, unique to this company.'); process.exit(2); }
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: cs, error: e0 } = await admin.from('company_settings').select('company_code').limit(1).single();
if (e0 || cs?.company_code !== company) { console.error(`This Supabase project is not the ${company} database (${e0?.message ?? `found ${cs?.company_code}`}). Nothing created.`); process.exit(1); }
const { data, error } = await admin.auth.admin.createUser({ email: ACCOUNTANT_EMAIL, password: ACCOUNTANT_PASSWORD, email_confirm: true });
if (error) { console.error('Could not create user:', error.message); process.exit(1); }
const p = await admin.from('profiles').insert({ id: data.user.id, full_name: fullName, role: 'accountant' });
if (p.error) { console.error('User created but profile failed:', p.error.message); process.exit(1); }
console.log(`Accountant created for ${company}: ${ACCOUNTANT_EMAIL}. Sign in, then enrol an authenticator app at /security/mfa.`);
