import JournalForm from '@/components/JournalForm';
import ResourcePage from '@/components/ResourcePage';
import RunRecurring from '@/components/RunRecurring';
import { recurring } from '@/lib/configs';
import type { ResourceConfig } from '@/components/types';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Transactions' };
const cfg: ResourceConfig = { title: 'Journal entries', table: 'journals', order: 'journal_no', limit: 200,
  columns: [{ key: 'journal_no', label: 'JE #' }, { key: 'entry_date', label: 'Date', format: 'date' }, { key: 'description', label: 'Description' }, { key: 'reference', label: 'Reference' }, { key: 'source_type', label: 'Source' }, { key: 'status', label: 'Status', format: 'pill' }],
  actions: [{ label: 'Make recurring', rpc: 'recurring_from_journal', args: { p_journal: '$id', p_name: '$prompt.name', p_frequency: '$prompt.frequency', p_next_run: '$prompt.next_run' }, variant: 'alt', when: { field: 'status', in: ['posted'] },
    prompts: [{ name: 'name', label: 'Name', required: true }, { name: 'frequency', label: 'Frequency', type: 'select', required: true, default: 'monthly', options: ['monthly', 'quarterly', 'yearly'].map((v) => ({ value: v, label: v })) }, { name: 'next_run', label: 'First run date', type: 'date', required: true }] },
    { label: 'Post', rpc: 'post_journal', args: { p_id: '$id' }, when: { field: 'status', in: ['draft'] } },
    { label: 'Reverse', rpc: 'reverse_journal', args: { p_id: '$id', p_date: '$prompt.date', p_reason: '$prompt.reason' }, variant: 'danger', when: { field: 'status', in: ['posted'] }, prompts: [{ name: 'date', label: 'Reversal date', type: 'date', required: true }, { name: 'reason', label: 'Reason', required: true }] }] };
export default function Page() { return <div className="grid"><div><JournalForm /><ResourcePage config={cfg} /></div><RunRecurring /><ResourcePage config={recurring} /></div>; }
