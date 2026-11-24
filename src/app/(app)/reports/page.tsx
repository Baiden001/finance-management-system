import ReportsClient from '@/components/ReportsClient';
import { companyCode } from '@/lib/company';
import { supabaseServer } from '@/lib/supabase-server';
import { asRole } from '@/lib/roles';
export const dynamic = 'force-dynamic'; export const metadata = { title: 'Reports' };
export default async function Page() {
  const { data } = await (await supabaseServer()).rpc('app_role');
  return <ReportsClient company={companyCode()} role={asRole(data) ?? 'ceo'} mfaNote={process.env.REQUIRE_MFA === 'true'} />;
}
