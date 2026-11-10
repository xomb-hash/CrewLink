import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resumeStorageMode } from '@/lib/uploads';

export async function GET() {
  const startTime = Date.now();
  let dbStatus = 'healthy';
  let dbLatencyMs = 0;
  let isHealthy = true;

  const dbUrl = process.env.DATABASE_URL;
  const isPrismaConfigured = Boolean(
    dbUrl &&
    (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) &&
    process.env.NODE_ENV !== 'test'
  );

  if (isPrismaConfigured) {
    try {
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - dbStart;
      dbStatus = 'connected';
    } catch (err: unknown) {
      dbStatus = 'disconnected';
      isHealthy = false;
    }
  } else {
    dbStatus = 'in-memory-active';
  }

  const payload = {
    status: isHealthy ? 'healthy' : 'degraded',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatus,
      latencyMs: dbLatencyMs,
    },
    resumeStorage: resumeStorageMode(),
    version: '1.0.0',
  };

  return NextResponse.json(payload, {
    status: isHealthy ? 200 : 503,
  });
}
