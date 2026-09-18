import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { mockStore } from '@/lib/mockStore';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { identifier, password } = body;

        if (!identifier || !password) {
            return NextResponse.json({ error: 'Identifier and password are required' }, { status: 400 });
        }

        const clean = identifier.replace(/\D/g, '');
        const jid = clean ? `${clean}@s.whatsapp.net` : `${identifier}@s.whatsapp.net`;
        const jwtToken = `cosmos-jwt-${crypto.randomBytes(16).toString('hex')}`;

        const user = {
            ...mockStore.defaultUser,
            id: jid,
            username: identifier
        };

        return NextResponse.json({
            jwtToken,
            user
        });
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
