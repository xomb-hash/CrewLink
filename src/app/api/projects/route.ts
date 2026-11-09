import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { getGitHubClient } from '@/github/index';
import { validateProjectInput } from '@/lib/validation';
import { generateShareLinks } from '@/projects/share';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const projects = storage.getProjectsByOwner(user.login);

  const projectsWithDetails = projects.map((project) => {
    const applicants = storage.getApplicantsByProject(project.id).map((applicant) => ({
      id: applicant.id,
      userLogin: applicant.userLogin,
      userAvatar: applicant.userAvatar,
      accountAge: applicant.accountAge,
      publicRepoCount: applicant.publicRepoCount,
      message: applicant.message,
      status: applicant.status,
      invitationSent: applicant.invitationSent,
      createdAt: applicant.createdAt,
    }));

    return {
      ...project,
      shareLinks: generateShareLinks(project),
      applicants,
    };
  });

  return NextResponse.json({ projects: projectsWithDetails });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user || !user.accessToken) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const validation = validateProjectInput(body as Parameters<typeof validateProjectInput>[0]);
  if (!validation.isValid) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 });
  }

  const { repoFullName, joinMode, screeningUrl, title, description } = validation.data;
  const [owner, repo] = repoFullName.split('/');

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

    const isPrivate = Boolean((body as { isPrivate?: boolean }).isPrivate);

    const project = storage.createProject({
      ownerLogin: user.login,
      ownerId: user.id,
      ownerAvatar: user.avatarUrl,
      repoFullName,
      repoName: repo,
      repoOwner: owner,
      isPrivate,
      joinMode,
      screeningUrl,
      title: title || repo,
      description,
    });

    const shareLinks = generateShareLinks(project);

    return NextResponse.json(
      {
        project: {
          ...project,
          shareLinks,
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Project creation failed:', msg);
    return NextResponse.json({ error: `Failed to create project: ${msg}` }, { status: 500 });
  }
}
