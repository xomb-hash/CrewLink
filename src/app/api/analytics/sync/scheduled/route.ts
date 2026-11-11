import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/index';
import storage from '@/lib/storage';
import { logger } from '@/lib/logger';
import { rateLimiter } from '@/lib/rateLimit';
import { AnalyticsError, syncProjectAnalytics } from '@/analytics/sync';
import { analyticsErrorResponse } from '../../errors';

export const maxDuration = 120;

function schedulerTokenFrom(request: NextRequest): string {
  const header = request.headers.get('x-crewlink-scheduler-token') || '';
  if (header) return header.trim();
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function tokenMatches(provided: string, expected: string): boolean {
  if (!provided || !expected || expected.length < 32) return false;
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// A scheduler (cron, GitHub Actions, a platform job runner) authenticates with a
// service token, never a user session. The endpoint is disabled unless
// ANALYTICS_SCHEDULER_TOKEN is set to at least 32 characters. It starts no
// worker of its own and never bypasses the per-platform database lease.
export async function POST(request: NextRequest) {
  try {
    if (!config.analyticsSchedulerToken || config.analyticsSchedulerToken.length < 32) {
      return NextResponse.json(
        { error: 'The analytics scheduler endpoint is not configured.' },
        { status: 503 }
      );
    }
    const limit = rateLimiter.check(request, {
      limit: 6,
      windowMs: 60_000,
      keyPrefix: 'analytics-scheduler',
    });
    if (!limit.success) return rateLimiter.createResponse(limit);

    if (!tokenMatches(schedulerTokenFrom(request), config.analyticsSchedulerToken)) {
      return NextResponse.json({ error: 'Unauthorized scheduler request.' }, { status: 401 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const requestedIds = Array.isArray(body.projectIds)
      ? body.projectIds
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];
    const projects = requestedIds.length
      ? (
          await Promise.all(requestedIds.map((id) => storage.getProjectById(id)))
        ).filter((project): project is NonNullable<typeof project> => Boolean(project))
      : (await storage.listProjectsWithAnalyticsConnections()).slice(0, 20);

    const results: Array<{
      projectId: string;
      status: 'completed' | 'partial' | 'failed' | 'skipped';
      results: Array<{ platformId: string; status: string; note: string }>;
      errorCode?: string;
      errorMessage?: string;
    }> = [];

    for (const project of projects) {
      const owner = await storage.getUser(project.ownerId);
      if (!owner) {
        results.push({
          projectId: project.id,
          status: 'skipped',
          results: [],
          errorCode: 'owner_missing',
          errorMessage: 'The project owner could not be resolved.',
        });
        continue;
      }
      try {
        const synced = await syncProjectAnalytics({
          user: owner,
          project,
          trigger: 'scheduled',
        });
        results.push({
          projectId: project.id,
          status: synced.results.some((row) => row.status === 'failed')
            ? 'partial'
            : synced.results.every((row) => row.status === 'skipped')
              ? 'skipped'
              : 'completed',
          results: synced.results.map((row) => ({
            platformId: row.platformId,
            status: row.status,
            note: row.note,
          })),
        });
      } catch (error) {
        const code = error instanceof AnalyticsError ? error.code : 'platform_error';
        const message =
          error instanceof AnalyticsError
            ? error.message
            : 'The scheduled analytics sync failed.';
        logger.warn('Scheduled analytics sync failed', {
          projectId: project.id,
          code,
        });
        results.push({
          projectId: project.id,
          status: 'failed',
          results: [],
          errorCode: code,
          errorMessage: message.slice(0, 300),
        });
      }
    }

    return NextResponse.json({
      startedAt: new Date().toISOString(),
      processed: results.length,
      results,
    });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
