import { test } from "node:test";
import { ok, strictEqual, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  detailEndpoint,
  listEndpoint,
  mergeDetail,
  needsHydrate,
  normalise,
  parseBody,
  workdayParts,
} from "../src/ats/dispatch.ts";
import type { AtsKind } from "../src/types.ts";

const raw = (name: string) => readFileSync(resolve("core/test/fixtures/ats-api", name), "utf8");

const CASES: Array<[AtsKind, string, string]> = [
  ["ashby", "examplecorp", "ashby.json"],
  ["lever", "example-limited", "lever.json"],
  ["greenhouse", "examplecorp", "greenhouse.json"],
  ["workable", "example-ltd", "workable.json"],
  ["teamtailor", "examplecorp", "teamtailor.json"],
  ["recruitee", "examplecorp", "recruitee.json"],
  ["smartrecruiters", "ExampleCorp1", "smartrecruiters.json"],
  ["workday", "examplecorp/wd3/External", "workday.json"],
  ["personio", "examplecorp", "personio.xml"],
  ["bamboohr", "examplecorp", "bamboohr-list.json"],
];

const rowsFor = (ats: AtsKind, slug: string, file: string) =>
  normalise(ats, parseBody(ats, raw(file)), { slug, company: "Example Corp" });

for (const [ats, slug, file] of CASES) {
  test(`${ats} normalises to a complete RoleRow`, () => {
    const rows = rowsFor(ats, slug, file);
    ok(rows.length > 0, "expected at least one row");
    const r = rows[0];
    strictEqual(r.source, ats);
    strictEqual(r.company, "Example Corp");
    ok(r.title.length > 0, "title must be populated");
    ok(r.url.startsWith("https://"), `url must be absolute, got: ${r.url}`);
    ok(r.external_id.startsWith(`${slug}:`), `external_id must be slug-prefixed, got: ${r.external_id}`);
    ok(listEndpoint(ats, { slug, company: "Example Corp" })?.url.startsWith("https://"));
  });

  if (needsHydrate(ats)) {
    test(`${ats} exposes a detail endpoint for each row`, () => {
      const r = rowsFor(ats, slug, file)[0];
      ok(detailEndpoint(ats, { slug, company: "Example Corp" }, r)?.url.startsWith("https://"));
    });
  } else {
    test(`${ats} list response carries jd_text`, () => {
      const r = rowsFor(ats, slug, file)[0];
      ok(r.jd_text.length > 100, `${ats} jd_text was ${r.jd_text.length} chars`);
    });
  }
}

test("hydrate set is exactly the ATSes whose list response omits the description", () => {
  const hydrating = CASES.filter(([a]) => needsHydrate(a)).map(([a]) => a).sort();
  strictEqual(hydrating.join(","), "bamboohr,smartrecruiters,workable,workday");
});

test("greenhouse decodes escaped HTML before stripping it", () => {
  const r = rowsFor("greenhouse", "examplecorp", "greenhouse.json")[0];
  ok(!r.jd_text.includes("<"), `jd_text still has markup: ${r.jd_text.slice(0, 80)}`);
  ok(r.jd_text.startsWith("About the role"));
});

test("lever falls back to the HTML description when descriptionPlain is empty", () => {
  const r = rowsFor("lever", "example-limited", "lever.json")[0];
  ok(r.jd_text.includes("Kubernetes platform"));
  ok(r.jd_text.includes("Mentor two engineers"));
});

test("bamboohr detail fills jd_text and the share url", () => {
  const row = rowsFor("bamboohr", "examplecorp", "bamboohr-list.json")[0];
  strictEqual(row.jd_text, "");
  const merged = mergeDetail("bamboohr", row, JSON.parse(raw("bamboohr-detail.json")));
  ok(merged.jd_text.includes("Kubernetes platform"));
  strictEqual(merged.url, "https://examplecorp.bamboohr.com/careers/42");
  strictEqual(
    detailEndpoint("bamboohr", { slug: "examplecorp", company: "Example Corp" }, row)?.url,
    "https://examplecorp.bamboohr.com/careers/42/detail",
  );
});

test("personio joins office and additional offices", () => {
  strictEqual(rowsFor("personio", "examplecorp", "personio.xml")[0].location, "Wellington, Auckland");
});

test("workday carries tenant, host and site in one slug field", () => {
  const p = workdayParts("acme/wd3/Acme_Careers");
  strictEqual(p.tenant, "acme");
  strictEqual(p.host, "wd3");
  strictEqual(p.site, "Acme_Careers");
  throws(() => workdayParts("acme"), /tenant\/wdN\/Site/);
});

test("bespoke has no API endpoint", () => {
  strictEqual(listEndpoint("bespoke", { slug: "x", company: "X" }), null);
});

test("parseBody hands personio XML through as text and parses the rest as JSON", () => {
  strictEqual(parseBody("personio", "<x/>"), "<x/>");
  strictEqual((parseBody("ashby", '{"a":1}') as { a: number }).a, 1);
});

// Detail shapes checked against the live APIs on 2026-09-30.
test("smartrecruiters detail joins the four ad sections in order and takes the posting url", () => {
  const row = rowsFor("smartrecruiters", "ExampleCorp1", "smartrecruiters.json")[0];
  const merged = mergeDetail("smartrecruiters", row, JSON.parse(raw("smartrecruiters-detail.json")));
  strictEqual(merged.jd_text, "Example Corp builds invoicing software.\n\nYou will run our Kubernetes platform.\n\nGo\nPostgres\n\nHybrid in Wellington.");
  strictEqual(merged.url, "https://jobs.smartrecruiters.com/ExampleCorp1/744000000000001-senior-platform-engineer");
});

test("workable detail joins description, requirements and benefits", () => {
  const row = rowsFor("workable", "example-ltd", "workable.json")[0];
  const merged = mergeDetail("workable", row, JSON.parse(raw("workable-detail.json")));
  strictEqual(merged.jd_text, "You will run our Kubernetes platform.\n\nGo\n\nHybrid in Wellington.");
  strictEqual(merged.url, row.url);
});

test("workday detail fills the description, the public url and the start date", () => {
  const row = rowsFor("workday", "examplecorp/wd3/External", "workday.json")[0];
  const merged = mergeDetail("workday", row, JSON.parse(raw("workday-detail.json")));
  strictEqual(merged.jd_text, "You will run our Kubernetes platform.\nGo");
  strictEqual(merged.url, "https://examplecorp.wd3.myworkdayjobs.com/en-US/External/job/Wellington/Senior-Platform-Engineer_JR-1");
  strictEqual(merged.posted_at, "2026-09-20");
});

test("a detail payload missing its fields keeps the list row rather than inventing text", () => {
  for (const [ats, slug, file] of CASES.filter(([a]) => needsHydrate(a))) {
    const row = rowsFor(ats, slug, file)[0];
    const merged = mergeDetail(ats, row, {});
    strictEqual(merged.jd_text, "", ats);
    strictEqual(merged.url, row.url, ats);
  }
});

test("an ATS without a detail step passes the row through mergeDetail unchanged", () => {
  const row = rowsFor("ashby", "examplecorp", "ashby.json")[0];
  strictEqual(mergeDetail("ashby", row, { anything: true }), row);
  strictEqual(detailEndpoint("ashby", { slug: "examplecorp", company: "Example Corp" }, row), null);
});
