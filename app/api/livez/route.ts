import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
/** Process liveness only: no auth, datasource, cache, clock or provider side effects. */
export function GET() {
  const candidate = process.env.BENAA_RELEASE_SHA;
  const build = candidate && /^[a-f0-9]{40}$/i.test(candidate) ? candidate : 'unidentified';
  return NextResponse.json({ status: 'alive', build }, { headers: { 'Cache-Control': 'no-store' } });
}
