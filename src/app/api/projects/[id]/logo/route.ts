import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { readLogo } from '@/lib/uploads';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await storage.getProjectById(id);
  if (!project?.logoPath) {
    return NextResponse.json({ error: 'Logo not found.' }, { status: 404 });
  }

  const logo = await readLogo(project.logoPath);
  if (!logo) {
    return NextResponse.json({ error: 'Logo file is missing.' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(logo.buffer), {
    headers: {
      'Content-Type': logo.contentType,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
