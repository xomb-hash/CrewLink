import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { ConnectionError, disconnectConnection } from '@/posting/connections';

// Disconnecting wipes the stored token material. Reconnecting creates a fresh
// authorisation for the same connection record.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const { id } = await params;

  try {
    await disconnectConnection(String(user.id), id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ConnectionError) {
      const status = err.code === 'connection_not_found' ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
}
