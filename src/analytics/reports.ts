import type { AnalyticsReportData, AnalyticsRange } from './types';
import type { Project } from '../types/index';
import {
  getAudience,
  getCampaignPerformance,
  getInsights,
  getOverview,
  getPostRows,
  getTiming,
  getTopContent,
  reportLimitations,
} from './queries';

export async function buildAnalyticsReport(input: {
  project: Project;
  range: AnalyticsRange;
}): Promise<AnalyticsReportData> {
  const options = { projectId: input.project.id, range: input.range };
  const [overview, posts, top, audience, timing, campaigns, insights] = await Promise.all([
    getOverview(options),
    getPostRows(options, { limit: 500, sort: 'publishedAt', order: 'desc' }),
    getTopContent(options),
    getAudience(options),
    getTiming(options),
    getCampaignPerformance(input.project.id, input.range),
    getInsights(input.project.id, undefined, 10),
  ]);
  const platformsUsed = overview.platforms
    .filter((platform) => platform.posts > 0)
    .map((platform) => platform.platformId);

  return {
    project: {
      id: input.project.id,
      title: input.project.title,
      repoFullName: input.project.repoFullName,
    },
    range: input.range,
    generatedAt: new Date().toISOString(),
    overview,
    posts: posts.rows,
    top,
    audience,
    timing,
    campaigns,
    insights,
    limitations: reportLimitations(input.range, platformsUsed),
  };
}

// --- CSV -------------------------------------------------------------------

function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'number'
        ? String(value)
        : String(value);
  // Spreadsheet formula injection: a cell beginning with =, +, -, @ or a tab
  // must not execute when the report is opened in Excel/Sheets.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(',');
}

export function buildReportCsv(report: AnalyticsReportData): string {
  const lines: string[] = [];
  lines.push(csvRow(['Section', 'Field', 'Value']));
  lines.push(csvRow(['Overview', 'Project', report.project.title]));
  lines.push(csvRow(['Overview', 'Repository', report.project.repoFullName]));
  lines.push(csvRow(['Overview', 'Range', `${report.range.from} to ${report.range.to}`]));
  lines.push(csvRow(['Overview', 'Days', report.range.days]));
  lines.push(csvRow(['Overview', 'Timezone', report.range.timezone]));
  lines.push(csvRow(['Overview', 'Generated at', report.generatedAt]));
  lines.push(csvRow(['Overview', 'Published posts', report.overview.posts.published]));
  lines.push(csvRow(['Overview', 'Posts with metrics', report.overview.posts.withMetrics]));
  lines.push(csvRow(['Overview', 'Engagement (Crewlink-calculated)', report.overview.engagement.value ?? 'unavailable']));
  lines.push(
    csvRow([
      'Overview',
      'Engagement rate (Crewlink-calculated)',
      report.overview.engagementRate ? `${report.overview.engagementRate.value}%` : 'unavailable',
    ])
  );
  for (const key of ['impressions', 'reach', 'likes', 'comments', 'reposts', 'quotes', 'saves', 'clicks', 'videoViews', 'score'] as const) {
    const aggregate = report.overview.totals[key];
    lines.push(
      csvRow(['Metrics', key, aggregate?.value ?? 'unavailable'])
    );
  }

  lines.push('');
  lines.push(
    csvRow([
      'Section',
      'Platform',
      'Posts',
      'Engagement',
      'Engagement rate %',
      'Impressions',
      'Likes',
      'Comments',
      'Reposts',
      'Saves',
      'Unavailable metrics',
    ])
  );
  for (const platform of report.overview.platforms.filter((item) => item.posts > 0)) {
    lines.push(
      csvRow([
        'Platform',
        platform.name,
        platform.posts,
        platform.engagement.value ?? 'unavailable',
        platform.engagementRate ?? 'not calculable',
        platform.metrics.impressions?.value ?? 'unavailable',
        platform.metrics.likes?.value ?? 'unavailable',
        platform.metrics.comments?.value ?? 'unavailable',
        platform.metrics.reposts?.value ?? 'unavailable',
        platform.metrics.saves?.value ?? 'unavailable',
        platform.unavailableMetrics.join(' '),
      ])
    );
  }

  lines.push('');
  lines.push(
    csvRow([
      'Section',
      'Published',
      'Preview',
      'Platform',
      'Campaign',
      'Content type',
      'Topic',
      'Engagement',
      'Engagement rate %',
      'Impressions',
      'Likes',
      'Comments',
      'Reposts',
      'Saves',
      'Status',
      'URL',
    ])
  );
  for (const post of report.posts) {
    lines.push(
      csvRow([
        'Post',
        post.publishedAt,
        post.preview,
        post.platformName,
        post.campaignName || '',
        post.contentType,
        post.topic || '',
        post.engagement ?? 'unavailable',
        post.engagementRate ?? 'not calculable',
        post.metrics.impressions ?? 'unavailable',
        post.metrics.likes ?? 'unavailable',
        post.metrics.comments ?? 'unavailable',
        post.metrics.reposts ?? 'unavailable',
        post.metrics.saves ?? 'unavailable',
        post.status,
        post.externalUrl || '',
      ])
    );
  }

  lines.push('');
  lines.push(csvRow(['Section', 'Campaign', 'Generated', 'Approved', 'Published', 'Engagement', 'Impressions']));
  for (const campaign of report.campaigns) {
    lines.push(
      csvRow([
        'Campaign',
        campaign.name,
        campaign.generated,
        campaign.approved,
        campaign.published,
        campaign.engagement.value ?? 'unavailable',
        campaign.metrics.impressions?.value ?? 'unavailable',
      ])
    );
  }

  lines.push('');
  lines.push(csvRow(['Section', 'Insight', 'Detail']));
  for (const insight of report.insights) {
    lines.push(
      csvRow(['Insight', 'Summary', insight.payload.renderedSummary || insight.payload.summary])
    );
    for (const finding of insight.payload.findings) {
      lines.push(
        csvRow(['Insight', 'Finding', finding.renderedStatement || finding.statement])
      );
      for (const fact of finding.facts) {
        lines.push(csvRow(['Insight', 'Fact', `${fact.label} = ${fact.formatted} (${fact.completeness})`]));
      }
    }
    for (const recommendation of insight.payload.recommendations) {
      lines.push(
        csvRow([
          'Insight',
          'Recommendation',
          recommendation.renderedAction || recommendation.action,
        ])
      );
    }
    lines.push(csvRow(['Insight', 'Verification', insight.payload.verificationStatus]));
  }

  lines.push('');
  lines.push(csvRow(['Section', 'Limitation']));
  for (const limitation of report.limitations) {
    lines.push(csvRow(['Limitation', limitation]));
  }
  return `${lines.join('\r\n')}\r\n`;
}

