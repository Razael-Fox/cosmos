import { NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ jid: string }> }
) {
  const { jid } = await props.params;
  const decodedJid = decodeURIComponent(jid);

  const initialLen = mockStore.groups.length;
  mockStore.groups = mockStore.groups.filter((g) => g.jid !== decodedJid);

  if (mockStore.groups.length === initialLen) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
