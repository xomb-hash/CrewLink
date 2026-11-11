// Canonical metric vocabulary shared by storage, the sync engine, the API and
// the UI. Adding a metric here requires a platform mapping and a label; nothing
// is inferred from a metric name that a platform did not return.
export const METRIC_KEYS = [
  'impressions',
  'reach',
  'likes',
  'comments',
  'reposts',
  'quotes',
  'saves',
  'clicks',
  'videoViews',
  // Reddit's net score is not a like count, so it keeps its own key.
  'score',
  'followers',
  'subscribers',
  'posts',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS: Record<MetricKey, string> = {
  impressions: 'Impressions',
  reach: 'Reach',
  likes: 'Likes / reactions',
  comments: 'Comments / replies',
  reposts: 'Reposts / shares',
  quotes: 'Quotes',
  saves: 'Saves / bookmarks',
  clicks: 'Link clicks',
  videoViews: 'Video views',
  score: 'Score (net upvotes)',
  followers: 'Followers',
  subscribers: 'Subscribers',
  posts: 'Account posts',
};

export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === 'string' && (METRIC_KEYS as readonly string[]).includes(value);
}
