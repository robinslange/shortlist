// Pure: the seen store's verdict lattice, merge rule and dedupe rule.
//
// Two invariants:
//  1. Writers merge. The store accrues fields from stages this code does not
//     model; replacing an entry wholesale destroys them.
//  2. Terminal verdicts never resurface. `tailored` and `applied` are
//     decisions already made, `rejected` and `withdrawn` are their outcomes;
//     `skipped` is a decision that expires.

import type { DigestTick } from "./digest/read.ts";
import { SEEN_VERDICTS } from "./types.ts";
import type { SeenEntry, SeenStore, SeenVerdict } from "./types.ts";

export const SKIP_EXPIRY_DAYS = 30;

const TERMINAL: SeenVerdict[] = ["tailored", "applied", "rejected", "withdrawn"];

// How far along a role is. A write may not move it backwards without intent.
const RANK: Record<SeenVerdict, number> = {
  filtered_cheap: 0,
  new: 0,
  skipped: 1,
  shortlisted: 2,
  tailored: 3,
  applied: 4,
  // Outcomes sit past `applied`: a role may move applied -> rejected, never back.
  rejected: 5,
  withdrawn: 5,
};

const STAMP: Partial<Record<SeenVerdict, string>> = {
  shortlisted: "shortlisted_at",
  tailored: "tailored_at",
  skipped: "skipped_at",
  applied: "applied_at",
  rejected: "rejected_at",
  withdrawn: "withdrawn_at",
};

export function isVerdict(s: string): s is SeenVerdict {
  return (SEEN_VERDICTS as readonly string[]).includes(s);
}

export function isRegression(from: SeenVerdict | undefined, to: SeenVerdict): boolean {
  return from !== undefined && RANK[to] < RANK[from];
}

export function seenKey(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

export function mergeEntry(prev: SeenEntry | undefined, patch: Partial<SeenEntry>): SeenEntry {
  return {
    first_seen: prev?.first_seen ?? new Date().toISOString(),
    last_score: prev?.last_score ?? null,
    verdict: prev?.verdict ?? "new",
    ...prev,
    ...patch,
  };
}

export function mergeInto(store: SeenStore, key: string, patch: Partial<SeenEntry>): SeenStore {
  return { ...store, [key]: mergeEntry(store[key], patch) };
}

export function shouldDrop(entry: SeenEntry | undefined, now: Date): { drop: boolean; reason?: string } {
  if (!entry) return { drop: false };
  if (TERMINAL.includes(entry.verdict)) return { drop: true, reason: `already ${entry.verdict}` };
  if (entry.verdict === "skipped") {
    const since = entry.skipped_at ?? entry.first_seen;
    const ageDays = (now.getTime() - new Date(since).getTime()) / 86_400_000;
    return ageDays < SKIP_EXPIRY_DAYS
      ? { drop: true, reason: `skipped ${Math.floor(ageDays)}d ago` }
      : { drop: false };
  }
  return { drop: false };
}

export function setVerdict(
  store: SeenStore,
  key: string,
  verdict: SeenVerdict,
  force: boolean,
  now: Date,
): { store: SeenStore; refusedFrom?: SeenVerdict } {
  const from = store[key]?.verdict;
  if (isRegression(from, verdict) && !force) return { store, refusedFrom: from };
  const stamp = STAMP[verdict];
  return { store: mergeInto(store, key, { verdict, ...(stamp ? { [stamp]: now.toISOString() } : {}) }) };
}

export function markShortlisted(
  store: SeenStore,
  ticks: DigestTick[],
  now: Date,
): { store: SeenStore; marked: number; skipped: string[] } {
  let out = store;
  let marked = 0;
  const skipped: string[] = [];
  for (const t of ticks) {
    const from = out[t.key]?.verdict;
    // A tick on an older digest must not walk a role back from tailored or applied.
    if (isRegression(from, "shortlisted")) {
      skipped.push(`${out[t.key]?.title ?? t.key} (already ${from})`);
      continue;
    }
    out = mergeInto(out, t.key, { verdict: "shortlisted", shortlisted_at: now.toISOString() });
    marked++;
  }
  return { store: out, marked, skipped };
}
