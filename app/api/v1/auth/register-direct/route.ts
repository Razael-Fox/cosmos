import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { mockStore } from '@/lib/mockStore';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { phone, turnstileToken } = body;

        if (!phone || !turnstileToken) {
            return NextResponse.json({ error: 'Phone and Turnstile token are required' }, { status: 400 });
        }

        const cleanPhone = phone.replace(/\D/g, '');
        const code = crypto.randomInt(100000, 999999).toString();
        const expiresIn = 300;

        mockStore.directOtps.set(cleanPhone, {
            code,
            expiresAt: Date.now() + expiresIn * 1000,
            attempts: 0
        });

        return NextResponse.json({
            expiresIn,
            message: 'OTP dispatched successfully'
        });
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
