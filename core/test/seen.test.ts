import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { isRegression, isVerdict, mergeInto, recordScores, seenKey, setVerdict, shouldDrop } from "../src/seen.ts";
import type { ScoredRow, SeenEntry } from "../src/types.ts";

const now = new Date("2026-09-28T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const entry = (over: Partial<SeenEntry>): SeenEntry => ({
  first_seen: "2026-09-01T00:00:00Z",
  last_score: null,
  verdict: "new",
  ...over,
});

test("seenKey joins source and external id", () => {
  strictEqual(seenKey("greenhouse", "examplecorp:1"), "greenhouse:examplecorp:1");
});

test("merging keeps every field it does not write", () => {
  const store = mergeInto({ k: entry({ warm_path: "a friend" }) }, "k", { verdict: "shortlisted" });
  strictEqual(store.k.verdict, "shortlisted");
  strictEqual(store.k.warm_path, "a friend");
  strictEqual(store.k.first_seen, "2026-09-01T00:00:00Z");
});

test("merging a new key fills the defaults", () => {
  const e = mergeInto({}, "k", { url: "https://x.test" }).k;
  strictEqual(e.verdict, "new");
  strictEqual(e.last_score, null);
  ok(e.first_seen.length > 0);
});

test("terminal verdicts always drop", () => {
  for (const verdict of ["tailored", "applied", "rejected", "withdrawn"] as const) {
    ok(shouldDrop(entry({ verdict }), now).drop, verdict);
  }
});

test("live verdicts never drop", () => {
  for (const verdict of ["new", "shortlisted", "filtered_cheap"] as const) {
    strictEqual(shouldDrop(entry({ verdict }), now).drop, false, verdict);
  }
  strictEqual(shouldDrop(undefined, now).drop, false);
});

test("skipped drops for 30 days, then resurfaces", () => {
  ok(shouldDrop(entry({ verdict: "skipped", skipped_at: daysAgo(29) }), now).drop);
  strictEqual(shouldDrop(entry({ verdict: "skipped", skipped_at: daysAgo(31) }), now).drop, false);
  strictEqual(shouldDrop(entry({ verdict: "skipped", first_seen: daysAgo(40) }), now).drop, false);
});

test("regression means moving to an earlier stage", () => {
  ok(isRegression("applied", "tailored"));
  strictEqual(isRegression(undefined, "tailored"), false);
  strictEqual(isRegression("applied", "rejected"), false);
});

test("setVerdict stamps the matching time field", () => {
  const { store, refusedFrom } = setVerdict({ k: entry({}) }, "k", "tailored", false, now);
  strictEqual(refusedFrom, undefined);
  strictEqual(store.k.verdict, "tailored");
  strictEqual(store.k.tailored_at, now.toISOString());
});

test("setVerdict refuses to walk a role backwards unless forced", () => {
  const before = { k: entry({ verdict: "applied" }) };
  const refused = setVerdict(before, "k", "tailored", false, now);
  strictEqual(refused.refusedFrom, "applied");
  deepStrictEqual(refused.store, before);
  strictEqual(setVerdict(before, "k", "tailored", true, now).store.k.verdict, "tailored");
});

test("isVerdict accepts only known verdicts", () => {
  ok(isVerdict("skipped"));
  strictEqual(isVerdict("maybe"), false);
});

test("a role the model has already scored is not sent to it again", () => {
  strictEqual(shouldDrop(entry({ verdict: "new", last_score: 7 }), now).reason, "already in a digest");
  ok(shouldDrop(entry({ verdict: "shortlisted", last_score: 9 }), now).drop);
  strictEqual(shouldDrop(entry({ verdict: "new", last_score: null }), now).drop, false);
  strictEqual(shouldDrop(entry({ verdict: "filtered_cheap", last_score: null }), now).drop, false);
});

test("an expired skip comes back even though it was scored", () => {
  strictEqual(shouldDrop(entry({ verdict: "skipped", skipped_at: daysAgo(31), last_score: 3 }), now).drop, false);
});

const scoredRow = (key: string, score?: number): ScoredRow => ({
  source: "greenhouse",
  external_id: key,
  key,
  title: `Role ${key}`,
  company: "Example Corp",
  location: "",
  url: `https://x.test/${key}`,
  jd_text: "",
  cheap_score: 1,
  matched_shapes: [],
  llm_score: score === undefined ? undefined : { score, rationale: "", red_flags_spotted: [] },
});

test("recordScores keeps a score, skips a low one, and never erases an earlier score", () => {
  const store = recordScores(
    {
      low_shortlisted: entry({ verdict: "shortlisted" }),
      unscored: entry({ last_score: 6 }),
    },
    [scoredRow("high", 8), scoredRow("low", 4), scoredRow("low_shortlisted", 2), scoredRow("unscored")],
    now,
  );
  deepStrictEqual([store.high.verdict, store.high.last_score, store.high.title], ["new", 8, "Role high"]);
  deepStrictEqual([store.low.verdict, store.low.last_score, store.low.skipped_at], ["skipped", 4, now.toISOString()]);
  strictEqual(store.low_shortlisted.verdict, "shortlisted");
  strictEqual(store.unscored.last_score, 6);
  strictEqual(store.unscored.url, "https://x.test/unscored");
});
