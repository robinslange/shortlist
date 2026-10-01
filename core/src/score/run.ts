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
// Board rows that fail the stack gate on their full page cost a fetch and free
// no survivor slot, so their fetches are capped separately.
export const MAX_PAGE_FETCHES = 2 * MAX_SURVIVORS;

export type ScoreDeps = { fetchPage: Fetcher | null; sleep: (ms: number) => Promise<void>; now: Date; log: (line: string) => void };

export type ScoreResult = {
  survivors: Survivor[];
  seen: SeenStore;
  dropped: number;
  filtered: number;
  // Filtered roles by reason, "red flag" rather than "red_flag: java".
  reasons: Record<string, number>;
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
  let fetched = 0;
  const warnings: string[] = [];
  const accepted: Survivor[] = [];
  const reasons: Record<string, number> = {};

  const filter = (row: RoleRow, reason: string) => {
    const kind = reason.split(":")[0].replaceAll("_", " ");
    reasons[kind] = (reasons[kind] ?? 0) + 1;
    const key = seenKey(row.source, row.external_id);
    if (isRegression(store[key]?.verdict, "filtered_cheap")) return;
    store = mergeInto(store, key, { verdict: "filtered_cheap", reason, url: row.url, title: row.title, company: row.company });
  };

  // The page text, or null when it can't be read; the teaser then stands.
  const fullDescription = async (s: Survivor): Promise<string | null> => {
    if (!deps.fetchPage) {
      warnings.push(`${s.key}: no fetcher configured, scoring on the teaser`);
      return null;
    }
    fetched++;
    let text: string | null = null;
    try {
      const html = await deps.fetchPage(s.url);
      if (looksBlocked(html)) throw new Error(`blocked at ${s.url} (bot check), scoring on the teaser`);
      text = pageDescription(html);
      if (!text) warnings.push(`${s.key}: the job page had no readable text`);
    } catch (e) {
      warnings.push(`${s.key}: ${(e as Error).message}`);
    }
    await deps.sleep(politeDelay());
    return text;
  };

  // A board row arrives with only a teaser, which rarely names the stack, so
  // the must-have gate waits until its page is fetched.
  const board = (row: RoleRow) => row.source === "seek" || row.source === "bespoke";
  const teaserProfile = { ...profile, must_have_any: [] };

  for (const row of candidates) {
    const key = seenKey(row.source, row.external_id);
    if (shouldDrop(store[key], deps.now).drop) {
      dropped++;
      continue;
    }
    const r = cheapScore(row, board(row) ? teaserProfile : profile);
    if (r.kind === "rejected") filter(row, r.reason);
    else accepted.push({ ...row, key, cheap_score: r.score, matched_shapes: r.matched_shapes });
  }
  accepted.sort((a, b) => b.cheap_score - a.cheap_score);

  const pages = Math.min(accepted.filter(board).length, MAX_PAGE_FETCHES);
  if (pages > 0 && deps.fetchPage) deps.log(`fetching up to ${pages} job page${pages === 1 ? "" : "s"} for full descriptions`);

  const survivors: Survivor[] = [];
  for (const s of accepted) {
    if (survivors.length === MAX_SURVIVORS) {
      filter(s, "over_survivor_cap");
      continue;
    }
    if (!board(s)) {
      survivors.push(s);
      continue;
    }
    if (deps.fetchPage && fetched === MAX_PAGE_FETCHES) {
      filter(s, "over_page_budget");
      continue;
    }
    const text = await fullDescription(s);
    if (!text) {
      survivors.push(s);
      continue;
    }
    const r = cheapScore({ ...s, jd_text: text }, profile);
    if (r.kind === "rejected") filter(s, r.reason);
    else survivors.push({ ...s, jd_text: text, cheap_score: r.score, matched_shapes: r.matched_shapes });
  }
  survivors.sort((a, b) => b.cheap_score - a.cheap_score);

  return { survivors, seen: store, dropped, filtered: candidates.length - dropped - survivors.length, reasons, warnings };
}
