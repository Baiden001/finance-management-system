import ResourcePage from '@/components/ResourcePage';
import DepreciationPanel from '@/components/DepreciationPanel';
import { assets } from '@/lib/configs';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Fixed Assets' };
export default function Page() { return <div className="grid"><ResourcePage config={assets} /><DepreciationPanel /></div>; }
