import ResourcePage from '@/components/ResourcePage';
import { budgets } from '@/lib/configs';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Budgets' };
export default function Page() { return <ResourcePage config={budgets} />; }
