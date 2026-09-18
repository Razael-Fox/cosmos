import { NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';

export async function GET() {
    return NextResponse.json({
        user: mockStore.defaultUser
    });
}
