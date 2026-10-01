import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAX_PAGE_FETCHES, MAX_SURVIVORS, runScore } from "../src/score/run.ts";
import type { Profile, RoleRow, SeenEntry } from "../src/types.ts";

const now = new Date("2026-09-28T00:00:00Z");
const JOB_PAGE = readFileSync(resolve("core/test/fixtures/seek-job.html"), "utf8");

const profile: Profile = {
  candidate: { name: "", location: "", summary: "" },
  role_shapes: [{ id: "eng", keywords: ["engineer"], weight: 1 }],
  must_have_any: [],
  red_flags: ["java"],
  locations: { reject: [], accept: [] },
  source_weights: { board: 1, ats_api: 1 },
  boards: { seek: [] },
};

const row = (id: string, over: Partial<RoleRow> = {}): RoleRow => ({
  source: "greenhouse",
  external_id: `examplecorp:${id}`,
  title: "Engineer",
  company: "Example Corp",
  location: "Wellington",
  url: `https://example.test/${id}`,
  jd_text: "An engineer role.",
  ...over,
});

const entry = (over: Partial<SeenEntry>): SeenEntry => ({ first_seen: "2026-09-01T00:00:00Z", last_score: null, verdict: "new", ...over });

const noFetch = { fetchPage: null, sleep: async () => {}, now, log: () => {} };

test("roles already decided are dropped before scoring", async () => {
  const r = await runScore([row("1"), row("2")], profile, { "greenhouse:examplecorp:1": entry({ verdict: "applied" }) }, noFetch);
  strictEqual(r.dropped, 1);
  deepStrictEqual(r.survivors.map((s) => s.key), ["greenhouse:examplecorp:2"]);
});

test("a rejected role is recorded as filtered_cheap with its reason, keeping other fields", async () => {
  const r = await runScore(
    [row("1", { jd_text: "Java engineer." })],
    profile,
    { "greenhouse:examplecorp:1": entry({ note: "keep me" }) },
    noFetch,
  );
  const e = r.seen["greenhouse:examplecorp:1"];
  strictEqual(e.verdict, "filtered_cheap");
  strictEqual(e.reason, "red_flag: java");
  strictEqual(e.note, "keep me");
  strictEqual(r.filtered, 1);
});

test("a shortlisted role that now fails the filter stays shortlisted", async () => {
  const r = await runScore(
    [row("1", { jd_text: "Java engineer." })],
    profile,
    { "greenhouse:examplecorp:1": entry({ verdict: "shortlisted" }) },
    noFetch,
  );
  strictEqual(r.seen["greenhouse:examplecorp:1"].verdict, "shortlisted");
});

test(`survivors are capped at ${MAX_SURVIVORS}, highest cheap score first`, async () => {
  const rows = Array.from({ length: MAX_SURVIVORS + 1 }, (_, i) =>
    row(String(i), { jd_text: i === 0 ? "engineer" : "engineer engineer" }),
  );
  const r = await runScore(rows, { ...profile, role_shapes: [{ id: "eng", keywords: ["engineer", "engineer engineer"], weight: 1 }] }, {}, noFetch);
  strictEqual(r.survivors.length, MAX_SURVIVORS);
  strictEqual(r.seen["greenhouse:examplecorp:0"].reason, "over_survivor_cap");
});

test("board survivors get their full description; ATS survivors are not fetched", async () => {
  const fetched: string[] = [];
  const r = await runScore(
    [row("1"), row("90000001", { source: "seek", external_id: "90000001", url: "https://nz.seek.com/job/90000001", jd_text: "Engineer teaser." })],
    profile,
    {},
    { ...noFetch, fetchPage: async (url) => (fetched.push(url), JOB_PAGE) },
  );
  deepStrictEqual(fetched, ["https://nz.seek.com/job/90000001"]);
  ok(r.survivors.find((s) => s.source === "seek")!.jd_text.includes("You will own the payments API."));
});

test("without a fetcher, board survivors keep their teaser and say so", async () => {
  const r = await runScore(
    [row("1", { source: "seek", external_id: "1", jd_text: "Engineer teaser." })],
    profile,
    {},
    noFetch,
  );
  strictEqual(r.survivors[0].jd_text, "Engineer teaser.");
  deepStrictEqual(r.warnings, ["seek:1: no fetcher configured, scoring on the teaser"]);
});

