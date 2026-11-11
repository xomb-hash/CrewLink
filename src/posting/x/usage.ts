import crypto from 'node:crypto';
import { config } from '../../config/index';
import { storage } from '../../lib/storage';
import { microsToUsd, usdToMicros } from './pricing';
import type { PublicationMode, UsageEntryStatus, UsageLedgerEntry } from '../../types/index';

// Crewlink pays for X API calls through its own OAuth app, so the budget is
// app-wide rather than per account. Manual publishing never touches the ledger.
export const X_PLATFORM_ID = 'x';

export interface XBudgetSummary {
  currency: 'USD';
  periodStart: string;
  budgetMicros: number;
  spentMicros: number;
  remainingMicros: number;
  budgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
}

export function xMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export async function getXBudgetSummary(now: Date = new Date()): Promise<XBudgetSummary> {
  const periodStart = xMonthStart(now);
  const budgetMicros = usdToMicros(config.xMonthlyBudgetUsd);
  const spentMicros = await storage.sumUsageSince(X_PLATFORM_ID, periodStart);
  const remainingMicros = Math.max(0, budgetMicros - spentMicros);
  return {
    currency: 'USD',
    periodStart: periodStart.toISOString(),
    budgetMicros,
    spentMicros,
    remainingMicros,
    budgetUsd: microsToUsd(budgetMicros),
    spentUsd: microsToUsd(spentMicros),
    remainingUsd: microsToUsd(remainingMicros),
  };
}

export interface ReserveXUsageInput {
  userId: string;
  projectId: string;
  draftId: string;
  publicationId: string;
  mode: PublicationMode;
  requestCount: number;
  costMicros: number;
}

// The reservation is written before the first API call. Reserved and committed
// rows both consume budget, so two in-flight publications cannot each spend the
// last of it in the common case. File-backed storage is not transactional, so
// simultaneous reservations remain best-effort; see TODO.md.
export async function reserveXUsage(input: ReserveXUsageInput): Promise<UsageLedgerEntry> {
  const now = new Date().toISOString();
  const entry: UsageLedgerEntry = {
    id: `xuse_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    userId: input.userId,
    projectId: input.projectId,
    draftId: input.draftId,
    publicationId: input.publicationId,
    platformId: X_PLATFORM_ID,
    mode: input.mode,
    requestCount: Math.max(0, input.requestCount),
    costMicros: Math.max(0, input.costMicros),
    currency: 'USD',
    status: 'reserved',
    createdAt: now,
    updatedAt: now,
  };
  const result = await storage.createUsageEntryIfAbsent(entry);
  if (result.created) return result.entry;

  // A retry reuses the publication's single ledger row; the earlier reservation
  // may have been released by a definitive failure.
  if (result.entry.status === 'released') {
    return (await storage.updateUsageEntryStatus(result.entry.id, 'reserved')) ?? result.entry;
  }
  return result.entry;
}

// committed = the request was (or may have been) billed; released = definitively
// not billed, so the budget is available again.
export async function settleXUsage(
  entryId: string,
  status: Extract<UsageEntryStatus, 'committed' | 'released'>
): Promise<void> {
  await storage.updateUsageEntryStatus(entryId, status);
}

export default {
  X_PLATFORM_ID,
  xMonthStart,
  getXBudgetSummary,
  reserveXUsage,
  settleXUsage,
};
