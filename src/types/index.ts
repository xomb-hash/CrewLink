export type JoinMode = 'referral' | 'screening';

export type ApplicantStatus = 'pending' | 'approved' | 'rejected';

export interface User {
  id: string | number;
  login: string;
  name?: string;
  avatarUrl?: string;
  createdAt?: string;
  publicRepos?: number;
  accessToken?: string;
  updatedAt?: string;
}

export interface ShareLinks {
  joinUrl: string;
  linkedIn: string;
  x: string;
  whatsApp: string;
}

export interface Project {
  id: string;
  slug: string;
  ownerLogin: string;
  ownerId: string;
  ownerAvatar?: string;
  repoFullName: string;
  repoName: string;
  repoOwner: string;
  isPrivate: boolean;
  joinMode: JoinMode;
  screeningUrl?: string;
  screeningNote?: string;
  roles?: string[];
  title: string;
  description?: string;
  creatorNote?: string;
  requireResume?: boolean;
  requireGithubLink?: boolean;
  requireLinkedinLink?: boolean;
  referralCode?: string;
  referralCodeCreatedAt?: string;
  referralCodeUsedAt?: string;
  logoPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExploreProject extends Project {
  applicantsCount: number;
  joinUrl: string;
}

export interface UserApplication extends Applicant {
  project: Project;
}

export interface Applicant {
  id: string;
  projectId: string;
  userId: string;
  userLogin: string;
  userAvatar?: string;
  accountAge: string;
  publicRepoCount: number;
  message?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  proofUrl?: string;
  resumeFileName?: string;
  resumePath?: string;
  status: ApplicantStatus;
  invitationSent: boolean;
  invitationDetails?: unknown;
  createdAt: string;
  updatedAt: string;
}

export type DraftStatus = 'drafted' | 'edited' | 'approved' | 'skipped';

export interface DraftCheck {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface Draft {
  id: string;
  projectId: string;
  platformId: string;
  text: string;
  status: DraftStatus;
  approvedText?: string;
  approvedHash?: string;
  approvedAt?: string;
  approvedBy?: string;
  checks?: DraftCheck[];
  createdAt: string;
  updatedAt: string;
}

export interface Platform {
  id: string;
  name: string;
  characterLimit: number;
  mode: 'auto' | 'manual';
  count?: 'characters' | 'graphemes';
  note?: string;
}


export interface Session {
  userId: string;
  expiresAt: number;
  createdAt: string;
}