test("a bot-check page never replaces the teaser", async () => {
  const r = await runScore(
    [row("1", { source: "seek", external_id: "1", jd_text: "Engineer teaser." })],
    profile,
    {},
    { ...noFetch, fetchPage: async () => "<html><head><title>Just a moment...</title></head><body>Enable JavaScript</body></html>" },
  );
  strictEqual(r.survivors[0].jd_text, "Engineer teaser.");
  deepStrictEqual(r.warnings, ["seek:1: blocked at https://example.test/1 (bot check), scoring on the teaser"]);
});

test("a job page with no readable text keeps the teaser and says so", async () => {
  const r = await runScore(
    [row("1", { source: "bespoke", external_id: "examplecorp:https://example.test/1", jd_text: "Engineer" })],
    profile,
    {},
    { ...noFetch, fetchPage: async () => "<script>app()</script>" },
  );
  strictEqual(r.survivors[0].jd_text, "Engineer");
  deepStrictEqual(r.warnings, ["bespoke:examplecorp:https://example.test/1: the job page had no readable text"]);
});

test("a fetch that throws keeps the teaser and records why", async () => {
  const r = await runScore(
    [row("1", { source: "seek", external_id: "1", jd_text: "Engineer teaser." })],
    profile,
    {},
    { ...noFetch, fetchPage: async () => { throw new Error("fetch exited 6: could not resolve host"); } },
  );
  strictEqual(r.survivors[0].jd_text, "Engineer teaser.");
  deepStrictEqual(r.warnings, ["seek:1: fetch exited 6: could not resolve host"]);
});

test("score says how many job pages it is about to fetch", async () => {
  const lines: string[] = [];
  await runScore(
    [row("1"), row("2", { source: "seek", external_id: "2", jd_text: "Engineer" }), row("3", { source: "seek", external_id: "3", jd_text: "Engineer" })],
    profile,
    {},
    { ...noFetch, fetchPage: async () => JOB_PAGE, log: (l) => void lines.push(l) },
  );
  deepStrictEqual(lines, ["fetching up to 2 job pages for full descriptions"]);
});

test("score counts why roles were filtered, so an empty result explains itself", async () => {
  const r = await runScore(
    [row("1", { jd_text: "Java engineer." }), row("2", { jd_text: "More Java." }), row("3", { title: "Designer", jd_text: "Figma." })],
    profile,
    {},
    noFetch,
  );
  deepStrictEqual(r.reasons, { "red flag": 2, "no role shape match": 1 });
});

const stack = { ...profile, must_have_any: [{ signal: "stack", any_of: ["postgres"] }] };
const seekRow = (id: string, jd_text = "Engineer teaser.") =>
  row(id, { source: "seek", external_id: id, url: `https://nz.seek.com/job/${id}`, jd_text });

test("a board teaser that never names the stack is judged on its full page", async () => {
  const r = await runScore([seekRow("1")], stack, {}, { ...noFetch, fetchPage: async () => JOB_PAGE });
  deepStrictEqual(r.survivors.map((s) => s.key), ["seek:1"]);
  ok(r.survivors[0].jd_text.includes("Postgres"));
});

test("a board role whose full page lacks the stack is filtered and frees its slot", async () => {
  const rows = [seekRow("1"), ...Array.from({ length: MAX_SURVIVORS }, (_, i) => row(String(i), { jd_text: "Engineer, Postgres." }))];
  const miss = await runScore(rows, stack, {}, { ...noFetch, fetchPage: async () => JOB_PAGE.replace("Postgres", "") });
  strictEqual(miss.seen["seek:1"].reason, "missing_must_have: stack");
  strictEqual(miss.survivors.length, MAX_SURVIVORS);
  ok(miss.survivors.every((s) => s.source === "greenhouse"));
});

test("a red flag on the full page filters a board role its teaser hid", async () => {
  const r = await runScore([seekRow("1")], profile, {}, { ...noFetch, fetchPage: async () => JOB_PAGE.replace("Go", "Java") });
  strictEqual(r.seen["seek:1"].reason, "red_flag: java");
  strictEqual(r.survivors.length, 0);
});

test(`job page fetches stop at ${MAX_PAGE_FETCHES}`, async () => {
  let fetches = 0;
  const rows = Array.from({ length: MAX_PAGE_FETCHES + 1 }, (_, i) => seekRow(String(i)));
  const r = await runScore(rows, stack, {}, { ...noFetch, fetchPage: async () => (fetches++, JOB_PAGE.replace("Postgres", "")) });
  strictEqual(fetches, MAX_PAGE_FETCHES);
  strictEqual(r.reasons["over page budget"], 1);
});

test("without a fetcher, a board teaser is not held to the stack it cannot show", async () => {
  const r = await runScore([seekRow("1")], stack, {}, noFetch);
  deepStrictEqual(r.survivors.map((s) => s.key), ["seek:1"]);
});
