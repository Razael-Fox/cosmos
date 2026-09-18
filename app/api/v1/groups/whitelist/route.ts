import { NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { jid, language } = body;

        if (!jid) {
            return NextResponse.json({ error: 'Group JID is required' }, { status: 400 });
        }

        if (mockStore.groups.length >= mockStore.subscription.maxGroups) {
            return NextResponse.json(
                { error: 'Group quota limit reached. Upgrade your subscription plan.', code: 'QUOTA_EXCEEDED_GROUPS' },
                { status: 403 }
            );
        }

        const cleanJid = jid.trim();
        const existing = mockStore.groups.find((g) => g.jid === cleanJid);
        if (existing) {
            return NextResponse.json(existing);
        }

        const created = {
            jid: cleanJid,
            language: language || 'ID',
            ownerJid: mockStore.defaultUser.id,
            createdAt: new Date().toISOString()
        };

        mockStore.groups.push(created);
        return NextResponse.json(created);
    } catch {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
