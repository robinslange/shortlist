import { test } from "node:test";
import { deepStrictEqual, match, ok, strictEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Endpoint } from "../src/ats/dispatch.ts";
import type { Fetcher, Http } from "../src/io.ts";
import { runSource } from "../src/source.ts";
import type { Company, Profile } from "../src/types.ts";

const raw = (name: string) => readFileSync(resolve("core/test/fixtures/ats-api", name), "utf8");
const GH = "https://boards-api.greenhouse.io/v1/boards/examplecorp/jobs?content=true";

const profile = (seek: string[] = []): Profile => ({
  candidate: { name: "", location: "", summary: "" },
  role_shapes: [{ id: "eng", keywords: ["engineer"], weight: 1 }],
  must_have_any: [],
  red_flags: [],
  locations: { reject: [] },
  source_weights: { board: 1, ats_api: 1 },
  boards: { seek },
});

const httpFrom = (map: Record<string, { status: number; body: string }>): Http =>
  async (ep: Endpoint) => map[ep.url] ?? { status: 599, body: "" };

const pagesFrom = (map: Record<string, string>): Fetcher => async (url) => {
  if (!(url in map)) throw new Error(`unexpected fetch ${url}`);
  return map[url];
};

const deps = (http: Http, fetchPage: Fetcher | null = null) => ({ http, fetchPage, sleep: async () => {} });

const cached: Company = { name: "Example Corp", careers_url: "https://example.test/careers", ats: "greenhouse", slug: "examplecorp" };

const seekPage = (ids: string[]) =>
  "<script>\nwindow.SEEK_REDUX_DATA = " +
  JSON.stringify({ results: { results: { jobs: ids.map((id) => ({ id, title: `Engineer ${id}`, companyName: "Seek Co" })) } } }) +
  ";\n</script>";

test("a company with a cached ATS dispatches and counts its rows", async () => {
  const r = await runSource([cached], profile(), deps(httpFrom({ [GH]: { status: 200, body: raw("greenhouse.json") } })));
  strictEqual(r.rows.length, 1);
  strictEqual(r.rows[0].source, "greenhouse");
  deepStrictEqual(r.summary, { counts: { companies: 1, seek: 0 }, errors: [], stale: [] });
});

test("a 404 marks the company's cached ATS as stale, not as an error", async () => {
  const r = await runSource([cached], profile(), deps(httpFrom({ [GH]: { status: 404, body: "" } })));
  deepStrictEqual(r.summary.stale, ["Example Corp"]);
  deepStrictEqual(r.summary.errors, []);
});

test("one failing company does not stop the next", async () => {
  const broken: Company = { name: "Broken Co", careers_url: "https://b.test", ats: "lever", slug: "broken" };
  const r = await runSource(
    [broken, cached],
    profile(),
    deps(httpFrom({
      "https://api.lever.co/v0/postings/broken?mode=json": { status: 500, body: "" },
      [GH]: { status: 200, body: raw("greenhouse.json") },
    })),
  );
  match(r.summary.errors[0], /^Broken Co: HTTP 500/);
  strictEqual(r.rows.length, 1);
});

test("a company that needs detection without a fetcher is reported and skipped", async () => {
  const unknown: Company = { name: "New Co", careers_url: "https://new.test/careers" };
  const r = await runSource([unknown, cached], profile(), deps(httpFrom({ [GH]: { status: 200, body: raw("greenhouse.json") } })));
  deepStrictEqual(r.summary.errors, ["New Co: no fetcher configured"]);
  strictEqual(r.rows.length, 1);
});

test("a detected ATS is recorded for write-back and dispatched", async () => {
  const unknown: Company = { name: "Lever Co", careers_url: "https://lever-co.test/careers" };
  const r = await runSource(
    [unknown],
    profile(),
    deps(
      httpFrom({ "https://api.lever.co/v0/postings/example-limited?mode=json": { status: 200, body: raw("lever.json") } }),
      pagesFrom({ "https://lever-co.test/careers": '<a href="https://jobs.lever.co/example-limited">Jobs</a>' }),
    ),
  );
  deepStrictEqual(r.detections, [{ index: 0, result: { ats: "lever", slug: "example-limited" } }]);
  strictEqual(r.rows.length, 1);
});

