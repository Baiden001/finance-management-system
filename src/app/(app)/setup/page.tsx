import OpeningBalances from '@/components/OpeningBalances';
import CsvImport from '@/components/CsvImport';
import ResourcePage from '@/components/ResourcePage';
import { fiscalYears } from '@/lib/configs';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Setup' };
export default function Page() {
  return <div className="grid"><div><h1>Setup</h1><p className="muted" style={{ margin: 0 }}>One-off tasks when you start using the system and at year end.</p></div>
    <OpeningBalances /><CsvImport /><div><h2>3. Year-end close</h2><ResourcePage config={fiscalYears} /></div></div>;
}
