import { NextResponse } from 'next/server';
import { companyCode } from '@/lib/company';
export const dynamic = 'force-dynamic';
/** Liveness only: reveals nothing about the database. Company binding is checked after sign-in (see app layout). */
export function GET() { return NextResponse.json({ ok: true, company: companyCode() }); }
