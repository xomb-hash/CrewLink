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
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
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
  status: ApplicantStatus;
  invitationSent: boolean;
  invitationDetails?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  userId: string;
  expiresAt: number;
  createdAt: string;
}
