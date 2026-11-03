import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import RunPanel from '@/components/RunPanel';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Payroll run' };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const sb = await supabaseServer();
  const { data: run } = await sb.from('payroll_runs').select('*').eq('id', id).maybeSingle(); if (!run) notFound();
  const [lines, inputs, banks] = await Promise.all([sb.from('payroll_lines').select('*').eq('run_id', id).order('emp_no'), sb.from('payroll_inputs').select('*, employees(emp_no, full_name, employment_type)').eq('run_id', id), sb.from('bank_accounts').select('id, name').eq('is_active', true)]);
  return <RunPanel run={run} lines={lines.data ?? []} inputs={inputs.data ?? []} banks={banks.data ?? []} mfa={process.env.REQUIRE_MFA === 'true'} />;
}
