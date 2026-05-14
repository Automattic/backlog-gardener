import type { AttentionFacts, FindingLifecycleStatus, Item, Reply } from '../domain.js';

const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export interface ComputeAttentionFactsInput {
  item: Item;
  replies: Reply[];
  protectedLabels: string[];
  now: Date;
  recentMaintainerActivityDays: number;
  staleMaintainerActivityDays: number;
  feedbackStatus?: FindingLifecycleStatus | null | undefined;
  snoozedUntil?: string | null | undefined;
}

function normalizeLabel(label: string): string {
  return label.normalize('NFKC').toLowerCase();
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

function metadataStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function replyIsMaintainer(reply: Reply): boolean {
  const association = reply.metadata.authorAssociation ?? reply.metadata.author_association;
  if (typeof association === 'string' && MAINTAINER_ASSOCIATIONS.has(association)) return true;
  return reply.metadata.isPluginAuthor === true || reply.metadata.is_plugin_author === true;
}

function itemAuthorIsMaintainer(item: Item): boolean {
  const association = item.metadata.authorAssociation ?? item.metadata.author_association;
  return typeof association === 'string' && MAINTAINER_ASSOCIATIONS.has(association);
}

function replyClaimsActiveWork(reply: Reply): boolean {
  return /\b(working on a fix|work(?:ing)? on this|i'?ll work on this|fix is in progress)\b/i.test(reply.body);
}

export function computeAttentionFacts(input: ComputeAttentionFactsInput): AttentionFacts {
  const labels = metadataStringArray(input.item.metadata.labels).map(normalizeLabel);
  const protectedSet = new Set(input.protectedLabels.map(normalizeLabel));
  const matchedProtectedLabels = labels.filter((label) => protectedSet.has(label));

  const linkedOpenPrUrls = metadataStringArray(input.item.metadata.linkedOpenPrUrls);

  const maintainerEvents: Array<{ actor: string; at: string }> = [];
  if (itemAuthorIsMaintainer(input.item)) {
    maintainerEvents.push({ actor: input.item.author ?? 'maintainer', at: input.item.updatedAt });
  }
  for (const reply of input.replies) {
    if (replyIsMaintainer(reply)) {
      maintainerEvents.push({ actor: reply.author ?? 'maintainer', at: reply.updatedAt });
    }
    if (replyClaimsActiveWork(reply)) {
      maintainerEvents.push({ actor: reply.author ?? 'active-work-claim', at: input.now.toISOString() });
    }
  }
  maintainerEvents.sort((a, b) => b.at.localeCompare(a.at));
  const latestMaintainer = maintainerEvents[0] ?? null;
  let maintainerStatus: AttentionFacts['maintainerActivity']['status'] = 'none';
  if (latestMaintainer) {
    const ageDays = daysBetween(input.now, new Date(latestMaintainer.at));
    maintainerStatus = ageDays <= input.recentMaintainerActivityDays ? 'active' : 'stale';
    if (ageDays > input.staleMaintainerActivityDays) maintainerStatus = 'stale';
  }

  let dismissedReason: string | null = null;
  if (input.feedbackStatus === 'dismissed') dismissedReason = 'dismissed unchanged';
  if (input.feedbackStatus === 'snoozed') {
    if (!input.snoozedUntil || new Date(input.snoozedUntil) > input.now) {
      dismissedReason = 'snoozed';
    }
  }

  return {
    protectedLabel: { present: matchedProtectedLabels.length > 0, labels: matchedProtectedLabels },
    linkedOpenPr: { present: linkedOpenPrUrls.length > 0, urls: linkedOpenPrUrls },
    maintainerActivity: {
      status: maintainerStatus,
      lastAt: latestMaintainer?.at ?? null,
      actors: [...new Set(maintainerEvents.map((event) => event.actor))],
    },
    dismissedOrSnoozed: { present: dismissedReason !== null, reason: dismissedReason },
  };
}
