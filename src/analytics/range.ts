import { isValidDateString, isValidTimeZone } from '../ai/scheduling';
import type { AnalyticsRange } from './types';

const MAX_RANGE_DAYS = 366;

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || !isValidDateString(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : utcDateKey(date);
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

export interface RangeInput {
  days?: unknown;
  from?: unknown;
  to?: unknown;
  timezone?: unknown;
}

// Date filters are inclusive calendar dates. Conversion to a timezone is used
// for weekday/hour analysis; the storage filter itself uses the UTC date part so
// the same range is stable across server instances.
export function resolveAnalyticsRange(input: RangeInput = {}, now = new Date()): AnalyticsRange {
  const timezone =
    typeof input.timezone === 'string' && isValidTimeZone(input.timezone)
      ? input.timezone
      : 'UTC';

  const fromKey = parseDateKey(input.from);
  const toKey = parseDateKey(input.to);
  const wantsCustom = Boolean(input.from || input.to);

  let from: string;
  let to: string;
  let label: string;

  if (wantsCustom) {
    if (!fromKey || !toKey) {
      throw new AnalyticsRangeError('Choose both a start and an end date.');
    }
    if (fromKey > toKey) {
      throw new AnalyticsRangeError('The start date must be before the end date.');
    }
    const span = daysBetween(fromKey, toKey);
    if (span > MAX_RANGE_DAYS) {
      throw new AnalyticsRangeError(`Choose a range of ${MAX_RANGE_DAYS} days or fewer.`);
    }
    from = fromKey;
    to = toKey;
    label = 'Custom range';
  } else {
    const requested = Number(input.days);
    const days = requested === 7 || requested === 30 || requested === 90 ? requested : 30;
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const start = new Date(today.getTime() - (days - 1) * 86_400_000);
    from = utcDateKey(start);
    to = utcDateKey(today);
    label = `Last ${days} days`;
  }

  return { from, to, days: daysBetween(from, to), timezone, label };
}

export class AnalyticsRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsRangeError';
  }
}

export function previousAnalyticsRange(range: AnalyticsRange): AnalyticsRange {
  const from = new Date(`${range.from}T00:00:00.000Z`);
  const to = new Date(`${range.to}T00:00:00.000Z`);
  const previousTo = new Date(from.getTime() - 86_400_000);
  const previousFrom = new Date(previousTo.getTime() - (range.days - 1) * 86_400_000);
  return {
    from: utcDateKey(previousFrom),
    to: utcDateKey(previousTo),
    days: range.days,
    timezone: range.timezone,
    label: 'Previous period',
  };
}

export function inAnalyticsRange(iso: string, range: Pick<AnalyticsRange, 'from' | 'to'>): boolean {
  const key = typeof iso === 'string' ? iso.slice(0, 10) : '';
  return key >= range.from && key <= range.to;
}

export function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

// Calendar date in the requested IANA timezone. Used where “distinct days” must
// follow the same local boundary as weekday/hour grouping (including DST).
export function zonedDateKey(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return dateKey(iso);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: timezone,
    }).format(date);
  } catch {
    return dateKey(iso);
  }
}

export function weekdayLabel(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone }).format(
      new Date(iso)
    );
  } catch {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(iso)
    );
  }
}

export function hourInZone(iso: string, timezone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: timezone,
      }).format(new Date(iso))
    );
  } catch {
    return Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: 'UTC',
      }).format(new Date(iso))
    );
  }
}

export const WEEKDAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

// Three-hour windows keep the analysis readable and the sample requirement
// honest. They are local-time windows in the requested IANA timezone.
export function hourWindowLabel(hour: number): string {
  const start = Math.max(0, Math.min(21, Math.floor(hour / 3) * 3));
  const end = start + 3;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(start)}:00–${pad(end)}:00`;
}

export const HOUR_WINDOWS = Array.from({ length: 8 }, (_, index) => index * 3);
