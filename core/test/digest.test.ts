import { test } from "node:test";
import { deepStrictEqual, doesNotMatch, match, ok, strictEqual, throws } from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shortlistedFrom } from "../src/digest/read.ts";
import { applyScores } from "../src/digest/scores.ts";
import { digestPath, writeDigest } from "../src/digest/write.ts";
import { markShortlisted } from "../src/seen.ts";
import type { ScoredRow, SourceSummary, Survivor } from "../src/types.ts";

const now = new Date("2026-09-28T00:00:00Z");
const SOURCES: SourceSummary = { counts: { companies: 3, seek: 0 }, errors: [], stale: [] };

const survivor = (id: string, cheap = 2): Survivor => ({
  source: "greenhouse",
  external_id: `examplecorp:${id}`,
  key: `greenhouse:examplecorp:${id}`,
  title: `Engineer ${id}`,
  company: "Example Corp",
  location: "Wellington",
  url: `https://example.test/${id}`,
  jd_text: "text",
  cheap_score: cheap,
  matched_shapes: ["eng"],
});

const scored = (id: string, score: number): ScoredRow => ({
  ...survivor(id),
  llm_score: { score, rationale: `rationale ${id}`, red_flags_spotted: score < 5 ? ["onsite"] : [] },
});

test("scores sort into bands, with a tick box and key per role", () => {
  const md = writeDigest([scored("low", 3), scored("top", 9), scored("mid", 6)], "2026-09-28", SOURCES);
  ok(md.startsWith("# Job digest 2026-09-28"));
  ok(md.indexOf("Engineer top") < md.indexOf("Borderline (score 5-6)"));
  ok(md.indexOf("Engineer mid") < md.indexOf("Seen and skipped (score below 5)"));
  ok(md.indexOf("Engineer low") > md.indexOf("Seen and skipped"));
  match(md, /- score: \*\*9\*\* -- rationale top/);
  match(md, /- red flags: onsite/);
  match(md, /- \[ \] tailor\n<!-- key: greenhouse:examplecorp:top -->/);
  match(md, /- companies: 3 rows/);
});

test("roles without a model score get their own visible section, not a score band", () => {
  const md = writeDigest([survivor("a", 14), scored("b", 8)], "2026-09-28", SOURCES);
  match(md, /## Not scored by the model/);
  match(md, /- cheap score: 14\.0/);
  ok(md.indexOf("Engineer a") > md.indexOf("## Not scored by the model"));
  doesNotMatch(md, /Worth a look[\s\S]*Engineer a[\s\S]*Not scored/);
});

test("the footer names stale ATS caches and source errors", () => {
  const md = writeDigest([], "2026-09-28", { counts: { companies: 0, seek: 0 }, errors: ["seek: blocked"], stale: ["Old Co"] });
  match(md, /no new roles since the last run/);
  match(md, /- Old Co: blank `ats` and `slug` in companies.yaml and re-run/);
  match(md, /- seek: blocked/);
});

test("ticking a box in a written digest reads back as that role's key", () => {
  const md = writeDigest([scored("a", 8), scored("b", 7)], "2026-09-28", SOURCES).replace(
    /- \[ \] tailor(\n<!-- key: greenhouse:examplecorp:b -->)/,
    "- [x] tailor$1",
  );
  deepStrictEqual(shortlistedFrom(md), [
    { key: "greenhouse:examplecorp:b", title: "Engineer b", url: "https://example.test/b", ticked: true },
  ]);
});

test("applyScores merges by key and reports unknown keys and bad scores", () => {
  const { rows, problems } = applyScores(
    [survivor("a"), survivor("b")],
    [
      { key: "greenhouse:examplecorp:a", score: 8, rationale: "fits" },
      { key: "greenhouse:examplecorp:b", score: 11, rationale: "too high" },
      { key: "greenhouse:examplecorp:gone", score: 5, rationale: "stale" },
    ],
  );
  deepStrictEqual(rows[0].llm_score, { score: 8, rationale: "fits", red_flags_spotted: [] });
  strictEqual(rows[1].llm_score, undefined);
  deepStrictEqual(problems, [
    "greenhouse:examplecorp:b: score 11 is not an integer from 1 to 10",
    "scores.json names greenhouse:examplecorp:gone, which is not in survivors.json",
  ]);
});

test("digestPath suffixes a second digest on the same day", () => {
  const dir = mkdtempSync(join(tmpdir(), "shortlist-digest-"));
  strictEqual(digestPath(dir, "2026-09-28"), join(dir, "2026-09-28.md"));
  writeFileSync(join(dir, "2026-09-28.md"), "");
  strictEqual(digestPath(dir, "2026-09-28"), join(dir, "2026-09-28-2.md"));
});

test("markShortlisted stamps ticks and never walks a role back", () => {
  const r = markShortlisted(
    { "k:applied": { first_seen: "x", last_score: null, verdict: "applied" } },
    [
      { key: "k:new", title: "New role", url: "https://x.test/1", ticked: true },
      { key: "k:applied", title: "Old role", ticked: true },
    ],
    now,
  );
  strictEqual(r.marked, 1);
  strictEqual(r.store["k:new"].verdict, "shortlisted");
  strictEqual(r.store["k:new"].shortlisted_at, now.toISOString());
  strictEqual(r.store["k:applied"].verdict, "applied");
  deepStrictEqual(r.skipped, ["Old role (already applied)"]);
});

test("applyScores refuses a scores.json that is not an array", () => {
  throws(() => applyScores([survivor("a")], { scores: [] } as never), /scores\.json must be an array of \{key, score, rationale\}/);
});
