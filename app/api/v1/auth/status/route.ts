import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { mockStore } from '@/lib/mockStore';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session');

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
  }

  const session = mockStore.sessions.get(sessionId);
  if (!session) {
    return NextResponse.json({ status: 'EXPIRED' }, { status: 404 });
  }

  if (Date.now() > session.expiresAt) {
    return NextResponse.json({ status: 'EXPIRED' });
  }

  // Simulate verification if verified or after 5 seconds in standalone dev
  const sessionAge = Date.now() - (session.expiresAt - 300 * 1000);
  if (session.jwtToken || sessionAge > 4000) {
    if (!session.jwtToken) {
      session.jwtToken = `mock-jwt-token-${crypto.randomBytes(16).toString('hex')}`;
      session.verifiedAt = Date.now();
    }
    return NextResponse.json({
      status: 'VERIFIED',
      jwtToken: session.jwtToken,
    });
  }

  return NextResponse.json({ status: 'PENDING' });
}