test("no detectable ATS falls back to scraping role links", async () => {
  const unknown: Company = { name: "Plain Co", careers_url: "https://plain.test/careers" };
  const r = await runSource(
    [unknown],
    profile(),
    deps(httpFrom({}), pagesFrom({ "https://plain.test/careers": '<a href="/jobs/1">Senior Engineer</a><a href="/about">About</a>' })),
  );
  deepStrictEqual(r.detections, []);
  deepStrictEqual(r.rows.map((x) => [x.source, x.url]), [["bespoke", "https://plain.test/jobs/1"]]);
});

test("a failed detail call keeps the row and records the error", async () => {
  const bamboo: Company = { name: "Bamboo Co", careers_url: "https://b.test", ats: "bamboohr", slug: "examplecorp" };
  const r = await runSource(
    [bamboo],
    profile(),
    deps(httpFrom({
      "https://examplecorp.bamboohr.com/careers/list": { status: 200, body: raw("bamboohr-list.json") },
      "https://examplecorp.bamboohr.com/careers/42/detail": { status: 500, body: "" },
    })),
  );
  strictEqual(r.rows.length, 1);
  match(r.summary.errors[0], /^Bamboo Co: hydrate examplecorp:42: HTTP 500/);
});

test("seek pages until an empty page and dedupes across pages", async () => {
  const base = "https://nz.seek.com/engineer-jobs";
  const r = await runSource(
    [],
    profile([base]),
    deps(httpFrom({}), pagesFrom({
      [base]: seekPage(["1", "2"]),
      [`${base}?page=2`]: seekPage(["2", "3"]),
      [`${base}?page=3`]: seekPage([]),
    })),
  );
  deepStrictEqual(r.rows.map((x) => x.external_id), ["1", "2", "3"]);
  strictEqual(r.summary.counts.seek, 4);
});

test("a blocked seek page stops seek and says so", async () => {
  const base = "https://nz.seek.com/engineer-jobs";
  const r = await runSource([], profile([base]), deps(httpFrom({}), pagesFrom({ [base]: "<title>Access Denied</title>" })));
  strictEqual(r.rows.length, 0);
  match(r.summary.errors[0], /^seek: blocked at/);
});

test("a seek page without results data reports a format change instead of zero rows", async () => {
  const base = "https://nz.seek.com/engineer-jobs";
  const r = await runSource([], profile([base]), deps(httpFrom({}), pagesFrom({ [base]: "<html>redesigned</html>" })));
  match(r.summary.errors[0], /format may have changed/);
});

test("seek without a fetcher reports it and the ATS sources still run", async () => {
  const r = await runSource(
    [cached],
    profile(["https://nz.seek.com/engineer-jobs"]),
    deps(httpFrom({ [GH]: { status: 200, body: raw("greenhouse.json") } })),
  );
  deepStrictEqual(r.summary.errors, ["seek: no fetcher configured"]);
  ok(r.rows.length === 1);
});

test("a blocked careers page is an error, not a company with zero roles", async () => {
  const unknown: Company = { name: "New Co", careers_url: "https://new.test/careers" };
  const bespoke: Company = { name: "Plain Co", careers_url: "https://plain.test/careers", ats: "bespoke" };
  const blocked = "<title>Just a moment...</title>";
  const r = await runSource(
    [unknown, bespoke],
    profile(),
    deps(httpFrom({}), pagesFrom({ "https://new.test/careers": blocked, "https://plain.test/careers": blocked })),
  );
  deepStrictEqual(r.summary.errors, [
    "New Co: blocked at https://new.test/careers (bot check)",
    "Plain Co: blocked at https://plain.test/careers (bot check)",
  ]);
  strictEqual(r.rows.length, 0);
});

test("an ATS that pages its results says when only the first page was read", async () => {
  const wd: Company = { name: "Workday Co", careers_url: "https://w.test", ats: "workday", slug: "examplecorp/wd3/External" };
  const list = JSON.stringify({ ...JSON.parse(raw("workday.json")), total: 386 });
  const r = await runSource(
    [wd],
    profile(),
    deps(httpFrom({
      "https://examplecorp.wd3.myworkdayjobs.com/wday/cxs/examplecorp/External/jobs": { status: 200, body: list },
      "https://examplecorp.wd3.myworkdayjobs.com/wday/cxs/examplecorp/External/job/Wellington/Senior-Platform-Engineer_JR-1": { status: 200, body: "{}" },
    })),
  );
  strictEqual(r.rows.length, 1);
  deepStrictEqual(r.summary.errors, ["Workday Co: read 1 of 386 roles; this ATS pages its results and shortlist reads only the first page"]);
});

