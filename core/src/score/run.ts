// Dedupe, filter and cap the candidates, then fetch full descriptions for the
// board survivors. Only survivors are fetched, so request count scales with
// the shortlist, not the longlist.

import { pageDescription } from "../boards/page.ts";
import type { Fetcher } from "../io.ts";
import { politeDelay } from "../io.ts";
import { isRegression, mergeInto, seenKey, shouldDrop } from "../seen.ts";
import { looksBlocked } from "../text.ts";
import type { Profile, RoleRow, SeenStore, Survivor } from "../types.ts";
import { cheapScore } from "./cheap.ts";

export const MAX_SURVIVORS = 30;

export type ScoreDeps = { fetchPage: Fetcher | null; sleep: (ms: number) => Promise<void>; now: Date };

export type ScoreResult = {
  survivors: Survivor[];
  seen: SeenStore;
  dropped: number;
  filtered: number;
  warnings: string[];
};

export async function runScore(
  candidates: RoleRow[],
  profile: Profile,
  seen: SeenStore,
  deps: ScoreDeps,
): Promise<ScoreResult> {
  let store = seen;
  let dropped = 0;
  const warnings: string[] = [];
  const accepted: Survivor[] = [];

  const filter = (row: RoleRow, reason: string) => {
    const key = seenKey(row.source, row.external_id);
    if (isRegression(store[key]?.verdict, "filtered_cheap")) return;
    store = mergeInto(store, key, { verdict: "filtered_cheap", reason, url: row.url, title: row.title, company: row.company });
  };

  for (const row of candidates) {
    const key = seenKey(row.source, row.external_id);
    if (shouldDrop(store[key], deps.now).drop) {
      dropped++;
      continue;
    }
    const r = cheapScore(row, profile);
    if (r.kind === "rejected") filter(row, r.reason);
    else accepted.push({ ...row, key, cheap_score: r.score, matched_shapes: r.matched_shapes });
  }

  accepted.sort((a, b) => b.cheap_score - a.cheap_score);
  for (const row of accepted.slice(MAX_SURVIVORS)) filter(row, "over_survivor_cap");
  const survivors = accepted.slice(0, MAX_SURVIVORS);

  for (const s of survivors) {
    if (s.source !== "seek" && s.source !== "bespoke") continue;
    if (!deps.fetchPage) {
      warnings.push(`${s.key}: no fetcher configured, scoring on the teaser`);
      continue;
    }
    try {
      const html = await deps.fetchPage(s.url);
      if (looksBlocked(html)) throw new Error(`blocked at ${s.url} (bot check), scoring on the teaser`);
      const text = pageDescription(html);
      if (text) s.jd_text = text;
      else warnings.push(`${s.key}: the job page had no readable text`);
    } catch (e) {
      warnings.push(`${s.key}: ${(e as Error).message}`);
    }
    await deps.sleep(politeDelay());
  }

  return { survivors, seen: store, dropped, filtered: candidates.length - dropped - survivors.length, warnings };
}
