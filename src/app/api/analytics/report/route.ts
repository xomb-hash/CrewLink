import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject } from '@/ai/access';
import { buildAnalyticsReport, buildReportCsv, buildReportPdf, reportFilename } from '@/analytics/reports';
import { rateLimiter } from '@/lib/rateLimit';
import { analyticsErrorResponse } from '../errors';
import { projectIdFromRequest, rangeFromRequest } from '../params';

export async function GET(request: NextRequest) {
  try {
    const limit = rateLimiter.check(request, {
      limit: 10,
      windowMs: 60_000,
      keyPrefix: 'analytics-report',
    });
    if (!limit.success) return rateLimiter.createResponse(limit);

    const projectId = projectIdFromRequest(request);
    const { project } = await requireOwnedProject(request, projectId);
    const range = rangeFromRequest(request);
    const format = new URL(request.url).searchParams.get('format') === 'pdf' ? 'pdf' : 'csv';
    const report = await buildAnalyticsReport({ project, range });
    const filename = reportFilename(project, range, format);
    if (format === 'pdf') {
      const pdf = buildReportPdf(report);
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control': 'no-store',
        },
      });
    }
    return new NextResponse(buildReportCsv(report), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
