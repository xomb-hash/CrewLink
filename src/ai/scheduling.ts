import { AiValidationError } from './errors';
import type {
  Campaign,
  CampaignSchedule,
  ContentIdea,
  GeneratedPost,
  ScheduleStatus,
} from './types';

const GLOBAL_GAP_MINUTES = 30;
const DEFAULT_START_MINUTES = 9 * 60;
const PLATFORM_STEP_MINUTES = 90;

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function zonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Convert a wall-clock time in an IANA zone to UTC without a date library.
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  if (!isValidDateString(date) || !isValidTimeZone(timeZone)) {
    throw new AiValidationError('A valid date and IANA timezone are required.');
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    throw new AiValidationError('A valid local time is required.');
  }
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = wall - offsetMs(new Date(guess), timeZone);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

export function todayInZone(timeZone: string, now = new Date()): string {
  const parts = zonedParts(now, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(
    parts.day
  ).padStart(2, '0')}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function minutesToTime(minutes: number): string {
  const bounded = Math.max(0, Math.min(23 * 60 + 30, minutes));
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(
    2,
    '0'
  )}`;
}

export interface SuggestedSchedule {
  draftId: string;
  platformId: string;
  scheduledFor: string;
  timezone: string;
  status: ScheduleStatus;
  reason?: string;
}

export interface ScheduleInput {
  campaign: Campaign;
  ideas: ContentIdea[];
  generated: GeneratedPost[];
  now?: Date;
  perPlatformGapMinutes: number;
}

// Heuristic spacing only. Crewlink has no official analytics integration, so a
// suggestion is never described as an optimal posting time.
export function buildSuggestedSchedule(input: ScheduleInput): SuggestedSchedule[] {
  const now = input.now ?? new Date();
  const timeZone = isValidTimeZone(input.campaign.timezone) ? input.campaign.timezone : 'UTC';
  const startDate = isValidDateString(input.campaign.startDate)
    ? input.campaign.startDate
    : todayInZone(timeZone, now);
  const ideas = new Map(input.ideas.map((idea) => [idea.id, idea]));
  const platformOrder = new Map(input.campaign.platforms.map((id, index) => [id, index]));
  const rows = input.generated
    .filter((post) => post.variationIndex === 0)
    .map((post) => ({ post, idea: ideas.get(post.ideaId) }))
    .filter(
      (row): row is { post: GeneratedPost; idea: ContentIdea } =>
        Boolean(row.idea) && row.idea!.day >= 1 && row.idea!.day <= input.campaign.durationDays
    )
    .sort(
      (a, b) =>
        a.idea.day - b.idea.day ||
        (platformOrder.get(a.post.platformId) ?? 99) -
          (platformOrder.get(b.post.platformId) ?? 99)
    );

  const scheduled: Array<{ draftId: string; platformId: string; date: string; minutes: number }> = [];
  const suggestions: SuggestedSchedule[] = [];

  for (const row of rows) {
    const platformIndex = platformOrder.get(row.post.platformId) ?? 0;
    let date = addDays(startDate, row.idea.day - 1);
    let minutes = DEFAULT_START_MINUTES + platformIndex * PLATFORM_STEP_MINUTES;
    let shifted = false;
    let attempts = 0;
    const overlaps = () =>
      scheduled.some((other) => {
        const delta = Math.abs(
          Date.parse(`${other.date}T00:00:00Z`) +
            other.minutes * 60_000 -
            (Date.parse(`${date}T00:00:00Z`) + minutes * 60_000)
        );
        const samePlatform = other.platformId === row.post.platformId;
        return samePlatform
          ? delta < input.perPlatformGapMinutes * 60_000
          : delta < GLOBAL_GAP_MINUTES * 60_000;
      });
    while (overlaps() && attempts < 40) {
      minutes += Math.max(30, Math.floor(input.perPlatformGapMinutes / 2));
      if (minutes > 23 * 60 + 30) {
        date = addDays(date, 1);
        minutes = DEFAULT_START_MINUTES;
      }
      shifted = true;
      attempts += 1;
    }

    let scheduledFor = zonedTimeToUtc(date, minutesToTime(minutes), timeZone);
    let reason: string | undefined = shifted
      ? 'Shifted to avoid another suggested post at the same time.'
      : undefined;
    while (scheduledFor.getTime() <= now.getTime() && attempts < 60) {
      date = addDays(date, 1);
      scheduledFor = zonedTimeToUtc(date, minutesToTime(minutes), timeZone);
      shifted = true;
      reason = 'Shifted forward because the original slot had already passed.';
      attempts += 1;
    }

    scheduled.push({ draftId: row.post.draftId, platformId: row.post.platformId, date, minutes });
    suggestions.push({
      draftId: row.post.draftId,
      platformId: row.post.platformId,
      scheduledFor: scheduledFor.toISOString(),
      timezone: timeZone,
      status: shifted ? 'conflict' : 'suggested',
      reason,
    });
  }

  return suggestions;
}

export function evaluateScheduleStatuses(
  schedules: CampaignSchedule[],
  perPlatformGapMinutes: number,
  now = new Date()
): Array<{ id: string; status: ScheduleStatus; reason?: string }> {
  const sorted = schedules
    .slice()
    .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
  const previous: CampaignSchedule[] = [];
  const patches: Array<{ id: string; status: ScheduleStatus; reason?: string }> = [];

  for (const schedule of sorted) {
    const time = Date.parse(schedule.scheduledFor);
    let reason: string | undefined;
    if (time <= now.getTime()) {
      reason = 'This time has already passed.';
    } else {
      for (const other of previous) {
        const gap = Math.abs(time - Date.parse(other.scheduledFor)) / 60_000;
        if (other.platformId === schedule.platformId && gap < perPlatformGapMinutes) {
          reason = `Within ${perPlatformGapMinutes} minutes of another ${schedule.platformId} post.`;
          break;
        }
        if (other.platformId !== schedule.platformId && gap < GLOBAL_GAP_MINUTES) {
          reason = 'Within 30 minutes of another suggested post.';
          break;
        }
      }
    }
    patches.push({
      id: schedule.id,
      status: reason ? 'conflict' : schedule.source === 'manual' ? 'scheduled' : 'suggested',
      reason,
    });
    previous.push(schedule);
  }
  return patches;
}

export function normalizeManualScheduleTime(value: unknown, now = new Date()): string {
  const text = String(value || '').trim();
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) {
    throw new AiValidationError('Choose a valid date and time.');
  }
  if (date.getTime() <= now.getTime() - 60_000) {
    throw new AiValidationError('Choose a time in the future.');
  }
  return date.toISOString();
}
