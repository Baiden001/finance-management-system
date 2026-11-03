import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { BRANDS } from '../../src/lib/company';
import { REPORTS, rpcArgs, findReport } from '../../src/lib/reports';
import { toCsv, toXlsx, toPdf, payslipPdf, type ExportMeta } from '../../src/lib/export';
import { money, safeCell, monthEnd } from '../../src/lib/format';
import { rateLimit } from '../../src/lib/guards';
import { OPERATIONS } from '../../src/lib/configs';
import { migrationFiles, read } from '../../scripts/lib-migrations.mjs';
import { ICONS, iconKeyFor } from '../../src/lib/icons';

const root = path.resolve(__dirname, '../..');
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const meta: ExportMeta = { legalName: 'Test Co', title: 'Trial Balance', period: 'from: 2026-01-01', currency: 'GHS', generatedAt: '2026-10-30 10:00 UTC', brandColor: '#0F3D2E', accentColor: '#B8913F', logoFile: '/brand/resilience-logo.png' };
const cols = REPORTS[0].cols;
const rows = [{ code: '1010', name: '=HYPERLINK("x")', type: 'asset', opening: 0, debit: 1234.5, credit: 0, closing: 1234.5 }];

describe('branding', () => {
  it('uses the supplied logos and the specified palettes', () => {
    for (const b of Object.values(BRANDS)) expect(fs.existsSync(path.join(root, 'public', b.logo))).toBe(true);
    expect(BRANDS.resilience.colors.brand.toLowerCase()).toMatch(/^#0f3d2e$/); expect(BRANDS.resilience.colors.accent.toLowerCase()).toMatch(/^#b8913f$/);
    expect(BRANDS.ashelite.colors.brand.toLowerCase()).toMatch(/^#6b0f2a$/);
  });
  it('shows company-specific navigation only', () => {
    expect(BRANDS.resilience.nav.map((n) => n.label)).toContain('Properties & Sales');
    expect(BRANDS.resilience.nav.map((n) => n.label)).not.toContain('Production');
    expect(BRANDS.ashelite.nav.map((n) => n.label)).toContain('Production');
    for (const b of Object.values(BRANDS)) for (const n of b.nav.filter((x) => x.href.startsWith('/operations/'))) expect(OPERATIONS[n.href.split('/')[2]]?.company).toBe(b.code);
  });
});

describe('report registry', () => {
  it('every report maps to a real SQL function in that company\'s migrations, with matching parameters', () => {
    for (const company of ['resilience', 'ashelite'] as const) {
      const sql = migrationFiles(company).map((m: { file: string }) => read(m.file)).join('\n');
      for (const r of REPORTS.filter((x) => !x.company || x.company === company)) {
        const m = sql.match(new RegExp(`function public\\.${r.rpc}\\(([^)]*)\\)`));
        expect(m, `${r.rpc} missing for ${company}`).toBeTruthy();
        const names = (m![1].match(/p_\w+/g) ?? []);
        const expected = Object.keys(rpcArgs(r, Object.fromEntries(r.params.map((p) => [p, '1'])) as Record<string, string>));
        expect(new Set(names)).toEqual(new Set(expected));
      }
    }
  });
  it('company-only reports do not leak into the other company', () => {
    const sqlA = migrationFiles('resilience').map((m: { file: string }) => read(m.file)).join('\n');
    expect(sqlA).not.toContain('rpt_cost_per_block');
    expect(REPORTS.filter((r) => r.company === 'ashelite').every((r) => !sqlA.includes(r.rpc))).toBe(true);
  });
  it('payroll reports are flagged sensitive; keys are unique; bad params rejected', () => {
    expect(REPORTS.filter((r) => r.group === 'Payroll').every((r) => r.sensitive)).toBe(true);
    expect(new Set(REPORTS.map((r) => r.key)).size).toBe(REPORTS.length);
    expect(() => rpcArgs(findReport('trial_balance')!, { from: '2026-01-01' })).toThrow(/Missing parameter/);
    expect(() => rpcArgs(findReport('payroll_temp_workers')!, { year: 'x', month: '1' })).toThrow(/Invalid number/);
  });
});

describe('exports', () => {
  it('CSV neutralises formula injection and escapes properly', () => {
    const s = toCsv(cols, rows).toString('utf8');
    expect(s.charCodeAt(0)).toBe(0xfeff); expect(s).toContain(`"'=HYPERLINK(""x"")"`); expect(s).toContain('1234.5');
    expect(safeCell('-5')).toBe('-5'); expect(safeCell('+cmd')).toBe("'+cmd"); expect(safeCell(null)).toBeNull();
  });
  it('XLSX is a valid workbook with branded header, numeric amounts and formula guard', async () => {
    const buf = await toXlsx(meta, cols, rows); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; expect(ws.getCell('A1').value).toBe('Test Co'); expect(ws.getCell('A2').value).toBe('Trial Balance');
    expect(ws.getCell('B6').value).toBe("'=HYPERLINK(\"x\")"); expect(ws.getCell('E6').value).toBe(1234.5);
  });
  it('PDF reports and payslips are valid PDFs', async () => {
    const pdf = await toPdf(meta, cols, Array.from({ length: 80 }, () => rows[0]));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-'); expect(pdf.length).toBeGreaterThan(3000);
    const slip = await payslipPdf({ ...meta, restricted: true }, { company: { name: 'Test', legal_name: 'Test Co', currency: 'GHS' }, period: '2026-01', compliance_applied: false, net_pay: 5680, employer_pension: 0,
      employee: { emp_no: 'E001', name: 'Ama Owusu', type: 'permanent', payment_method: 'bank' }, earnings: { basic: 5000, allowances: 500, overtime: 0, bonus: 200, commission: 0, other: 0, gross: 5700 }, deductions: { paye: 0, employee_pension: 0, other: 20, advances: 0, total: 20 } });
    expect(slip.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('helpers', () => {
  it('formats money, month ends', () => { expect(money(1234.5)).toBe('GHS 1,234.50'); expect(monthEnd(2026, 2)).toBe('2026-02-28'); expect(monthEnd(2028, 2)).toBe('2028-02-29'); });
  it('rate limiter blocks after the limit', () => { for (let i = 0; i < 3; i++) expect(rateLimit('k', 3, 1000)).toBe(true); expect(rateLimit('k', 3, 1000)).toBe(false); });
});

describe('security hygiene', () => {
  it('never references the service-role key or secrets in application source', () => {
    for (const f of walk(path.join(root, 'src')).filter((x) => /\.(ts|tsx)$/.test(x))) {
      const s = fs.readFileSync(f, 'utf8'); expect(/service_role|SERVICE_ROLE/i.test(s), f).toBe(false);
    }
  });
  it('env examples hold placeholders only and each targets exactly one company', () => {
    for (const [f, code] of [['.env.resilience.example', 'resilience'], ['.env.ashelite.example', 'ashelite']] as const) {
      const s = fs.readFileSync(path.join(root, f), 'utf8'); expect(s).toContain(`NEXT_PUBLIC_COMPANY=${code}`); expect(s).toMatch(/your-.*-anon-key/); expect(s).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
      expect(s.split('\n').filter((l) => /^SUPABASE_(SERVICE|DB)/.test(l))).toHaveLength(0);   // admin secrets are commented out
    }
  });
  it('every migrated table enables RLS and no table is readable by anon', () => {
    for (const company of ['resilience', 'ashelite'] as const) {
      const sql = migrationFiles(company).map((m: { file: string }) => read(m.file)).join('\n');
      const created = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
      const secured = new Set([...sql.matchAll(/_secure_tables\(array\[([^\]]+)\]\)/g)].flatMap((m) => m[1].match(/'(\w+)'/g)!.map((s) => s.replace(/'/g, ''))));
      for (const t of created) expect(secured.has(t) || t === 'audit_log', `${t} not secured in ${company}`).toBe(true);
    }
  });
  it('migrations never reference a company_id column', () => {
    for (const company of ['resilience', 'ashelite'] as const) expect(migrationFiles(company).map((m: { file: string }) => read(m.file)).join('\n')).not.toMatch(/company_id/);
  });
});

describe('statement exports', () => {
  it('styles totals/indents and drops the comparative column when none was requested', async () => {
    const scols = [{ key: 'label', label: 'Line', type: 'text' as const }, { key: 'code', label: 'Code', type: 'text' as const }, { key: 'amount', label: 'Current', type: 'money' as const }, { key: 'compare_amount', label: 'Comparative', type: 'money' as const }];
    const srows = [{ line_type: 'account', depth: 2, label: 'Property Inventory (Development in Progress)', code: '1200', amount: 100, compare_amount: null }, { line_type: 'total', depth: 0, label: 'Total assets', code: null, amount: 100, compare_amount: null }];
    const csv = toCsv(scols, srows).toString('utf8'); expect(csv).not.toContain('Comparative'); expect(csv).toContain('Total assets');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await toXlsx({ ...meta, notes: 'Prepared under IFRS for SMEs.' }, scols, srows)) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; expect(ws.getRow(5).values).not.toContain('Comparative'); expect(ws.getCell('A7').font?.bold).toBe(true); expect(ws.getCell('A6').alignment?.indent).toBe(2);
    expect(JSON.stringify(ws.getRow(9).values)).toContain('Notes');
    expect((await toPdf({ ...meta, notes: 'Prepared under IFRS for SMEs.' }, scols, srows)).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('menu icons', () => {
  it('every navigation item of both companies has a dedicated icon', () => {
    for (const b of Object.values(BRANDS)) for (const n of b.nav) { const k = iconKeyFor(n.href); expect(k, `${b.code} ${n.href}`).not.toBe('dot'); expect(ICONS[k]).toBeTruthy(); }
  });
  it('icon markup is static shapes only (no scripts or event handlers)', () => {
    for (const [k, v] of Object.entries(ICONS)) { expect(v, k).not.toMatch(/<script|on\w+=|href=/i); expect(v.replace(/<(path|circle|rect)\b[^>]*\/>/g, '')).toBe(''); }
  });
});
