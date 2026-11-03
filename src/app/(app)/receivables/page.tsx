import Link from 'next/link';
import ResourcePage from '@/components/ResourcePage';
import DocumentForm from '@/components/DocumentForm';
import PaymentForm from '@/components/PaymentForm';
import { customers, invoicesCfg, paymentsIn, creditNotesSales } from '@/lib/configs';
import { companyCode } from '@/lib/company';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Receivables' };
export default function Page() {
  return <div className="grid"><div className="row"><DocumentForm kind="invoice" company={companyCode()} /><PaymentForm direction="in" /></div>
    <ResourcePage config={invoicesCfg} /><ResourcePage config={paymentsIn} /><ResourcePage config={creditNotesSales} /><ResourcePage config={customers} />
    <p className="muted"><Link href="/reports">Aging is in Reports.</Link> Print a customer&rsquo;s statement from the Customers table.</p></div>;
}