test("every Seek search in the profile is read, not just the first", async () => {
  const a = "https://nz.seek.com/a-jobs";
  const b = "https://nz.seek.com/b-jobs";
  const r = await runSource([], profile([a, b]), deps(httpFrom({}), pagesFrom({
    [a]: seekPage(["1"]), [`${a}?page=2`]: seekPage([]),
    [b]: seekPage(["2"]), [`${b}?page=2`]: seekPage([]),
  })));
  deepStrictEqual(r.rows.map((x) => x.external_id), ["1", "2"]);
});

test("Seek stops after 25 pages even when every page has results", async () => {
  const fetched: string[] = [];
  const endless: Fetcher = async (url) => {
    fetched.push(url);
    return seekPage([`id-${fetched.length}`]);
  };
  const r = await runSource([], profile(["https://nz.seek.com/engineer-jobs"]), deps(httpFrom({}), endless));
  strictEqual(fetched.length, 25);
  strictEqual(r.rows.length, 25);
});

test("the politeness delay runs between companies and between Seek pages", async () => {
  const other: Company = { ...cached, name: "Other Co", slug: "other" };
  const sleeps: number[] = [];
  const base = "https://nz.seek.com/engineer-jobs";
  await runSource([cached, other], profile([base]), {
    http: httpFrom({
      [GH]: { status: 200, body: raw("greenhouse.json") },
      "https://boards-api.greenhouse.io/v1/boards/other/jobs?content=true": { status: 200, body: raw("greenhouse.json") },
    }),
    fetchPage: pagesFrom({ [base]: seekPage(["1"]), [`${base}?page=2`]: seekPage([]) }),
    sleep: async (ms) => void sleeps.push(ms),
  });
  strictEqual(sleeps.length, 3);
  ok(sleeps.every((ms) => ms >= 750 && ms < 1000), sleeps.join(","));
});

test("a company with an ATS but no slug is detected again", async () => {
  const half: Company = { name: "Half Co", careers_url: "https://half.test/careers", ats: "lever" };
  const r = await runSource(
    [half],
    profile(),
    deps(
      httpFrom({ "https://api.lever.co/v0/postings/example-limited?mode=json": { status: 200, body: raw("lever.json") } }),
      pagesFrom({ "https://half.test/careers": '<a href="https://jobs.lever.co/example-limited">Jobs</a>' }),
    ),
  );
  deepStrictEqual(r.detections, [{ index: 0, result: { ats: "lever", slug: "example-limited" } }]);
});

test("a paging ATS that returned everything raises no shortfall note", async () => {
  const sr: Company = { name: "SR Co", careers_url: "https://s.test", ats: "smartrecruiters", slug: "ExampleCorp1" };
  const r = await runSource([sr], profile(), deps(httpFrom({
    "https://api.smartrecruiters.com/v1/companies/ExampleCorp1/postings?limit=100": { status: 200, body: raw("smartrecruiters.json") },
    "https://api.smartrecruiters.com/v1/companies/ExampleCorp1/postings/744000000000001": { status: 200, body: raw("smartrecruiters-detail.json") },
  })));
  strictEqual(r.rows.length, 1);
  deepStrictEqual(r.summary.errors, []);
});

test("a company's second ATS board is read as well as its first", async () => {
  const both: Company = { ...cached, secondary_ats: [{ ats: "lever", slug: "example-limited" }] };
  const r = await runSource([both], profile(), deps(httpFrom({
    [GH]: { status: 200, body: raw("greenhouse.json") },
    "https://api.lever.co/v0/postings/example-limited?mode=json": { status: 200, body: raw("lever.json") },
  })));
  deepStrictEqual(r.rows.map((x) => x.source).sort(), ["greenhouse", "lever"]);
  strictEqual(r.summary.counts.companies, 2);
});

test("a second ATS found by detection is read in the same run", async () => {
  const unknown: Company = { name: "Two Boards", careers_url: "https://two.test/careers" };
  const r = await runSource([unknown], profile(), deps(
    httpFrom({
      [GH]: { status: 200, body: raw("greenhouse.json") },
      "https://api.lever.co/v0/postings/example-limited?mode=json": { status: 200, body: raw("lever.json") },
    }),
    pagesFrom({ "https://two.test/careers": '<a href="https://jobs.lever.co/example-limited">A</a><a href="https://job-boards.greenhouse.io/examplecorp/jobs/1">B</a>' }),
  ));
  deepStrictEqual(r.rows.map((x) => x.source).sort(), ["greenhouse", "lever"]);
});
