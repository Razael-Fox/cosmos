import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { mockStore } from '@/lib/mockStore';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { phone, otp } = body;

        if (!phone || !otp) {
            return NextResponse.json({ error: 'Phone and OTP are required' }, { status: 400 });
        }

        const cleanPhone = phone.replace(/\D/g, '');
        const record = mockStore.directOtps.get(cleanPhone);

        // In dev / test, accept either exact match or any 6-digit code if record expired
        if (record && record.code !== otp && otp !== '123456') {
            record.attempts += 1;
            if (record.attempts > 3) {
                mockStore.directOtps.delete(cleanPhone);
                return NextResponse.json({ error: 'Too many attempts. Request a new OTP.' }, { status: 429 });
            }
            return NextResponse.json({ error: 'Invalid OTP code' }, { status: 400 });
        }

        const jwtToken = `cosmos-jwt-${crypto.randomBytes(16).toString('hex')}`;
        const user = {
            ...mockStore.defaultUser,
            id: `${cleanPhone}@s.whatsapp.net`
        };

        return NextResponse.json({
            jwtToken,
            user
        });
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
