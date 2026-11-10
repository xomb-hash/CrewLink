import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { getGitHubClient } from '@/github/index';
import { validateProjectInput } from '@/lib/validation';
import { generateShareLinks } from '@/projects/share';
import { projectLogoUrl } from '@/projects/logo';
import { deleteLogo, LogoUploadError, saveLogo } from '@/lib/uploads';
import { rateLimiter } from '@/lib/rateLimit';

function parseRoles(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(String).map((r) => r.trim()).filter(Boolean).slice(0, 10);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(String).map((r) => r.trim()).filter(Boolean).slice(0, 10);
      }
    } catch {
      // Fall back to comma-separated input.
    }
    return raw.split(',').map((r) => r.trim()).filter(Boolean).slice(0, 10);
  }
  return [];
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const projects = await storage.getProjectsByOwner(user.login);

  const projectsWithDetails = await Promise.all(
    projects.map(async (project) => {
      const applicants = (await storage.getApplicantsByProject(project.id)).map((applicant) => ({
        id: applicant.id,
        userLogin: applicant.userLogin,
        userAvatar: applicant.userAvatar,
        accountAge: applicant.accountAge,
        publicRepoCount: applicant.publicRepoCount,
        message: applicant.message,
        githubUrl: applicant.githubUrl,
        linkedinUrl: applicant.linkedinUrl,
        resumeFileName: applicant.resumeFileName,
        status: applicant.status,
        invitationSent: applicant.invitationSent,
        createdAt: applicant.createdAt,
      }));

      const { logoPath: _logoPath, ...publicProject } = project;
      return {
        ...publicProject,
        logoUrl: projectLogoUrl(project),
        shareLinks: generateShareLinks(project),
        applicants,
      };
    })
  );

  return NextResponse.json({ projects: projectsWithDetails });
}

export async function POST(request: NextRequest) {
  // Rate limit project creation: 10 per minute per IP
  const rateLimitCheck = rateLimiter.check(request, {
    limit: 10,
    windowMs: 60_000,
    keyPrefix: 'project-create',
  });
  if (!rateLimitCheck.success) {
    return rateLimiter.createResponse(rateLimitCheck);
  }

  const user = await getCurrentUser(request);
  if (!user || !user.accessToken) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }


  let body: Record<string, unknown> = {};
  let logoFile: File | null = null;
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      body = {
        repoFullName: String(form.get('repoFullName') || ''),
        joinMode: (() => {
          const mode = form.get('joinMode');
          return mode === 'screening' || mode === 'direct' ? mode : 'referral';
        })(),
        screeningUrl: String(form.get('screeningUrl') || ''),
        title: String(form.get('title') || ''),
        description: String(form.get('description') || ''),
        creatorNote: String(form.get('creatorNote') || ''),
        isPrivate: form.get('isPrivate') === 'true',
        requireResume: form.get('requireResume') === 'true',
        requireGithubLink: form.get('requireGithubLink') === 'true',
        requireLinkedinLink: form.get('requireLinkedinLink') === 'true',
        roles: parseRoles(form.get('roles')),
      };
      const candidate = form.get('logo');
      if (candidate && typeof candidate === 'object' && 'arrayBuffer' in candidate) {
        logoFile = candidate as File;
      }
    } else {
      body = (await request.json()) as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const validation = validateProjectInput(body as Parameters<typeof validateProjectInput>[0]);
  if (!validation.isValid) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 });
  }

  const { repoFullName, joinMode, screeningUrl, title, description } = validation.data;
  const [owner, repo] = repoFullName.split('/');
  let savedLogo: { storedName: string } | null = null;

  try {
    const client = getGitHubClient();
    const isAdmin = await client.checkAdminAccess(user.accessToken, owner, repo);
    if (!isAdmin) {
      return NextResponse.json(
        {
          error: `You do not have administrative access to ${repoFullName}. Only repository administrators can connect a project.`,
        },
        { status: 403 }
      );
    }

    if (logoFile) {
      try {
        savedLogo = await saveLogo(logoFile);
      } catch (err: unknown) {
        if (err instanceof LogoUploadError) {
          return NextResponse.json({ errors: [err.message] }, { status: 400 });
        }
        throw err;
      }
    }

    const isPrivate = Boolean(body.isPrivate);
    const roles = parseRoles(body.roles);

    const project = await storage.createProject({
      ownerLogin: user.login,
      ownerId: user.id,
      ownerAvatar: user.avatarUrl,
      repoFullName,
      repoName: repo,
      repoOwner: owner,
      isPrivate,
      joinMode,
      screeningUrl,
      screeningNote: validation.data.screeningNote,
      roles,
      title: title || repo,
      description,
      creatorNote: validation.data.creatorNote,
      requireResume: validation.data.requireResume,
      requireGithubLink: validation.data.requireGithubLink,
      requireLinkedinLink: validation.data.requireLinkedinLink,
      logoPath: savedLogo?.storedName,
    });

    const shareLinks = generateShareLinks(project);
    const { logoPath: _logoPath, ...publicProject } = project;

    return NextResponse.json(
      {
        project: {
          ...publicProject,
          logoUrl: projectLogoUrl(project),
          shareLinks,
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    if (savedLogo) await deleteLogo(savedLogo.storedName);
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Project creation failed:', msg);
    return NextResponse.json({ error: `Failed to create project: ${msg}` }, { status: 500 });
  }
}
