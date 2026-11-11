export type JoinMode = 'referral' | 'screening' | 'direct';

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

// Owner-editable referral settings from the Manage dialog. Both are optional:
// null/undefined means "no limit" or "never expires".
export interface ReferralSettings {
  usageLimit?: number | null;
  expiresAt?: string | null;
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
  // One reusable invite per private project: shown only to the owner.
  // usageUsedAt is legacy from single-use codes and kept for old records.
  referralCode?: string;
  referralCodeCreatedAt?: string;
  referralCodeExpiresAt?: string;
  referralCodeUsageLimit?: number;
  referralCodeRevokedAt?: string;
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
  // The invite code this application came through, used for usage counts.
  referralCode?: string;
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
  // X threads only: each entry is one post. `text` remains the canonical joined
  // value so approval, hashing and duplicate checks keep working unchanged.
  threadParts?: string[];
  // Reddit only: a submission is defined by these fields as well as the body.
  title?: string;
  subreddit?: string;
  submissionType?: 'self' | 'link';
  linkUrl?: string;
  // Set only when the draft came from an M8 AI campaign. Publishing ignores it.
  campaignId?: string;
  contentIdeaId?: string;
  status: DraftStatus;
  approvedText?: string;
  approvedHash?: string;
  approvedAt?: string;
  approvedBy?: string;
  checks?: DraftCheck[];
  createdAt: string;
  updatedAt: string;
}

// How Crewlink gets permission to post for one platform.
// oauth: the creator authorises Crewlink for their own account.
// bot: the creator adds Crewlink's official bot/app to their channel or server.
// manual: Crewlink writes the draft and the creator posts it by hand.
export type PlatformAuth = 'oauth' | 'bot' | 'manual';

export interface Platform {
  id: string;
  name: string;
  characterLimit: number;
  mode: 'auto' | 'manual';
  count?: 'characters' | 'graphemes';
  // Platforms with a separate title field (Reddit) report its limit here.
  titleLimit?: number;
  note?: string;
  auth: PlatformAuth;
  // Platforms that stay off until the owner deliberately turns them on.
  defaultEnabled?: boolean;
  // Cost warning shown before publishing (X charges per post).
  costNote?: string;
}

// A stored connection after tokens have been encrypted. Never returned to a client.
// Bot connections have no per-connection token because the bot token is
// application-level (secret store), hence provider 'none' and empty token fields.
export interface StoredPlatformConnection extends PlatformConnection {
  accessTokenCiphertext: string;
  refreshTokenCiphertext?: string;
  credentialProvider: 'local' | 'gcp' | 'none';
  keyRef: string;
  // Mastodon OAuth handshake. The state itself is never stored, only its hash.
  oauthStateHash?: string;
  oauthStateExpiresAt?: string;
  pendingOAuthCiphertext?: string;
}

export type PlatformConnectionStatus = 'pending' | 'active' | 'disconnected';

// Safe connection summary: contains no token material. The API only ever returns this shape.
export interface PlatformConnection {
  id: string;
  userId: string;
  projectId: string;
  platformId: string;
  externalAccountId?: string;
  externalAccountName?: string;
  // Discord server (guild) the selected channel belongs to.
  serverId?: string;
  serverName?: string;
  channelId?: string;
  channelName?: string;
  // Normalized origin for creator-owned fediverse accounts (Mastodon).
  instanceUrl?: string;
  status: PlatformConnectionStatus;
  scopes: string[];
  tokenExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicationStatus =
  | 'sending'
  | 'published'
  | 'failed'
  // WhatsApp has no official publishing API. These two states record that the
  // owner prepared a share link and optionally opened WhatsApp; neither claims
  // that a message was sent or delivered.
  | 'prepared'
  | 'opened';

// `api` means X confirmed the post and returned ids. `manual` means the owner
// posted by hand and Crewlink only records their statement; it is not verified.
export type PublicationMode = 'api' | 'manual';

// One attempt/record per draft and platform. No token or message body is stored here.
export interface Publication {
  id: string;
  userId: string;
  projectId: string;
  draftId: string;
  // Manual publications have no platform connection.
  connectionId?: string;
  platformId: string;
  status: PublicationStatus;
  mode: PublicationMode;
  contentHash: string;
  externalId?: string;
  // Every post id for a thread, in order. Empty for manual publications.
  externalIds: string[];
  // Owner-facing destination and permalink. Reddit uses targetName for the
  // subreddit and externalUrl for the submission permalink.
  targetName?: string;
  externalUrl?: string;
  errorCode?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type UsageEntryStatus = 'reserved' | 'committed' | 'released';

// One row per publication attempt that could incur an X charge. Prices are
// stored with the entry so later price changes cannot rewrite history.
export interface UsageLedgerEntry {
  id: string;
  userId: string;
  projectId: string;
  draftId: string;
  publicationId: string;
  platformId: string;
  mode: PublicationMode;
  requestCount: number;
  costMicros: number;
  currency: string;
  status: UsageEntryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  userId: string;
  expiresAt: number;
  createdAt: string;
}
