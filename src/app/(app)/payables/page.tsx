import ResourcePage from '@/components/ResourcePage';
import DocumentForm from '@/components/DocumentForm';
import PaymentForm from '@/components/PaymentForm';
import { suppliers, billsCfg, paymentsOut, creditNotesPurchase } from '@/lib/configs';
import { companyCode } from '@/lib/company';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Payables' };
export default function Page() { return <div className="grid"><div className="row"><DocumentForm kind="bill" company={companyCode()} /><PaymentForm direction="out" /></div><ResourcePage config={billsCfg} /><ResourcePage config={paymentsOut} /><ResourcePage config={creditNotesPurchase} /><ResourcePage config={suppliers} /></div>; }
