import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { mockStore } from '@/lib/mockStore';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { phone, username, email, turnstileToken } = body;

        if (!phone || !turnstileToken) {
            return NextResponse.json({ error: 'Phone and Turnstile token are required' }, { status: 400 });
        }

        const cleanPhone = phone.replace(/\D/g, '');
        const last4 = cleanPhone.slice(-4) || '0000';
        const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
        const token = `COSMOS-${randomHex}-${last4}`;
        const regSessionId = crypto.randomBytes(32).toString('hex');
        const botNumber = (process.env.NEXT_PUBLIC_BOT_NUMBER || '628123456789').replace(/\D/g, '');

        const messageText = `.verify ${token}`;
        const clickToChatUrl = `https://wa.me/${botNumber}?text=${encodeURIComponent(messageText)}`;
        const expiresIn = 300;

        mockStore.sessions.set(regSessionId, {
            token,
            phone: cleanPhone,
            username,
            email,
            expiresAt: Date.now() + expiresIn * 1000
        });

        return NextResponse.json({
            token,
            clickToChatUrl,
            regSessionId,
            expiresIn
        });
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
