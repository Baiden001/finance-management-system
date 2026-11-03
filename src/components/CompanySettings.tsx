'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

type S = { legal_name: string; display_name: string; tin: string | null; address: string | null; phone: string | null; email: string | null; ghana_payroll_compliance: boolean; base_currency: string; company_code: string; ghana_compliance_changed_at: string | null };
export default function CompanySettings({ initial }: { initial: S }) {
  const r = useRouter(); const [s, setS] = useState(initial); const [msg, setMsg] = useState<{ k: 'ok' | 'err'; t: string } | null>(null); const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (s.ghana_payroll_compliance !== initial.ghana_payroll_compliance && !window.confirm(s.ghana_payroll_compliance ? 'Enable Ghana payroll compliance? New payroll runs will apply effective-dated PAYE and SSNIT rules. Verify the rules against official guidance first.' : 'Disable Ghana payroll compliance? PAYE and pension will no longer be applied automatically. This does not remove the company\'s legal obligations. Finalized payroll is not changed.')) return;
    setBusy(true); const { error } = await supabaseBrowser().from('company_settings').update({ legal_name: s.legal_name, display_name: s.display_name, tin: s.tin, address: s.address, phone: s.phone, email: s.email, ghana_payroll_compliance: s.ghana_payroll_compliance }).eq('id', true);
    setBusy(false); setMsg(error ? { k: 'err', t: error.message } : { k: 'ok', t: 'Settings saved.' }); r.refresh();
  }
  const t = (k: keyof S, label: string) => <label className="f">{label}<input value={String(s[k] ?? '')} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></label>;
  return (
    <form className="card" onSubmit={save} style={{ display: 'grid', gap: 14 }}>
      <h2>Company details</h2>
      <div className="form">{t('legal_name', 'Legal name')}{t('display_name', 'Display name')}{t('tin', 'TIN')}{t('address', 'Address')}{t('phone', 'Phone')}{t('email', 'Email')}
        <label className="f">Base currency<input value={s.base_currency} disabled /></label><label className="f">Company database<input value={s.company_code} disabled /></label></div>
      <div className="card" style={{ background: '#faf9f4' }}>
        <h2>Ghana payroll compliance</h2>
        <label className="row"><input type="checkbox" checked={s.ghana_payroll_compliance} onChange={(e) => setS({ ...s, ghana_payroll_compliance: e.target.checked })} /> Apply Ghana PAYE and SSNIT / pension rules to payroll runs</label>
        <p>Status: <span className={`pill ${s.ghana_payroll_compliance ? 'active' : 'draft'}`}>{s.ghana_payroll_compliance ? 'Enabled' : 'Disabled'}</span>{s.ghana_compliance_changed_at && <span className="muted"> (last changed {s.ghana_compliance_changed_at.slice(0, 10)})</span>}</p>
        <div className="alert warn">Disabling this does not remove legal obligations. Rates are configurable, effective-dated rule versions (Payroll &gt; Statutory rules); the shipped values are placeholders until you verify them against official GRA and SSNIT guidance. Finalized payroll is never recalculated when rules change. This system does not file returns or make payments electronically.</div>
      </div>
      {msg && <div className={`alert ${msg.k}`} role={msg.k === 'err' ? 'alert' : 'status'}>{msg.t}</div>}
      <div><button className="btn" disabled={busy}>Save settings</button></div>
    </form>
  );
}
