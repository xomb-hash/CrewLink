import storage from '../lib/storage';
import type { Campaign, CampaignAnalytics } from './types';

// Crewlink has no platform analytics API integrated, so only publication state
// from its own records is counted. Everything else is listed as unavailable
// rather than estimated.
export const ANALYTICS_UNAVAILABLE = [
  'impressions',
  'reach',
  'likes',
  'comments',
  'shares',
  'clicks',
  'engagement',
];

export const ANALYTICS_NOTE =
  'Counts come only from Crewlink publication records for this campaign. Engagement metrics are not collected because no official platform analytics API is connected, so no engagement-based recommendation is made.';

export async function collectCampaignAnalytics(
  campaign: Campaign
): Promise<CampaignAnalytics> {
  const generated = await storage.getGeneratedPosts(campaign.id);
  const schedules = await storage.getCampaignSchedules(campaign.id);
  const byPlatform: Record<string, number> = {};
  for (const platformId of campaign.platforms) byPlatform[platformId] = 0;

  let publishedPosts = 0;
  let failedPosts = 0;
  for (const post of generated) {
    const draft = await storage.getDraftById(post.draftId);
    if (!draft) continue;
    const publication = await storage.getPublication(draft.id, draft.platformId);
    if (!publication) continue;
    if (publication.status === 'published') {
      publishedPosts += 1;
      byPlatform[draft.platformId] = (byPlatform[draft.platformId] || 0) + 1;
    } else if (publication.status === 'failed') {
      failedPosts += 1;
    }
  }

  return storage.upsertCampaignAnalytics({
    campaignId: campaign.id,
    projectId: campaign.projectId,
    metrics: {
      publishedPosts,
      failedPosts,
      // Every schedule row is a planned post, including rows flagged as conflicts.
      scheduledPosts: schedules.length,
      byPlatform,
    },
    unavailable: ANALYTICS_UNAVAILABLE,
    note: ANALYTICS_NOTE,
  });
}
