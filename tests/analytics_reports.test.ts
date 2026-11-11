import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { storage } from '../src/lib/storage';
import {
  buildAnalyticsReport,
  buildReportCsv,
  buildReportPdf,
  reportFilename,
} from '../src/analytics/reports';
import { resolveAnalyticsRange } from '../src/analytics/range';

const range = resolveAnalyticsRange({ from: '2026-11-01', to: '2026-11-10', timezone: 'UTC' });

async function seedProject(label: string) {
  const owner = await storage.saveUser({ id: 9801, login: `${label}-owner` });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: `${label}-owner/rocket`,
    repoName: 'rocket',
    repoOwner: `${label}-owner`,
    title: 'Rocket "launch", report',
  });
  return { owner, project };
}

test('CSV reports are sectioned, escaped and never claim unavailable data', async () => {
  storage.reset();
  const { owner, project } = await seedProject('report');
  const draft = await storage.createDraft({
    projectId: project.id,
    platformId: 'x',
    text: 'A post with a comma, a "quote" and a newline\nsecond line',
  });
  await storage.upsertAnalyticsPost({
    userId: String(owner.id),
    projectId: project.id,
    publicationId: 'pub_report_1',
    draftId: draft.id,
    platformId: 'x',
    externalUrl: 'https://x.com/i/web/status/1',
    publishedAt: '2026-11-05T10:00:00.000Z',
    contentType: 'text',
    metrics: { impressions: 1000, likes: 50, comments: 5, reposts: 2, quotes: 1, saves: 3 },
    availableMetrics: ['impressions', 'likes', 'comments', 'reposts', 'quotes', 'saves'],
    unavailableMetrics: ['clicks'],
    engagement: 61,
    engagementRate: 6.1,
    status: 'active',
  });
  await storage.upsertAnalyticsPost({
    userId: String(owner.id),
    projectId: project.id,
    publicationId: 'pub_report_2',
    draftId: draft.id,
    platformId: 'reddit',
    publishedAt: '2026-11-06T10:00:00.000Z',
    contentType: 'text',
    metrics: { score: 20, comments: 4 },
    availableMetrics: ['score', 'comments'],
    unavailableMetrics: [],
    engagement: 24,
    engagementRate: null,
    status: 'active',
  });

  const report = await buildAnalyticsReport({ project, range });
  assert.equal(report.project.title, 'Rocket "launch", report');
  assert.equal(report.overview.posts.published, 2);
  assert.equal(report.posts.length, 2);

  const csv = buildReportCsv(report);
  assert.match(csv, /^Section,Field,Value/);
  assert.match(csv, /Overview,Published posts,2/);
  assert.match(csv, /Section,Platform,Posts/);
  assert.match(csv, /Section,Published,Preview,Platform,Campaign/);
  // Commas and quotes in a preview are escaped.
  assert.match(csv, /"A post with a comma, a ""quote"" and a newline second line"/);
  assert.match(csv, /Reddit,1,24,not calculable,unavailable/);
  assert.match(csv, /Section,Limitation/);
  assert.match(csv, /Only metrics returned by official platform APIs/);
  assert.equal(csv.includes('access-token'), false);

  const filename = reportFilename(project, range, 'csv');
  assert.match(filename, /^crewlink-analytics-rocket-2026-11-01-2026-11-10\.csv$/);
});

test('PDF reports are valid, multi-section documents without external assets', async () => {
  storage.reset();
  const { owner, project } = await seedProject('report-pdf');
  for (let index = 0; index < 8; index += 1) {
    await storage.upsertAnalyticsPost({
      userId: String(owner.id),
      projectId: project.id,
      publicationId: `pub_pdf_${index}`,
      draftId: `drf_pdf_${index}`,
      platformId: 'bluesky',
      publishedAt: `2026-11-0${(index % 8) + 1}T10:00:00.000Z`,
      contentType: 'short',
      metrics: { likes: index, comments: 1 },
      availableMetrics: ['likes', 'comments'],
      unavailableMetrics: [],
      engagement: index + 1,
      engagementRate: null,
      status: 'active',
    });
  }
  const report = await buildAnalyticsReport({ project, range });
  const pdf = buildReportPdf(report);
  const text = pdf.toString('latin1');
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Type \/Catalog/);
  assert.match(text, /\/Type \/Pages/);
  assert.match(text, /\/BaseFont \/Helvetica/);
  assert.match(text, /xref/);
  assert.match(text, /trailer/);
  assert.match(text, /%%EOF\n$/);
  assert.ok(text.includes('Crewlink Analytics Report'));
  assert.ok(text.includes('Platform comparison'));
  assert.ok(text.includes('Data quality and limitations'));
  // The em dash in a project title must be sanitized for WinAnsi.
  assert.equal(text.includes('—'), false);
  assert.ok(pdf.length > 1500);
});

test('a report with no measured posts still renders explicit limitations', async () => {
  storage.reset();
  const { project } = await seedProject('report-empty');
  const report = await buildAnalyticsReport({ project, range });
  assert.equal(report.overview.posts.published, 0);
  assert.ok(report.limitations.some((line) => line.includes('No published posts')));
  const csv = buildReportCsv(report);
  assert.match(csv, /Overview,Published posts,0/);
  const pdf = buildReportPdf(report);
  assert.match(pdf.toString('latin1'), /^%PDF-1\.4/);
});


test('CSV reports neutralize spreadsheet formula injection', async () => {
  storage.reset();
  const { owner, project } = await seedProject('report-formula');
  const draft = await storage.createDraft({
    projectId: project.id,
    platformId: 'bluesky',
    text: '=HYPERLINK("https://example.test","click")',
  });
  await storage.upsertAnalyticsPost({
    userId: String(owner.id),
    projectId: project.id,
    publicationId: 'pub_formula',
    draftId: draft.id,
    platformId: 'bluesky',
    publishedAt: '2026-11-05T10:00:00.000Z',
    contentType: 'short',
    metrics: { likes: 1 },
    availableMetrics: ['likes'],
    unavailableMetrics: [],
    engagement: 1,
    engagementRate: null,
    status: 'active',
  });
  const report = await buildAnalyticsReport({ project, range });
  const csv = buildReportCsv(report);
  assert.match(csv, /'=HYPERLINK/);
  assert.equal(/,=HYPERLINK/.test(csv), false);
  assert.equal(/'=HYPERLINK/.test(csv), true);
});
