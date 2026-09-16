import { NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ phone: string }> }
) {
  const { phone } = await props.params;
  const decodedPhone = decodeURIComponent(phone);

  const initialLen = mockStore.subBots.length;
  mockStore.subBots = mockStore.subBots.filter((b) => b.id !== decodedPhone);

  if (mockStore.subBots.length === initialLen) {
    return NextResponse.json({ error: 'Sub-bot instance not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
