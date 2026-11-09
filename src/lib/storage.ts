import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config/index';
import type { User, Project, Applicant, Session } from '../types/index';

interface StorageData {
  projects: Project[];
  applicants: Applicant[];
  users: Record<string, User>;
  sessions: Record<string, Session>;
}

export class Storage {
  private filePath: string;
  private data: StorageData;
  private initialized = false;

  constructor(filePath = config.dataFile) {
    this.filePath = filePath;
    this.data = {
      projects: [],
      applicants: [],
      users: {},
      sessions: {},
    };
    this.ensureLoaded();
  }

  ensureLoaded(): void {
    if (this.initialized) return;
    try {
      if (this.filePath && fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          projects: parsed.projects || [],
          applicants: parsed.applicants || [],
          users: parsed.users || {},
          sessions: parsed.sessions || {},
        };
      } else if (this.filePath) {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this.save();
      }
    } catch {
      this.data = { projects: [], applicants: [], users: {}, sessions: {} };
    }
    this.initialized = true;
  }

  save(): void {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Storage save failed:', msg);
    }
  }

  reset(): void {
    this.data = {
      projects: [],
      applicants: [],
      users: {},
      sessions: {},
    };
    this.save();
  }

  // --- Users ---
  saveUser(user: Partial<User> & { id: string | number; login: string }): User {
    this.ensureLoaded();
    const id = String(user.id);
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

  getUser(userId: string | number): User | null {
    this.ensureLoaded();
    return this.data.users[String(userId)] || null;
  }

  // --- Sessions ---
  createSession(userId: string | number, maxAgeMs = 7 * 24 * 60 * 60 * 1000): string {
    this.ensureLoaded();
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + maxAgeMs;
    this.data.sessions[sessionId] = {
      userId: String(userId),
      expiresAt,
      createdAt: new Date().toISOString(),
    };
    this.save();
    return sessionId;
  }

  getSession(sessionId?: string): { sessionId: string; user: User } | null {
    this.ensureLoaded();
    if (!sessionId) return null;
    const session = this.data.sessions[sessionId];
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      delete this.data.sessions[sessionId];
      this.save();
      return null;
    }
    const user = this.getUser(session.userId);
    return user ? { sessionId, user } : null;
  }

  deleteSession(sessionId: string): void {
    this.ensureLoaded();
    if (sessionId && this.data.sessions[sessionId]) {
      delete this.data.sessions[sessionId];
      this.save();
    }
  }

  // --- Projects ---
  createProject(project: {
    ownerLogin: string;
    ownerId: string | number;
    ownerAvatar?: string;
    repoFullName: string;
    repoName: string;
    repoOwner: string;
    isPrivate?: boolean;
    joinMode?: 'referral' | 'screening';
    screeningUrl?: string;
    title?: string;
    description?: string;
  }): Project {
    this.ensureLoaded();
    const id = `prj_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

    const baseSlug = (project.repoName || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
    const slug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;

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
      screeningUrl: project.joinMode === 'screening' ? (project.screeningUrl || '') : '',
      title: project.title || project.repoName,
      description: project.description || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.data.projects.push(newProject);
    this.save();
    return newProject;
  }

  getProjectById(id: string): Project | null {
    this.ensureLoaded();
    return this.data.projects.find((p) => p.id === id) || null;
  }

  getProjectBySlug(slug: string): Project | null {
    this.ensureLoaded();
    return this.data.projects.find((p) => p.slug === slug) || null;
  }

  getProjectsByOwner(ownerLogin: string): Project[] {
    this.ensureLoaded();
    return this.data.projects.filter(
      (p) => p.ownerLogin.toLowerCase() === String(ownerLogin).toLowerCase()
    );
  }

  listProjects(): Project[] {
    this.ensureLoaded();
    return [...this.data.projects];
  }

  // --- Applicants ---
  createApplicant(applicant: {
    projectId: string;
    userId: string | number;
    userLogin: string;
    userAvatar?: string;
    accountAge: string;
    publicRepoCount: number;
    message?: string;
  }): Applicant {
    this.ensureLoaded();
    const id = `app_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const newApplicant: Applicant = {
      id,
      projectId: applicant.projectId,
      userId: String(applicant.userId),
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

  getApplicantById(id: string): Applicant | null {
    this.ensureLoaded();
    return this.data.applicants.find((a) => a.id === id) || null;
  }

  getApplicantsByProject(projectId: string): Applicant[] {
    this.ensureLoaded();
    return this.data.applicants.filter((a) => a.projectId === projectId);
  }

  findApplicant(projectId: string, userId: string | number): Applicant | null {
    this.ensureLoaded();
    return (
      this.data.applicants.find(
        (a) => a.projectId === projectId && String(a.userId) === String(userId)
      ) || null
    );
  }

  updateApplicantStatus(
    id: string,
    status: 'pending' | 'approved' | 'rejected',
    details: unknown = null
  ): Applicant | null {
    this.ensureLoaded();
    const applicant = this.getApplicantById(id);
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
}

export const storage = new Storage();
export default storage;
