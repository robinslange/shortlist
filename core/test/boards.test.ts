import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { anchorRows } from "../src/boards/bespoke.ts";
import { pageDescription } from "../src/boards/page.ts";
import { parseSeekJob, parseSeekSearch, seekPageUrl } from "../src/boards/seek.ts";

const JOB_PAGE = readFileSync(resolve("core/test/fixtures/seek-job.html"), "utf8");

const searchPage = (jobs: unknown[]) =>
  "<html><head><title>Jobs</title></head><body><script>\n" +
  `window.SEEK_REDUX_DATA = ${JSON.stringify({ results: { results: { jobs } } })};\n` +
  "</script></body></html>";

const JOB = {
  id: "90000001",
  title: "Senior Backend Engineer",
  companyName: "Example Corp",
  advertiser: { id: "1", description: "Example Corp" },
  locations: [{ countryCode: "NZ", label: "Wellington" }],
  listingDate: "2026-09-20T01:00:00.000Z",
  salaryLabel: "$150,000 to $170,000",
  teaser: "Own our payments API.",
  bulletPoints: ["Go and Postgres", "Hybrid"],
};

test("parseSeekSearch maps a Seek job to a RoleRow", () => {
  const rows = parseSeekSearch(searchPage([JOB]), "https://nz.seek.com/engineer-jobs?page=2");
  deepStrictEqual(rows, [
    {
      source: "seek",
      external_id: "90000001",
      title: "Senior Backend Engineer",
      company: "Example Corp",
      location: "Wellington",
      url: "https://nz.seek.com/job/90000001",
      posted_at: "2026-09-20T01:00:00.000Z",
      comp_text: "$150,000 to $170,000",
      jd_text: "Own our payments API. -- Go and Postgres. Hybrid",
    },
  ]);
});

test("parseSeekSearch dedupes ids, falls back to the advertiser, and keeps the page host", () => {
  const other = { id: "90000002", title: "Platform Engineer", companyName: "", advertiser: { description: "Sample Ltd" } };
  const rows = parseSeekSearch(searchPage([JOB, other, JOB]), "https://au.seek.com/engineer-jobs")!;
  strictEqual(rows.length, 2);
  strictEqual(rows[1].company, "Sample Ltd");
  strictEqual(rows[1].location, "");
  strictEqual(rows[1].comp_text, undefined);
  strictEqual(rows[1].url, "https://au.seek.com/job/90000002");
});

test("parseSeekSearch returns [] for an empty result page", () => {
  deepStrictEqual(parseSeekSearch(searchPage([]), "https://nz.seek.com/x"), []);
});

test("parseSeekSearch returns null when the data blob is missing or broken", () => {
  strictEqual(parseSeekSearch("<html><body>redesigned</body></html>", "https://nz.seek.com/x"), null);
  strictEqual(
    parseSeekSearch("<script>\nwindow.SEEK_REDUX_DATA = {broken;\n</script>", "https://nz.seek.com/x"),
    null,
  );
});

test("seekPageUrl leaves page 1 alone and sets page on later pages", () => {
  strictEqual(seekPageUrl("https://nz.seek.com/engineer-jobs", 1), "https://nz.seek.com/engineer-jobs");
  strictEqual(seekPageUrl("https://nz.seek.com/engineer-jobs", 2), "https://nz.seek.com/engineer-jobs?page=2");
  strictEqual(
    seekPageUrl("https://nz.seek.com/engineer-jobs?daterange=3", 3),
    "https://nz.seek.com/engineer-jobs?daterange=3&page=3",
  );
});

test("parseSeekJob takes the job ad and stops before the company profile", () => {
  const text = parseSeekJob(JOB_PAGE)!;
  ok(text.includes("You will own the payments API."));
  ok(text.includes("Postgres"));
  ok(!text.includes("Company profile"));
  ok(!text.includes("makes invoices"));
});

test("parseSeekJob returns null on a page without a job ad", () => {
  strictEqual(parseSeekJob("<html><body><p>Hello</p></body></html>"), null);
});

test("pageDescription uses the Seek block when present and the whole page otherwise", () => {
  ok(!pageDescription(JOB_PAGE).includes("makes invoices"));
  strictEqual(pageDescription("<h1>Role</h1><p>Build things.</p>"), "Role\nBuild things.");
});

test("anchorRows keeps role links, drops the rest, and makes urls absolute", () => {
  const html = [
    '<a href="/jobs/1">Senior <b>Engineer</b></a>',
    '<a href="/about">About us</a>',
    '<a href="mailto:jobs@example.test">Email an engineer</a>',
    '<a href="#top">Engineer</a>',
    '<a href="/jobs/1">Senior Engineer</a>',
    `<a href="/jobs/2">${"Engineer ".repeat(20)}</a>`,
  ].join("");
  deepStrictEqual(anchorRows(html, "https://example.test/careers", "Example Corp", ["engineer"]), [
    {
      source: "bespoke",
      external_id: "example-corp:https://example.test/jobs/1",
      title: "Senior Engineer",
      company: "Example Corp",
      location: "",
      url: "https://example.test/jobs/1",
      jd_text: "Senior Engineer",
    },
  ]);
});
