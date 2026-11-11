// M8 AI workspace domain types. These records never contain platform tokens,
// decrypted credentials or approval hashes; they describe generated material
// that still has to pass the existing approval and publishing gates.

export type CampaignStatus =
  | 'queued'
  | 'running'
  | 'ready'
  | 'partial'
  | 'failed';

export type CampaignTaskKind =
  | 'research'
  | 'strategy'
  | 'generation'
  | 'quality'
  | 'scheduling';

export type CampaignTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface CampaignTask {
  id: string;
  campaignId: string;
  kind: CampaignTaskKind;
  status: CampaignTaskStatus;
  // Human-readable progress. Never contains prompts, tokens or draft text.
  detail?: string;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// A source is only listed when a configured research API returned it or the
// owner supplied it. Model-authored links are rejected rather than stored.
export type ResearchSourceProvider = 'brave' | 'reddit' | 'owner';

export interface ResearchSource {
  id: string;
  campaignId: string;
  title: string;
  url: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt: string;
  summary?: string;
  provider: ResearchSourceProvider;
  // true only when a configured search API returned the result.
  verified: boolean;
}

export interface ResearchFinding {
  statement: string;
  sourceUrls: string[];
  // Findings that cite no retrieved source stay labelled as unverified.
  verified: boolean;
}

export type ResearchSearchStatus = 'ok' | 'not_configured' | 'failed' | 'empty';

export interface ResearchResult {
  summary: string;
  findings: ResearchFinding[];
  opportunities: string[];
  assumptions: string[];
  search: {
    status: ResearchSearchStatus;
    providers: string[];
    message?: string;
  };
  generatedAt: string;
}

export interface Campaign {
  id: string;
  projectId: string;
  // User.id of the owner who created the campaign.
  ownerId: string;
  brief: string;
  name: string;
  objective: string;
  audience: string;
  platforms: string[];
  durationDays: number;
  // IANA timezone used only for scheduling recommendations.
  timezone: string;
  // YYYY-MM-DD. Empty until a strategy proposes a start date.
  startDate: string;
  redditSubreddit?: string;
  themes: string[];
  postingFrequency: string;
  desiredOutcomes: string[];
  status: CampaignStatus;
  strategyNotes?: string;
  research?: ResearchResult;
  createdAt: string;
  updatedAt: string;
}

export interface BrandProfile {
  id: string;
  projectId: string;
  brandName: string;
  description: string;
  audience: string;
  tone: string;
  vocabulary: string[];
  style: string;
  avoidTopics: string[];
  avoidWords: string[];
  ctas: string[];
  examplePosts: string[];
  createdAt: string;
  updatedAt: string;
}

export type ContentIdeaStatus = 'planned' | 'generated' | 'partial' | 'skipped' | 'failed';

export interface ContentIdea {
  id: string;
  campaignId: string;
  day: number;
  platformId: string;
  topic: string;
  angle: string;
  status: ContentIdeaStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export type ScheduleStatus = 'suggested' | 'scheduled' | 'conflict';
export type ScheduleSource = 'ai' | 'manual';

export interface CampaignSchedule {
  id: string;
  campaignId: string;
  draftId: string;
  platformId: string;
  scheduledFor: string;
  timezone: string;
  status: ScheduleStatus;
  reason?: string;
  source: ScheduleSource;
  createdAt: string;
  updatedAt: string;
}

export type QualityVerificationStatus = 'unverified';

export interface QualityIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  sourceUrls?: string[];
}

// A model score is advisory only. `verificationStatus` is always 'unverified'
// and the UI must show the disclaimer alongside the number.
export interface QualityResult {
  score: number;
  verificationStatus: QualityVerificationStatus;
  disclaimer: string;
  issues: QualityIssue[];
  improvements: string[];
  sourceUrls: string[];
  // Link verification is not attempted, so this is always 'not_checked'.
  linkCheck: 'not_checked';
  checkedAt: string;
  provider: string;
  model: string;
}

export interface GeneratedPost {
  id: string;
  campaignId: string;
  ideaId: string;
  draftId: string;
  platformId: string;
  variationIndex: number;
  quality?: QualityResult;
  createdAt: string;
  updatedAt: string;
}

export type AgentExecutionStatus = 'completed' | 'failed' | 'skipped';

export interface AgentExecution {
  id: string;
  campaignId: string;
  projectId: string;
  userId: string;
  stage: CampaignTaskKind | 'provider';
  provider: string;
  model: string;
  status: AgentExecutionStatus;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  // Only set when the provider's published pricing is known.
  costMicros?: number;
  latencyMs: number;
  errorCode?: string;
  createdAt: string;
}

// Only metrics that a connected official API actually returned are stored.
// Unsupported metrics are listed as unavailable instead of being invented.
export interface CampaignAnalytics {
  id: string;
  campaignId: string;
  projectId: string;
  metrics: {
    publishedPosts: number;
    failedPosts: number;
    scheduledPosts: number;
    byPlatform: Record<string, number>;
  };
  unavailable: string[];
  collectedAt: string;
  note: string;
}

export interface AiProviderStatus {
  provider: string;
  model: string;
  configured: boolean;
  researchProvider: string;
  researchConfigured: boolean;
}

export interface CampaignDetail {
  campaign: Campaign;
  tasks: CampaignTask[];
  sources: ResearchSource[];
  ideas: ContentIdea[];
  generated: GeneratedPost[];
  schedules: CampaignSchedule[];
  executions: AgentExecution[];
  analytics: CampaignAnalytics | null;
}
