import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './prisma';
import { encryptSecret, decryptSecret } from './crypto';
import { logger } from './logger';
import type { User, Project, Applicant, Session, Draft, DraftStatus } from '../types/index';

interface StorageData {
  projects: Project[];
  applicants: Applicant[];
  users: Record<string, User>;
  sessions: Record<string, Session>;
  drafts: Draft[];
}

export class Storage {
  private data: StorageData;
  private filePath: string;
  private initialized = false;

  constructor() {
    this.filePath = path.resolve(process.cwd(), 'data', 'crewlink.json');
    this.data = {
      projects: [],
      applicants: [],
      users: {},
      sessions: {},
      drafts: [],
    };
    this.ensureLoaded();
  }

  private isPrismaActive(): boolean {
    const dbUrl = process.env.DATABASE_URL;
    return Boolean(
      dbUrl &&
      (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) &&
      process.env.NODE_ENV !== 'test'
    );
  }

  ensureLoaded(): void {
    if (this.initialized) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          projects: parsed.projects || [],
          applicants: parsed.applicants || [],
          users: parsed.users || {},
          sessions: parsed.sessions || {},
          drafts: parsed.drafts || [],
        };
      } else {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this.save();
      }
    } catch {
      this.data = { projects: [], applicants: [], users: {}, sessions: {}, drafts: [] };
    }
    this.initialized = true;
  }

  save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err: unknown) {
      logger.error('Storage save error', err);
    }
  }

  reset(): void {
    this.data = {
      projects: [],
      applicants: [],
      users: {},
      sessions: {},
      drafts: [],
    };
    this.save();
  }

  // --- Users ---
  async saveUser(user: Partial<User> & { id: string | number; login: string }): Promise<User> {
    const id = String(user.id);
    const encryptedToken = user.accessToken ? encryptSecret(user.accessToken) : (user.accessToken === null ? null : undefined);

    if (this.isPrismaActive()) {
      try {
        const result = await prisma.user.upsert({
          where: { id },
          create: {
            id,
            login: user.login,
            name: user.name || null,
            avatarUrl: user.avatarUrl || null,
            accessToken: encryptedToken || null,
            publicRepos: Number(user.publicRepos) || 0,
            createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
          },
          update: {
            login: user.login,
            name: user.name || null,
            avatarUrl: user.avatarUrl || null,
            ...(encryptedToken !== undefined ? { accessToken: encryptedToken } : {}),
            publicRepos: Number(user.publicRepos) || 0,
          },
        });
        return {
          id: result.id,
          login: result.login,
          name: result.name ?? undefined,
          avatarUrl: result.avatarUrl ?? undefined,
          accessToken: result.accessToken ? decryptSecret(result.accessToken) : undefined,
          publicRepos: result.publicRepos,
          createdAt: result.createdAt.toISOString(),
          updatedAt: result.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma saveUser failed', err, { userId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    const existing = this.data.users[id] || {};
    const updated: User = {
      ...existing,
      ...user,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.data.users[id] = updated;
    this.save();
    return updated;
  }

  async getUser(userId: string | number): Promise<User | null> {
    const id = String(userId);

    if (this.isPrismaActive()) {
      try {
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) return null;
        return {
          id: user.id,
          login: user.login,
          name: user.name ?? undefined,
          avatarUrl: user.avatarUrl ?? undefined,
          accessToken: user.accessToken ? decryptSecret(user.accessToken) : undefined,
          publicRepos: user.publicRepos,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma getUser failed', err, { userId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.users[id] || null;
  }

  // --- Sessions ---
  async createSession(userId: string | number, maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<string> {
    const id = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + maxAgeMs);
    const uId = String(userId);

    if (this.isPrismaActive()) {
      try {
        await prisma.session.create({
          data: {
            id,
            userId: uId,
            expiresAt,
          },
        });
        return id;
      } catch (err) {
        logger.error('Prisma createSession failed', err, { userId: uId });
        throw err;
      }
    }

    this.ensureLoaded();
    this.data.sessions[id] = {
      userId: uId,
      expiresAt: expiresAt.getTime(),
      createdAt: new Date().toISOString(),
    };
    this.save();
    return id;
  }

  async getSession(sessionId?: string): Promise<{ sessionId: string; user: User } | null> {
    if (!sessionId) return null;

    if (this.isPrismaActive()) {
      try {
        const session = await prisma.session.findUnique({
          where: { id: sessionId },
          include: { user: true },
        });
        if (!session) return null;
        if (Date.now() > session.expiresAt.getTime()) {
          await prisma.session.delete({ where: { id: sessionId } });
          return null;
        }
        return {
          sessionId,
          user: {
            id: session.user.id,
            login: session.user.login,
            name: session.user.name ?? undefined,
            avatarUrl: session.user.avatarUrl ?? undefined,
            accessToken: session.user.accessToken ? decryptSecret(session.user.accessToken) : undefined,
            publicRepos: session.user.publicRepos,
            createdAt: session.user.createdAt.toISOString(),
          },
        };
      } catch (err) {
        logger.error('Prisma getSession failed', err, { sessionId });
        throw err;
      }
    }

    this.ensureLoaded();
    const session = this.data.sessions[sessionId];
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      delete this.data.sessions[sessionId];
      this.save();
      return null;
    }
    const user = await this.getUser(session.userId);
    return user ? { sessionId, user } : null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!sessionId) return;

    if (this.isPrismaActive()) {
      try {
        await prisma.session.deleteMany({ where: { id: sessionId } });
        return;
      } catch (err) {
        logger.error('Prisma deleteSession failed', err, { sessionId });
        throw err;
      }
    }

    this.ensureLoaded();
    if (this.data.sessions[sessionId]) {
      delete this.data.sessions[sessionId];
      this.save();
    }
  }

  // --- Projects ---
  async createProject(project: {
    ownerLogin: string;
    ownerId: string | number;
    ownerAvatar?: string;
    repoFullName: string;
    repoName: string;
    repoOwner: string;
    isPrivate?: boolean;
    joinMode?: 'referral' | 'screening';
    screeningUrl?: string;
    screeningNote?: string;
    roles?: string[];
    title?: string;
    description?: string;
  }): Promise<Project> {
    const id = `prj_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const baseSlug = (project.repoName || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
    const slug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;
    const roles = Array.isArray(project.roles)
      ? project.roles.map(String).map((r) => r.trim()).filter(Boolean).slice(0, 10)
      : [];

    if (this.isPrismaActive()) {
      try {
        const created = await prisma.project.create({
          data: {
            id,
            slug,
            ownerLogin: project.ownerLogin,
            ownerId: String(project.ownerId),
            ownerAvatar: project.ownerAvatar || null,
            repoFullName: project.repoFullName,
            repoName: project.repoName,
            repoOwner: project.repoOwner,
            isPrivate: Boolean(project.isPrivate),
            joinMode: project.joinMode === 'screening' ? 'screening' : 'referral',
            screeningUrl: project.joinMode === 'screening' ? project.screeningUrl || null : null,
            roles,
            title: project.title || project.repoName,
            description: project.description || null,
          },
        });
        return {
          id: created.id,
          slug: created.slug,
          ownerLogin: created.ownerLogin,
          ownerId: created.ownerId,
          ownerAvatar: created.ownerAvatar ?? undefined,
          repoFullName: created.repoFullName,
          repoName: created.repoName,
          repoOwner: created.repoOwner,
          isPrivate: created.isPrivate,
          joinMode: created.joinMode as 'referral' | 'screening',
          screeningUrl: created.screeningUrl ?? undefined,
          roles: created.roles,
          title: created.title,
          description: created.description ?? undefined,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma createProject failed', err, { repo: project.repoFullName });
        throw err;
      }
    }

    this.ensureLoaded();
    const newProject: Project = {
      id,
      slug,
      ownerLogin: project.ownerLogin,
      ownerId: String(project.ownerId),
      ownerAvatar: project.ownerAvatar || '',
      repoFullName: project.repoFullName,
      repoName: project.repoName,
      repoOwner: project.repoOwner,
      isPrivate: Boolean(project.isPrivate),
      joinMode: project.joinMode === 'screening' ? 'screening' : 'referral',
      screeningUrl: project.joinMode === 'screening' ? project.screeningUrl || '' : '',
      roles,
      title: project.title || project.repoName,
      description: project.description || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.data.projects.push(newProject);
    this.save();
    return newProject;
  }

  async getProjectById(id: string): Promise<Project | null> {
    if (this.isPrismaActive()) {
      try {
        const p = await prisma.project.findUnique({ where: { id } });
        if (!p) return null;
        return {
          id: p.id,
          slug: p.slug,
          ownerLogin: p.ownerLogin,
          ownerId: p.ownerId,
          ownerAvatar: p.ownerAvatar ?? undefined,
          repoFullName: p.repoFullName,
          repoName: p.repoName,
          repoOwner: p.repoOwner,
          isPrivate: p.isPrivate,
          joinMode: p.joinMode as 'referral' | 'screening',
          screeningUrl: p.screeningUrl ?? undefined,
          roles: p.roles,
          title: p.title,
          description: p.description ?? undefined,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma getProjectById failed', err, { projectId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.projects.find((p) => p.id === id) || null;
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    if (this.isPrismaActive()) {
      try {
        const p = await prisma.project.findUnique({ where: { slug } });
        if (!p) return null;
        return {
          id: p.id,
          slug: p.slug,
          ownerLogin: p.ownerLogin,
          ownerId: p.ownerId,
          ownerAvatar: p.ownerAvatar ?? undefined,
          repoFullName: p.repoFullName,
          repoName: p.repoName,
          repoOwner: p.repoOwner,
          isPrivate: p.isPrivate,
          joinMode: p.joinMode as 'referral' | 'screening',
          screeningUrl: p.screeningUrl ?? undefined,
          roles: p.roles,
          title: p.title,
          description: p.description ?? undefined,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma getProjectBySlug failed', err, { slug });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.projects.find((p) => p.slug === slug) || null;
  }

  async getProjectsByOwner(ownerLogin: string): Promise<Project[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.project.findMany({
          where: { ownerLogin: { equals: ownerLogin, mode: 'insensitive' } },
          orderBy: { createdAt: 'desc' },
        });
        return list.map((p) => ({
          id: p.id,
          slug: p.slug,
          ownerLogin: p.ownerLogin,
          ownerId: p.ownerId,
          ownerAvatar: p.ownerAvatar ?? undefined,
          repoFullName: p.repoFullName,
          repoName: p.repoName,
          repoOwner: p.repoOwner,
          isPrivate: p.isPrivate,
          joinMode: p.joinMode as 'referral' | 'screening',
          screeningUrl: p.screeningUrl ?? undefined,
          roles: p.roles,
          title: p.title,
          description: p.description ?? undefined,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        }));
      } catch (err) {
        logger.error('Prisma getProjectsByOwner failed', err, { ownerLogin });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.projects.filter(
      (p) => p.ownerLogin.toLowerCase() === String(ownerLogin).toLowerCase()
    );
  }

  async listProjects(): Promise<Project[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
        return list.map((p) => ({
          id: p.id,
          slug: p.slug,
          ownerLogin: p.ownerLogin,
          ownerId: p.ownerId,
          ownerAvatar: p.ownerAvatar ?? undefined,
          repoFullName: p.repoFullName,
          repoName: p.repoName,
          repoOwner: p.repoOwner,
          isPrivate: p.isPrivate,
          joinMode: p.joinMode as 'referral' | 'screening',
          screeningUrl: p.screeningUrl ?? undefined,
          roles: p.roles,
          title: p.title,
          description: p.description ?? undefined,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        }));
      } catch (err) {
        logger.error('Prisma listProjects failed', err);
        throw err;
      }
    }

    this.ensureLoaded();
    return [...this.data.projects];
  }

  // --- Applicants ---
  async createApplicant(applicant: {
    projectId: string;
    userId: string | number;
    userLogin: string;
    userAvatar?: string;
    accountAge: string;
    publicRepoCount: number;
    message?: string;
  }): Promise<Applicant> {
    const id = `app_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const userId = String(applicant.userId);

    if (this.isPrismaActive()) {
      try {
        const created = await prisma.applicant.create({
          data: {
            id,
            projectId: applicant.projectId,
            userId,
            userLogin: applicant.userLogin,
            userAvatar: applicant.userAvatar || null,
            accountAge: applicant.accountAge || 'Unknown',
            publicRepoCount: Number(applicant.publicRepoCount) || 0,
            message: applicant.message || null,
            status: 'pending',
            invitationSent: false,
          },
        });
        return {
          id: created.id,
          projectId: created.projectId,
          userId: created.userId,
          userLogin: created.userLogin,
          userAvatar: created.userAvatar ?? undefined,
          accountAge: created.accountAge,
          publicRepoCount: created.publicRepoCount,
          message: created.message ?? undefined,
          status: created.status as 'pending' | 'approved' | 'rejected',
          invitationSent: created.invitationSent,
          invitationDetails: created.invitationDetails,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma createApplicant failed', err, { projectId: applicant.projectId, userId });
        throw err;
      }
    }

    this.ensureLoaded();
    const newApplicant: Applicant = {
      id,
      projectId: applicant.projectId,
      userId,
      userLogin: applicant.userLogin,
      userAvatar: applicant.userAvatar || '',
      accountAge: applicant.accountAge || 'Unknown',
      publicRepoCount: Number(applicant.publicRepoCount) || 0,
      message: applicant.message || '',
      status: 'pending',
      invitationSent: false,
      invitationDetails: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.data.applicants.push(newApplicant);
    this.save();
    return newApplicant;
  }

  async getApplicantById(id: string): Promise<Applicant | null> {
    if (this.isPrismaActive()) {
      try {
        const a = await prisma.applicant.findUnique({ where: { id } });
        if (!a) return null;
        return {
          id: a.id,
          projectId: a.projectId,
          userId: a.userId,
          userLogin: a.userLogin,
          userAvatar: a.userAvatar ?? undefined,
          accountAge: a.accountAge,
          publicRepoCount: a.publicRepoCount,
          message: a.message ?? undefined,
          status: a.status as 'pending' | 'approved' | 'rejected',
          invitationSent: a.invitationSent,
          invitationDetails: a.invitationDetails,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma getApplicantById failed', err, { applicantId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.applicants.find((a) => a.id === id) || null;
  }

  async getApplicantsByProject(projectId: string): Promise<Applicant[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.applicant.findMany({
          where: { projectId },
          orderBy: { createdAt: 'desc' },
        });
        return list.map((a) => ({
          id: a.id,
          projectId: a.projectId,
          userId: a.userId,
          userLogin: a.userLogin,
          userAvatar: a.userAvatar ?? undefined,
          accountAge: a.accountAge,
          publicRepoCount: a.publicRepoCount,
          message: a.message ?? undefined,
          status: a.status as 'pending' | 'approved' | 'rejected',
          invitationSent: a.invitationSent,
          invitationDetails: a.invitationDetails,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        }));
      } catch (err) {
        logger.error('Prisma getApplicantsByProject failed', err, { projectId });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.applicants.filter((a) => a.projectId === projectId);
  }

  async findApplicant(projectId: string, userId: string | number): Promise<Applicant | null> {
    const uId = String(userId);

    if (this.isPrismaActive()) {
      try {
        const a = await prisma.applicant.findUnique({
          where: { projectId_userId: { projectId, userId: uId } },
        });
        if (!a) return null;
        return {
          id: a.id,
          projectId: a.projectId,
          userId: a.userId,
          userLogin: a.userLogin,
          userAvatar: a.userAvatar ?? undefined,
          accountAge: a.accountAge,
          publicRepoCount: a.publicRepoCount,
          message: a.message ?? undefined,
          status: a.status as 'pending' | 'approved' | 'rejected',
          invitationSent: a.invitationSent,
          invitationDetails: a.invitationDetails,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma findApplicant failed', err, { projectId, userId: uId });
        throw err;
      }
    }

    this.ensureLoaded();
    return (
      this.data.applicants.find(
        (a) => a.projectId === projectId && a.userId === uId
      ) || null
    );
  }

  async updateApplicantStatus(
    id: string,
    status: 'pending' | 'approved' | 'rejected',
    details: unknown = null
  ): Promise<Applicant | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.applicant.update({
          where: { id },
          data: {
            status,
            invitationSent: status === 'approved',
            invitationDetails: details ? (details as object) : undefined,
          },
        });
        return {
          id: updated.id,
          projectId: updated.projectId,
          userId: updated.userId,
          userLogin: updated.userLogin,
          userAvatar: updated.userAvatar ?? undefined,
          accountAge: updated.accountAge,
          publicRepoCount: updated.publicRepoCount,
          message: updated.message ?? undefined,
          status: updated.status as 'pending' | 'approved' | 'rejected',
          invitationSent: updated.invitationSent,
          invitationDetails: updated.invitationDetails,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma updateApplicantStatus failed', err, { applicantId: id, status });
        throw err;
      }
    }

    this.ensureLoaded();
    const applicant = await this.getApplicantById(id);
    if (!applicant) return null;

    applicant.status = status;
    applicant.updatedAt = new Date().toISOString();
    if (status === 'approved') {
      applicant.invitationSent = true;
      applicant.invitationDetails = details;
    }
    this.save();
    return applicant;
  }

  // --- Drafts ---
  async createDraft(draft: {
    projectId: string;
    platformId: string;
    text: string;
  }): Promise<Draft> {
    const id = `drf_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

    if (this.isPrismaActive()) {
      try {
        const created = await prisma.draft.create({
          data: {
            id,
            projectId: draft.projectId,
            platformId: draft.platformId,
            text: draft.text,
            status: 'drafted',
          },
        });
        return {
          id: created.id,
          projectId: created.projectId,
          platformId: created.platformId,
          text: created.text,
          status: created.status as DraftStatus,
          approvedText: created.approvedText ?? undefined,
          approvedHash: created.approvedHash ?? undefined,
          approvedAt: created.approvedAt ? created.approvedAt.toISOString() : undefined,
          approvedBy: created.approvedBy ?? undefined,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma createDraft failed', err, { projectId: draft.projectId });
        throw err;
      }
    }

    this.ensureLoaded();
    const newDraft: Draft = {
      id,
      projectId: draft.projectId,
      platformId: draft.platformId,
      text: draft.text,
      status: 'drafted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.data.drafts.push(newDraft);
    this.save();
    return newDraft;
  }

  async getDraftsByProject(projectId: string): Promise<Draft[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.draft.findMany({
          where: { projectId },
          orderBy: { createdAt: 'desc' },
        });
        return list.map((d) => ({
          id: d.id,
          projectId: d.projectId,
          platformId: d.platformId,
          text: d.text,
          status: d.status as DraftStatus,
          approvedText: d.approvedText ?? undefined,
          approvedHash: d.approvedHash ?? undefined,
          approvedAt: d.approvedAt ? d.approvedAt.toISOString() : undefined,
          approvedBy: d.approvedBy ?? undefined,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        }));
      } catch (err) {
        logger.error('Prisma getDraftsByProject failed', err, { projectId });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.drafts.filter((d) => d.projectId === projectId);
  }

  async getDraftById(id: string): Promise<Draft | null> {
    if (this.isPrismaActive()) {
      try {
        const d = await prisma.draft.findUnique({ where: { id } });
        if (!d) return null;
        return {
          id: d.id,
          projectId: d.projectId,
          platformId: d.platformId,
          text: d.text,
          status: d.status as DraftStatus,
          approvedText: d.approvedText ?? undefined,
          approvedHash: d.approvedHash ?? undefined,
          approvedAt: d.approvedAt ? d.approvedAt.toISOString() : undefined,
          approvedBy: d.approvedBy ?? undefined,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma getDraftById failed', err, { id });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.drafts.find((d) => d.id === id) || null;
  }

  async updateDraft(id: string, text: string): Promise<Draft | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.draft.update({
          where: { id },
          data: {
            text: text.slice(0, 10000),
            status: 'edited',
            approvedText: null,
            approvedHash: null,
            approvedAt: null,
            approvedBy: null,
          },
        });
        return {
          id: updated.id,
          projectId: updated.projectId,
          platformId: updated.platformId,
          text: updated.text,
          status: 'edited',
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma updateDraft failed', err, { id });
        throw err;
      }
    }

    this.ensureLoaded();
    const draft = this.data.drafts.find((d) => d.id === id);
    if (!draft) return null;
    draft.text = text.slice(0, 10000);
    draft.status = 'edited';
    delete draft.approvedText;
    delete draft.approvedHash;
    delete draft.approvedAt;
    delete draft.approvedBy;
    draft.updatedAt = new Date().toISOString();
    this.save();
    return draft;
  }

  async approveDraft(id: string, approvedBy: string): Promise<Draft | null> {
    const draft = await this.getDraftById(id);
    if (!draft) return null;

    const approvedHash = crypto.createHash('sha256').update(draft.text).digest('hex');
    const now = new Date();

    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.draft.update({
          where: { id },
          data: {
            status: 'approved',
            approvedText: draft.text,
            approvedHash,
            approvedAt: now,
            approvedBy,
          },
        });
        return {
          id: updated.id,
          projectId: updated.projectId,
          platformId: updated.platformId,
          text: updated.text,
          status: 'approved',
          approvedText: updated.approvedText ?? undefined,
          approvedHash: updated.approvedHash ?? undefined,
          approvedAt: updated.approvedAt ? updated.approvedAt.toISOString() : undefined,
          approvedBy: updated.approvedBy ?? undefined,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma approveDraft failed', err, { id });
        throw err;
      }
    }

    draft.status = 'approved';
    draft.approvedText = draft.text;
    draft.approvedHash = approvedHash;
    draft.approvedAt = now.toISOString();
    draft.approvedBy = approvedBy;
    draft.updatedAt = now.toISOString();
    this.save();
    return draft;
  }

  async skipDraft(id: string): Promise<Draft | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.draft.update({
          where: { id },
          data: { status: 'skipped' },
        });
        return {
          id: updated.id,
          projectId: updated.projectId,
          platformId: updated.platformId,
          text: updated.text,
          status: 'skipped',
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma skipDraft failed', err, { id });
        throw err;
      }
    }

    this.ensureLoaded();
    const draft = this.data.drafts.find((d) => d.id === id);
    if (!draft) return null;
    draft.status = 'skipped';
    draft.updatedAt = new Date().toISOString();
    this.save();
    return draft;
  }
}

export const storage = new Storage();
export default storage;
