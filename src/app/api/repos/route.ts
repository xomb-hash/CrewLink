import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getGitHubClient } from '@/github/index';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user || !user.accessToken) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  try {
    const client = getGitHubClient();
    const repos = await client.getUserAdminRepos(user.accessToken);
    return NextResponse.json({ repos });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Failed to fetch admin repos:', msg);
    return NextResponse.json({ error: `Could not fetch repositories: ${msg}` }, { status: 500 });
  }
}
