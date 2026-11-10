import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { config } from '@/config/index';
import { rateLimiter } from '@/lib/rateLimit';
import { isDiscoverable } from '@/projects/visibility';
import type { ExploreProject } from '@/types/index';

export async function GET(request: NextRequest) {
  // Rate limiting: 60 requests per minute
  const check = rateLimiter.check(request, { limit: 60, windowMs: 60_000, keyPrefix: 'explore' });
  if (!check.success) {
    return rateLimiter.createResponse(check);
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.toLowerCase().trim() || '';
  const roleFilter = searchParams.get('role')?.toLowerCase().trim() || '';

  const allProjects = (await storage.listProjects()).filter((project) => isDiscoverable(project));

  const exploreProjects: ExploreProject[] = await Promise.all(
    allProjects.map(async (project) => {
      const applicants = await storage.getApplicantsByProject(project.id);
      return {
        ...project,
        applicantsCount: applicants.length,
        joinUrl: `${config.appUrl}/join/${project.slug}`,
      };
    })
  );

  let filtered = exploreProjects;

  if (roleFilter && roleFilter !== 'all') {
    filtered = filtered.filter((p) =>
      p.roles && p.roles.some((r) => r.toLowerCase().includes(roleFilter))
    );
  }

  if (q) {
    filtered = filtered.filter((p) => {
      const titleMatch = p.title.toLowerCase().includes(q);
      const descMatch = (p.description || '').toLowerCase().includes(q);
      const repoMatch = p.repoFullName.toLowerCase().includes(q);
      const rolesMatch = p.roles ? p.roles.some((r) => r.toLowerCase().includes(q)) : false;
      return titleMatch || descMatch || repoMatch || rolesMatch;
    });
  }

  return NextResponse.json({
    projects: filtered,
    total: filtered.length,
  });
}
