import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { detectAts } from "../src/ats/detect.ts";

const CASES: Array<[string, string, { ats: string; slug: string }]> = [
  ["ashby embed", '<iframe src="https://jobs.ashbyhq.com/examplecorp/embed"></iframe>', { ats: "ashby", slug: "examplecorp" }],
  ["workable", '<a href="https://apply.workable.com/example-ltd/">Jobs</a>', { ats: "workable", slug: "example-ltd" }],
  ["lever", '<a href="https://jobs.lever.co/example-limited">Jobs</a>', { ats: "lever", slug: "example-limited" }],
  ["greenhouse embed", '<script src="https://boards.greenhouse.io/embed/job_board/js?for=examplecorp"></script>', { ats: "greenhouse", slug: "examplecorp" }],
  ["greenhouse job-boards", '<a href="https://job-boards.greenhouse.io/examplecorp/jobs/123">Role</a>', { ats: "greenhouse", slug: "examplecorp" }],
  ["bamboohr", '<a href="https://examplecorp.bamboohr.com/careers">Jobs</a>', { ats: "bamboohr", slug: "examplecorp" }],
  ["teamtailor", '<a href="https://examplecorp.teamtailor.com/jobs">Jobs</a>', { ats: "teamtailor", slug: "examplecorp" }],
  ["workday with locale", '<a href="https://examplecorp.wd3.myworkdayjobs.com/en-US/External_Careers">Jobs</a>', { ats: "workday", slug: "examplecorp/wd3/External_Careers" }],
  ["smartrecruiters", '<a href="https://jobs.smartrecruiters.com/ExampleCorp1">Jobs</a>', { ats: "smartrecruiters", slug: "ExampleCorp1" }],
  ["recruitee", '<a href="https://examplecorp.recruitee.com/">Jobs</a>', { ats: "recruitee", slug: "examplecorp" }],
  ["personio", '<a href="https://examplecorp.jobs.personio.de/">Jobs</a>', { ats: "personio", slug: "examplecorp" }],
];

for (const [name, html, expected] of CASES) {
  test(`detects ${name}`, () => {
    deepStrictEqual(detectAts(html), expected);
  });
}

test("records a second ATS on the same page as secondary", () => {
  const html =
    '<a href="https://jobs.ashbyhq.com/examplecorp">Eng</a><a href="https://apply.workable.com/examplecorp/">Ops</a>';
  deepStrictEqual(detectAts(html), {
    ats: "ashby",
    slug: "examplecorp",
    secondary: [{ ats: "workable", slug: "examplecorp" }],
  });
});

test("returns null when no signature matches", () => {
  strictEqual(detectAts('<a href="/careers/engineer">Engineer</a>'), null);
});

test("does not mistake a vendor's own site for a customer board", () => {
  strictEqual(detectAts('<a href="https://www.bamboohr.com/about/">BambooHR</a>'), null);
});

test("the vendor's app subdomain is not a customer board", () => {
  strictEqual(detectAts('<a href="https://app.bamboohr.com/login">Sign in</a>'), null);
});

test("a greenhouse embed path is never read as a board called embed", () => {
  const found = detectAts('<script src="https://boards.greenhouse.io/embed/job_board?for=examplecorp"></script>');
  ok(found?.slug !== "embed", JSON.stringify(found));
});
