import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config/index.js';

class Storage {
  constructor(filePath = config.dataFile) {
    this.filePath = filePath;
    this.data = {
      projects: [],
      applicants: [],
      users: {},
      sessions: {}
    };
    this.initialized = false;
    this.ensureLoaded();
  }

  ensureLoaded() {
    if (this.initialized) return;
    try {
      if (this.filePath && fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          projects: parsed.projects || [],
          applicants: parsed.applicants || [],
          users: parsed.users || {},
          sessions: parsed.sessions || {}
        };
      } else if (this.filePath) {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this.save();
      }
    } catch {
      // In case of parsing error, start fresh
      this.data = { projects: [], applicants: [], users: {}, sessions: {} };
    }
    this.initialized = true;
  }

  save() {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('Storage save failed:', err.message);
    }
  }

  reset() {
    this.data = {
      projects: [],
      applicants: [],
      users: {},
      sessions: {}
    };
    this.save();
  }

  // --- Users ---
  saveUser(user) {
    this.ensureLoaded();
    const id = String(user.id);
    this.data.users[id] = {
      ...user,
      id,
      updatedAt: new Date().toISOString()
    };
    this.save();
    return this.data.users[id];
  }

  getUser(userId) {
    this.ensureLoaded();
    return this.data.users[String(userId)] || null;
  }

  // --- Sessions ---
  createSession(userId, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    this.ensureLoaded();
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + maxAgeMs;
    this.data.sessions[sessionId] = {
      userId: String(userId),
      expiresAt,
      createdAt: new Date().toISOString()
    };
    this.save();
    return sessionId;
  }

  getSession(sessionId) {
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

  deleteSession(sessionId) {
    this.ensureLoaded();
    if (sessionId && this.data.sessions[sessionId]) {
      delete this.data.sessions[sessionId];
      this.save();
    }
  }

  // --- Projects ---
  createProject(project) {
    this.ensureLoaded();
    const id = `prj_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    
    // Generate slug from repo name + 4 hex chars
    const baseSlug = (project.repoName || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
    const slug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;

    const newProject = {
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
      updatedAt: new Date().toISOString()
    };

    this.data.projects.push(newProject);
    this.save();
    return newProject;
  }

  getProjectById(id) {
    this.ensureLoaded();
    return this.data.projects.find((p) => p.id === id) || null;
  }

  getProjectBySlug(slug) {
    this.ensureLoaded();
    return this.data.projects.find((p) => p.slug === slug) || null;
  }

  getProjectsByOwner(ownerLogin) {
    this.ensureLoaded();
    return this.data.projects.filter(
      (p) => p.ownerLogin.toLowerCase() === String(ownerLogin).toLowerCase()
    );
  }

  listProjects() {
    this.ensureLoaded();
    return [...this.data.projects];
  }

  // --- Applicants ---
  createApplicant(applicant) {
    this.ensureLoaded();
    const id = `app_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const newApplicant = {
      id,
      projectId: applicant.projectId,
      userId: String(applicant.userId),
      userLogin: applicant.userLogin,
      userAvatar: applicant.userAvatar || '',
      accountAge: applicant.accountAge || 'Unknown',
      publicRepoCount: Number(applicant.publicRepoCount) || 0,
      message: applicant.message || '',
      status: 'pending', // 'pending' | 'approved' | 'rejected'
      invitationSent: false,
      invitationDetails: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.data.applicants.push(newApplicant);
    this.save();
    return newApplicant;
  }

  getApplicantById(id) {
    this.ensureLoaded();
    return this.data.applicants.find((a) => a.id === id) || null;
  }

  getApplicantsByProject(projectId) {
    this.ensureLoaded();
    return this.data.applicants.filter((a) => a.projectId === projectId);
  }

  findApplicant(projectId, userId) {
    this.ensureLoaded();
    return this.data.applicants.find(
      (a) => a.projectId === projectId && String(a.userId) === String(userId)
    ) || null;
  }

  updateApplicantStatus(id, status, details = null) {
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
