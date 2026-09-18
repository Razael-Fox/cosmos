import { NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';

export async function GET() {
    const currentSubBots = mockStore.subBots.length;
    const currentGroups = mockStore.groups.length;

    return NextResponse.json({
        ...mockStore.subscription,
        currentSubBots,
        currentGroups
    });
}
