'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { isoDate, num } from '@/lib/format';

type R = Record<string, any>;
const INPUT_FIELDS = [['days_worked', 'Days'], ['hours_worked', 'Hours'], ['shifts_worked', 'Shifts'], ['units_completed', 'Units'], ['overtime_amount', 'Overtime'], ['bonus', 'Bonus'], ['commission', 'Commission'], ['other_earnings', 'Other earn.'], ['other_deductions', 'Other ded.'], ['advance_repayment', 'Advance repay']] as const;

export default function RunPanel({ run, lines, inputs, banks, mfa }: { run: R; lines: R[]; inputs: R[]; banks: R[]; mfa: boolean }) {
  const router = useRouter(); const sb = supabaseBrowser();
  const [msg, setMsg] = useState<{ k: 'ok' | 'err'; t: string } | null>(null); const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Record<string, R>>({}); const [ack, setAck] = useState(false); const [bank, setBank] = useState(banks[0]?.id ?? ''); const [payDate, setPayDate] = useState(isoDate()); const [reason, setReason] = useState('');
  const editable = ['draft', 'calculated'].includes(run.status);
  const call = async (label: string, fn: () => PromiseLike<{ error: { message: string } | null }>) => { setBusy(true); setMsg(null); const { error } = await fn(); setBusy(false); setMsg(error ? { k: 'err', t: error.message } : { k: 'ok', t: `${label}: done.` }); router.refresh(); };
  const exceptions: R[] = lines.flatMap((l) => (l.exceptions as R[]).map((e) => ({ ...e, emp: `${l.emp_no} ${l.full_name}` })));
  const errs = exceptions.filter((e) => e.severity === 'error').length; const unver = exceptions.some((e) => e.code === 'statutory_rule_unverified');
  const tot = (k: string) => lines.reduce((s, l) => s + Number(l[k] ?? 0), 0);
  const rep = (k: string, f: string, extra = '') => `/api/export?report=${k}&format=${f}&run=${run.id}${extra}`;
  async function saveInputs() {
    const updates = Object.entries(edit); if (!updates.length) return;
    await call('Inputs saved', async () => { for (const [id, v] of updates) { const { error } = await sb.from('payroll_inputs').update(v).eq('id', id); if (error) return { error }; } setEdit({}); return { error: null }; });
  }
  return (
    <div className="grid">
      <div className="spread"><div><Link href="/payroll">Payroll</Link><h1>Payroll {run.period_year}-{String(run.period_month).padStart(2, '0')} ({run.kind} #{run.seq})</h1>
        <span className={`pill ${run.status}`}>{run.status}</span> {run.ghana_compliance_applied === true && <span className="pill active">Ghana compliance applied</span>} {run.ghana_compliance_applied === false && <span className="pill draft">Ghana compliance not applied</span>}</div></div>
      {msg && <div className={`alert ${msg.k}`} role={msg.k === 'err' ? 'alert' : 'status'}>{msg.t}</div>}
      {run.ghana_compliance_applied === false && <div className="alert warn">Ghana PAYE and SSNIT were not applied automatically. Turning the setting off does not remove the company&rsquo;s legal obligations.</div>}

      {editable && (
        <div className="card"><h2>1. Variable pay and attendance (approve before calculating)</h2>
          <div className="tablewrap"><table><thead><tr><th>Employee</th>{INPUT_FIELDS.map(([, l]) => <th key={l} className="r">{l}</th>)}<th>Approved</th></tr></thead><tbody>
            {inputs.map((i) => { const e = edit[i.id] ?? {}; const v = (k: string) => (k in e ? e[k] : i[k]); return (
              <tr key={i.id}><td>{i.employees.emp_no} {i.employees.full_name}<div className="muted" style={{ fontSize: 11 }}>{i.employees.employment_type}</div></td>
                {INPUT_FIELDS.map(([k, l]) => <td key={k}><input aria-label={`${l} for ${i.employees.full_name}`} className="r" style={{ width: 84 }} type="number" step="any" value={v(k)} onChange={(ev) => setEdit({ ...edit, [i.id]: { ...e, [k]: Number(ev.target.value) } })} /></td>)}
                <td><input type="checkbox" aria-label={`Approved for ${i.employees.full_name}`} checked={!!v('approved')} onChange={(ev) => setEdit({ ...edit, [i.id]: { ...e, approved: ev.target.checked } })} /></td></tr>); })}
          </tbody></table></div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn alt" disabled={busy || !Object.keys(edit).length} onClick={saveInputs}>Save inputs</button><button className="btn" disabled={busy || Object.keys(edit).length > 0} onClick={() => call('Calculated', () => sb.rpc('payroll_calculate', { p_run: run.id }))}>{run.status === 'calculated' ? 'Recalculate' : 'Calculate'}</button>{Object.keys(edit).length > 0 && <span className="muted">Save inputs before calculating.</span>}</div></div>
      )}

      {lines.length > 0 && <>
        <div className="card"><h2>2. Review</h2>
          <div className="grid kpis"><div className="kpi"><div className="label">Gross</div><div className="value">{num(tot('gross_pay'))}</div></div><div className="kpi"><div className="label">PAYE</div><div className="value">{num(tot('paye'))}</div></div><div className="kpi"><div className="label">Pension (employee + employer)</div><div className="value">{num(tot('employee_pension') + tot('employer_pension'))}</div></div><div className="kpi"><div className="label">Net pay</div><div className="value">{num(tot('net_pay'))}</div></div><div className="kpi"><div className="label">Employer cost</div><div className="value">{num(tot('employer_cost'))}</div></div></div>
          {exceptions.length > 0 && <div style={{ marginTop: 12 }}><h2>Exceptions</h2><ul>{exceptions.map((e, i) => <li key={i}><span className={`pill ${e.severity === 'error' ? 'failed' : 'draft'}`}>{e.severity}</span> {e.emp}: {e.message}</li>)}</ul></div>}
        </div>
        <div className="tablewrap"><table><thead><tr><th>Employee</th><th>Basis</th><th className="r">Gross</th><th className="r">PAYE</th><th className="r">Emp. pension</th><th className="r">Other ded.</th><th className="r">Net</th><th className="r">Employer cost</th><th>Payment</th><th /></tr></thead><tbody>
          {lines.map((l) => <PayRow key={l.id} l={l} run={run} busy={busy} call={call} sb={sb} />)}
        </tbody></table></div>
      </>}

      <div className="card"><h2>3. Finalize, post and pay</h2>
        <div className="row">
          {run.status === 'calculated' && <>{unver && <label className="row"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I acknowledge the statutory rules are not yet verified against official guidance</label>}<button className="btn" disabled={busy || errs > 0 || (unver && !ack)} onClick={() => call('Finalized', () => sb.rpc('payroll_finalize', { p_run: run.id, p_ack_unverified: ack }))}>Finalize and lock</button>{errs > 0 && <span className="alert err" style={{ margin: 0 }}>{errs} blocking exception(s)</span>}</>}
          {run.status === 'finalized' && <button className="btn" disabled={busy} onClick={() => call('Journal posted', () => sb.rpc('payroll_post_journal', { p_run: run.id }))}>Post payroll journal</button>}
          {run.status === 'posted' && <><label className="f">Pay from<select value={bank} onChange={(e) => setBank(e.target.value)}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label className="f">Date<input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></label><button className="btn gold" disabled={busy} onClick={() => call('Payments posted', () => sb.rpc('payroll_post_payments', { p_run: run.id, p_bank_account: bank, p_date: payDate }))}>Post payments marked paid</button></>}
        </div>
        {['finalized', 'posted'].includes(run.status) && <div className="row" style={{ marginTop: 12 }}><label className="f" style={{ flex: 1 }}>Reason for reversal<input value={reason} onChange={(e) => setReason(e.target.value)} /></label><button className="btn danger" disabled={busy || !reason} onClick={() => window.confirm('Reverse this run? Its journals are reversed and the run is marked reversed.') && call('Reversed', () => sb.rpc('payroll_reverse', { p_run: run.id, p_date: isoDate(), p_reason: reason }))}>Reverse run</button></div>}
        {run.status === 'reversed' && <div className="alert warn">Reversed: {run.reversal_reason}. Create a new run or a supplementary run to restate pay.</div>}
      </div>

      {lines.length > 0 && <div className="card"><h2>4. Reports (restricted; exports are audited{mfa ? '; MFA required' : ''})</h2>
        <div className="row">{[['payroll_register', 'Register'], ['payroll_net_list', 'Net salary list'], ['payroll_bank_schedule', 'Bank schedule'], ['payroll_momo_schedule', 'Mobile money schedule'], ['payroll_employer_cost', 'Employer cost'], ['payroll_failed_payments', 'Failed payments'], ['payroll_ledger_reconciliation', 'Ledger reconciliation'], ...(run.ghana_compliance_applied ? [['payroll_statutory', 'Statutory schedule']] : [])].map(([k, l]) => (
          <span key={k} className="row" style={{ gap: 4 }}><b style={{ fontSize: 12 }}>{l}</b>{['pdf', 'xlsx', 'csv'].map((f) => <a key={f} className="btn alt sm" href={rep(k, f)}>{f}</a>)}</span>))}</div></div>}
    </div>
  );
}

function PayRow({ l, run, busy, call, sb }: { l: R; run: R; busy: boolean; call: (label: string, fn: () => PromiseLike<{ error: { message: string } | null }>) => Promise<void>; sb: ReturnType<typeof supabaseBrowser> }) {
  const [ref, setRef] = useState(l.payment_reference ?? '');
  const canPay = ['finalized', 'posted'].includes(run.status) && !l.payment_posted;
  return (
    <tr><td>{l.emp_no} {l.full_name}<div className="muted" style={{ fontSize: 11 }}>{l.employment_type}</div></td><td>{l.pay_basis}</td><td className="r">{num(l.gross_pay)}</td><td className="r">{num(l.paye)}</td><td className="r">{num(l.employee_pension)}</td><td className="r">{num(l.other_deductions)}</td><td className="r"><b>{num(l.net_pay)}</b></td><td className="r">{num(l.employer_cost)}</td>
      <td>{canPay ? <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><input aria-label="Payment reference" placeholder="Reference" style={{ width: 110 }} value={ref} onChange={(e) => setRef(e.target.value)} /><button className="btn sm" disabled={busy || !ref} onClick={() => call('Marked paid', () => sb.rpc('payroll_record_payment', { p_line: l.id, p_status: 'paid', p_reference: ref }))}>Paid</button><button className="btn danger sm" disabled={busy} onClick={() => call('Marked failed', () => sb.rpc('payroll_record_payment', { p_line: l.id, p_status: 'failed', p_reference: ref || 'failed' }))}>Failed</button></span> : <span className={`pill ${l.payment_status}`}>{l.payment_status}{l.payment_posted ? ' (posted)' : ''}</span>}</td>
      <td>{['finalized', 'posted'].includes(run.status) && <a className="btn alt sm" href={`/api/payslip?line=${l.id}`}>Payslip</a>}</td></tr>
  );
}
