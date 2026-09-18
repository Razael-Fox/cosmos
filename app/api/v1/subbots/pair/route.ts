import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { mockStore } from '@/lib/mockStore';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { phone, method } = body;

        if (!phone) {
            return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
        }

        if (mockStore.subBots.length >= mockStore.subscription.maxSubBots) {
            return NextResponse.json(
                { error: 'Sub-bot quota exceeded. Upgrade your subscription plan.', code: 'QUOTA_EXCEEDED_SUBBOTS' },
                { status: 403 }
            );
        }

        const cleanPhone = phone.replace(/\D/g, '');

        if (method === 'qr') {
            return NextResponse.json({
                qrCode: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="monospace" font-size="14" fill="black">QR: ${cleanPhone}</text></svg>`,
                expiresIn: 60
            });
        }

        // Default: 8-digit pairing code (e.g. ABCD-1234)
        const p1 = crypto.randomBytes(2).toString('hex').toUpperCase();
        const p2 = crypto.randomBytes(2).toString('hex').toUpperCase();
        const pairingCode = `${p1}-${p2}`;

        // Auto-register sub-bot in mock store after short simulation
        const existingIndex = mockStore.subBots.findIndex((b) => b.id === cleanPhone);
        if (existingIndex === -1) {
            mockStore.subBots.push({
                id: cleanPhone,
                ownerJid: mockStore.defaultUser.id,
                customPrefix: '.',
                status: 'ACTIVE',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }

        return NextResponse.json({
            pairingCode,
            expiresIn: 180
        });
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
