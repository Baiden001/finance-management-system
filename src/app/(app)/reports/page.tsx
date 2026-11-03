import ReportsClient from '@/components/ReportsClient';
import { companyCode } from '@/lib/company';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Reports' };
export default function Page() { return <ReportsClient company={companyCode()} mfaNote={process.env.REQUIRE_MFA === 'true'} />; }
