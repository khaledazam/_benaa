import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import { rotateMobileSession } from '@/lib/auth/mobileSessions';
import { createCorsHeaders, handleCorsPreflight } from '@/lib/api/cors';
import { withRateLimit, defaultRateLimits } from '@/lib/api/rate-limit';

export async function POST(request: NextRequest) {
  const headers = createCorsHeaders(request);
  headers.set('Cache-Control', 'no-store');
  const limited = await withRateLimit(request, defaultRateLimits.strict);
  if (limited) return limited;
  try {
    const body = await request.json();
    if (typeof body?.refreshToken !== 'string' || body.refreshToken.length > 100) {
      return NextResponse.json({ error: 'Invalid refresh request' }, { status: 400, headers });
    }
    return NextResponse.json(await rotateMobileSession(prisma, body.refreshToken), { headers });
  } catch (error: any) {
    return NextResponse.json({ error: 'Session unavailable; sign in again' },
      { status: error?.status === 401 ? 401 : 503, headers });
  }
}
export const OPTIONS = handleCorsPreflight;
