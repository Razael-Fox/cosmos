import { NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';

export async function GET() {
    const whitelistedJids = new Set(mockStore.groups.map((g) => g.jid));
    const mockParticipating = [
        {
            id: '120363023456789012@g.us',
            subject: 'Cosmos Community Alpha',
            size: 42,
            isAdmin: true,
            isWhitelisted: whitelistedJids.has('120363023456789012@g.us')
        },
        {
            id: '120363098765432101@g.us',
            subject: 'Dev & Bot Testers',
            size: 18,
            isAdmin: false,
            isWhitelisted: whitelistedJids.has('120363098765432101@g.us')
        },
        {
            id: '120363112233445566@g.us',
            subject: 'Cosmos Family & Gaming Group',
            size: 67,
            isAdmin: true,
            isWhitelisted: whitelistedJids.has('120363112233445566@g.us')
        },
        {
            id: '120363998877665544@g.us',
            subject: 'Regional Discussion Group',
            size: 120,
            isAdmin: false,
            isWhitelisted: whitelistedJids.has('120363998877665544@g.us')
        }
    ];

    const currentCount = mockStore.groups.length;
    const maxCount = 5;

    return NextResponse.json({
        groups: mockParticipating,
        quota: {
            current: currentCount,
            max: maxCount,
            available: Math.max(0, maxCount - currentCount),
            tier: 'FREE',
            isLimitReached: currentCount >= maxCount
        }
    });
}
