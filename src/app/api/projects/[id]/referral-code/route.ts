import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { generateShareLinks } from '@/projects/share';
import type { Project, ReferralSettings } from '@/types/index';

interface ParsedSettings {
  settings: ReferralSettings;
  error?: string;
}

// --- Parse optional PATCH settings: usageLimit (null/blank = unlimited) and expiresAt (null/blank = none) ---
function parseSettings(raw: unknown): ParsedSettings {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const settings: ReferralSettings = {};

  if (Object.prototype.hasOwnProperty.call(body, 'usageLimit')) {
    const value = body.usageLimit;
    if (value === null || value === '' || value === 0 || value === '0') {
      settings.usageLimit = null;
    } else {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1) {
        return { settings, error: 'Usage limit must be a whole number of 1 or more.' };
      }
      settings.usageLimit = limit;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'expiresAt')) {
    const value = body.expiresAt;
    if (value === null || value === '') {
      settings.expiresAt = null;
    } else {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        return { settings, error: 'Expiry date is not valid.' };
      }
      settings.expiresAt = date.toISOString();
    }
  }

  return { settings };
}

// --- Tolerate an empty or non-JSON body so POST can generate a code with no settings ---
async function readBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// --- Shared guard: signed in → project exists → caller is owner → project uses referral mode ---
async function ownedReferralProject(
  request: NextRequest,
  id: string
): Promise<{ project: Project } | { error: NextResponse }> {
  const user = await getCurrentUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 }) };
  }

  const project = await storage.getProjectById(id);
  if (!project) {
    return { error: NextResponse.json({ error: 'Project not found.' }, { status: 404 }) };
  }

  const isOwner =
    project.ownerLogin.toLowerCase() === user.login.toLowerCase() ||
    String(project.ownerId) === String(user.id);
  if (!isOwner) {
    return {
      error: NextResponse.json(
        { error: 'Only the project owner can manage referral links.' },
        { status: 403 }
      ),
    };
  }

  if (project.joinMode !== 'referral') {
    return {
      error: NextResponse.json(
        { error: 'Referral links are only available for private referral projects.' },
        { status: 400 }
      ),
    };
  }

  return { project };
}

// --- Fresh code, current usage count, settings, and share links returned to the dashboard ---
async function referralResponse(project: Project) {
  const usageCount = await storage.countApplicantsByReferralCode(
    project.id,
    project.referralCode || ''
  );
  return {
    referralCode: project.referralCode || '',
    referralCodeCreatedAt: project.referralCodeCreatedAt,
    referralCodeExpiresAt: project.referralCodeExpiresAt,
    referralCodeUsageLimit: project.referralCodeUsageLimit,
    referralCodeRevokedAt: project.referralCodeRevokedAt,
    referralCodeUsedAt: project.referralCodeUsedAt,
    usageCount,
    shareLinks: generateShareLinks(project, undefined, usageCount),
  };
}

// --- POST: generate a unique reusable code; also used by "Regenerate" ---
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const owned = await ownedReferralProject(request, id);
  if ('error' in owned) return owned.error;

  const parsed = parseSettings(await readBody(request));
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const referralCode = await storage.generateUniqueReferralCode();
  let updated = await storage.updateProjectReferralCode(owned.project.id, referralCode);
  if (!updated) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  if (Object.keys(parsed.settings).length > 0) {
    updated = (await storage.updateProjectReferralSettings(owned.project.id, parsed.settings)) || updated;
  }

  return NextResponse.json(await referralResponse(updated));
}

// --- PATCH: change the usage limit and/or expiry without changing the code ---
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const owned = await ownedReferralProject(request, id);
  if ('error' in owned) return owned.error;

  const parsed = parseSettings(await readBody(request));
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const updated = await storage.updateProjectReferralSettings(owned.project.id, parsed.settings);
  if (!updated) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  return NextResponse.json(await referralResponse(updated));
}

// --- DELETE: revoke the link immediately while keeping the code for the record ---
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const owned = await ownedReferralProject(request, id);
  if ('error' in owned) return owned.error;

  const updated = await storage.revokeProjectReferralCode(owned.project.id);
  if (!updated) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  return NextResponse.json(await referralResponse(updated));
}
