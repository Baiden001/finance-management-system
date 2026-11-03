import { notFound } from 'next/navigation';
import ResourcePage from '@/components/ResourcePage';
import { OPERATIONS } from '@/lib/configs';
import NewProjectForm from '@/components/NewProjectForm';
import { companyCode } from '@/lib/company';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params; const op = OPERATIONS[section];
  if (!op || op.company !== companyCode()) notFound();
  return <div className="grid">{section === 'projects' && <NewProjectForm />}{op.configs.map((c) => <ResourcePage key={c.table} config={c} />)}</div>;
}