// --- PDF -------------------------------------------------------------------

// A small, dependency-free PDF writer. It uses the built-in Helvetica font and
// plain text lines; the report is intentionally text-first so it stays readable
// and does not need a rendering library. Non-Latin characters are replaced
// because the standard PDF font set cannot encode them.
const PDF_WIDTH = 595.28;
const PDF_HEIGHT = 841.89;
const PDF_MARGIN = 42;
const PDF_LINE_HEIGHT = 14;

function pdfSafe(value: unknown): string {
  return String(value ?? '')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u00d7/g, 'x')
    .replace(/\u00f7/g, '/')
    .replace(/\u0000/g, '')
    // Standard PDF fonts use WinAnsi; keep the report to safe printable ASCII.
    .replace(/[^\x20-\x7E]/g, '?');
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLine(value: string, maxChars: number): string[] {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return [''];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

interface PdfLine {
  text: string;
  heading: boolean;
}

function reportLines(report: AnalyticsReportData): PdfLine[] {
  const lines: PdfLine[] = [];
  const heading = (text: string) => lines.push({ text, heading: true });
  const body = (text: string) => lines.push({ text, heading: false });

  heading('Crewlink Analytics Report');
  body(`${report.project.title} (${report.project.repoFullName})`);
  body(`Range: ${report.range.from} to ${report.range.to} (${report.range.days} days, ${report.range.timezone})`);
  body(`Generated: ${report.generatedAt}`);
  body(
    `Published posts: ${report.overview.posts.published} | With metrics: ${report.overview.posts.withMetrics} | Engagement: ${
      report.overview.engagement.value ?? 'unavailable'
    } | Engagement rate: ${
      report.overview.engagementRate ? `${report.overview.engagementRate.value}%` : 'not calculable'
    }`
  );

  heading('Platform comparison');
  for (const platform of report.overview.platforms.filter((item) => item.posts > 0)) {
    body(
      `${platform.name}: ${platform.posts} posts, engagement ${
        platform.engagement.value ?? 'unavailable'
      }, impressions ${platform.metrics.impressions?.value ?? 'unavailable'}, rate ${
        platform.engagementRate !== null ? `${platform.engagementRate}%` : 'not calculable'
      }.`
    );
  }

  heading('Top posts by engagement');
  for (const post of report.top.byEngagement) {
    body(
      `${post.publishedAt.slice(0, 10)} | ${post.platformName} | ${post.contentType} | engagement ${
        post.engagement ?? 'unavailable'
      } | ${post.preview}`
    );
  }

  heading('Content formats');
  for (const format of report.top.formats) {
    body(
      `${format.contentType}: ${format.posts} post(s), average engagement ${
        format.averageEngagement ?? 'unavailable'
      }.`
    );
  }

  heading('Topics');
  for (const topic of report.top.topics.slice(0, 8)) {
    body(
      `${topic.topic}: ${topic.posts} post(s), average engagement ${
        topic.averageEngagement ?? 'unavailable'
      }.`
    );
  }

  heading('Posting time');
  body(report.timing.note);
  if (report.timing.sufficientData) {
    body(
      `Best observed weekday: ${report.timing.bestWeekday || 'no single weekday'}; window: ${
        report.timing.bestHourWindow || 'no single window'
      }. This is an association, not a significance test.`
    );
  }

  heading('Campaigns');
  for (const campaign of report.campaigns) {
    body(
      `${campaign.name}: generated ${campaign.generated}, approved ${campaign.approved}, published ${campaign.published}, engagement ${
        campaign.engagement.value ?? 'unavailable'
      }.`
    );
  }

  heading('AI insights (unverified, advisory)');
  if (!report.insights.length) body('No AI insight has been generated for this project yet.');
  for (const insight of report.insights) {
    body(insight.payload.renderedSummary || insight.payload.summary);
    for (const recommendation of insight.payload.recommendations) {
      body(`Recommendation: ${recommendation.renderedAction || recommendation.action}`);
    }
  }

  heading('Data quality and limitations');
  for (const limitation of report.limitations) body(limitation);

  return lines;
}

export function buildReportPdf(report: AnalyticsReportData): Buffer {
  const source = reportLines(report);
  const maxChars = 92;
  const rendered: PdfLine[] = [];
  for (const line of source) {
    const wrapped = wrapLine(pdfSafe(line.text), line.heading ? 78 : maxChars);
    for (const part of wrapped) rendered.push({ text: part, heading: line.heading });
  }

  const pages: PdfLine[][] = [];
  let page: PdfLine[] = [];
  let used = PDF_MARGIN;
  for (const line of rendered) {
    const step = line.heading ? PDF_LINE_HEIGHT + 4 : PDF_LINE_HEIGHT;
    if (used + step > PDF_HEIGHT - PDF_MARGIN && page.length) {
      pages.push(page);
      page = [];
      used = PDF_MARGIN;
    }
    page.push(line);
    used += step;
  }
  if (page.length) pages.push(page);

  const objects: string[] = [];
  // 1 catalog, 2 pages, 3 font; pages and content follow.
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  let nextId = 4;
  for (let index = 0; index < pages.length; index += 1) {
    pageObjectIds.push(nextId++);
    contentObjectIds.push(nextId++);
  }

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds
    .map((id) => `${id} 0 R`)
    .join(' ')}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;

  pages.forEach((lines, index) => {
    const pageId = pageObjectIds[index];
    const contentId = contentObjectIds[index];
    let y = PDF_HEIGHT - PDF_MARGIN;
    const commands: string[] = ['BT'];
    for (const line of lines) {
      const size = line.heading ? 13 : 10;
      commands.push(`/F1 ${size} Tf`);
      commands.push(`1 0 0 1 ${PDF_MARGIN} ${y.toFixed(2)} Tm`);
      commands.push(`(${escapePdfText(line.text)}) Tj`);
      y -= line.heading ? PDF_LINE_HEIGHT + 4 : PDF_LINE_HEIGHT;
    }
    commands.push('ET');
    const stream = commands.join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  const chunks: Buffer[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (value: string) => {
    const buffer = Buffer.from(value, 'latin1');
    chunks.push(buffer);
    length += buffer.length;
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = length;
    push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
  }
  const xrefOffset = length;
  const maxId = objects.length;
  push(`xref\n0 ${maxId}\n`);
  push('0000000000 65535 f \n');
  for (let id = 1; id < maxId; id += 1) {
    const offset = offsets[id] ?? 0;
    push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${maxId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );
  return Buffer.concat(chunks);
}

export function reportFilename(
  project: Project,
  range: AnalyticsRange,
  extension: 'csv' | 'pdf'
): string {
  const slug = (project.repoName || project.title || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';
  return `crewlink-analytics-${slug}-${range.from}-${range.to}.${extension}`;
}
