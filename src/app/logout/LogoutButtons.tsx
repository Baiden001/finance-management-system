'use client';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
export default function LogoutButtons({ nextUrl, label }: { nextUrl: string | null; label: string }) {
  const r = useRouter();
  async function out() {
    await supabaseBrowser().auth.signOut({ scope: 'local' });
    if (nextUrl) { window.location.href = `${nextUrl}/login`; return; }
    r.replace('/login'); r.refresh();
  }
  return (
    <div className="row" style={{ justifyContent: 'center' }}>
      <button className="btn alt" onClick={() => r.back()}>Cancel</button>
      <button className="btn danger" onClick={out}>{label}</button>
    </div>
  );
}
