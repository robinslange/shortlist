import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { cheapScore } from "../src/score/cheap.ts";
import type { Profile, RoleRow } from "../src/types.ts";

const profile: Profile = {
  candidate: { name: "", location: "", summary: "" },
  role_shapes: [
    { id: "backend", keywords: ["backend", "golang"], weight: 2 },
    { id: "senior", keywords: ["senior"], weight: 1, must_have_signals: ["engineer"] },
  ],
  must_have_any: [{ signal: "engineering", any_of: ["engineer", "developer"] }],
  red_flags: ["commission only"],
  locations: { reject: ["sydney"], accept: [] },
  source_weights: { board: 0.5, ats_api: 1 },
  boards: { seek: [] },
};

const row = (over: Partial<RoleRow> = {}): RoleRow => ({
  source: "greenhouse",
  external_id: "examplecorp:1",
  title: "Senior Backend Engineer",
  company: "Example Corp",
  location: "Wellington",
  url: "https://example.test/1",
  jd_text: "Golang services.",
  ...over,
});

test("weights keyword hits per shape and multiplies by the ATS weight", () => {
  deepStrictEqual(cheapScore(row(), profile), { kind: "accepted", score: 5, matched_shapes: ["backend", "senior"] });
});

test("board sources (seek, bespoke) take the board weight", () => {
  deepStrictEqual(cheapScore(row({ source: "seek" }), profile), { kind: "accepted", score: 2.5, matched_shapes: ["backend", "senior"] });
  deepStrictEqual(cheapScore(row({ source: "bespoke" }), profile), { kind: "accepted", score: 2.5, matched_shapes: ["backend", "senior"] });
});

test("a red flag rejects, case-insensitively", () => {
  deepStrictEqual(cheapScore(row({ jd_text: "Commission Only role." }), profile), { kind: "rejected", reason: "red_flag: commission only" });
});

test("a rejected location rejects", () => {
  deepStrictEqual(cheapScore(row({ location: "Sydney, NSW" }), profile), { kind: "rejected", reason: "location_reject: sydney" });
});

test("a missing must-have rejects", () => {
  deepStrictEqual(cheapScore(row({ title: "Senior Backend Lead" }), profile), { kind: "rejected", reason: "missing_must_have: engineering" });
});

test("a shape's must-have signal gates that shape only", () => {
  deepStrictEqual(cheapScore(row({ title: "Senior Backend Developer" }), profile), { kind: "accepted", score: 4, matched_shapes: ["backend"] });
});

test("no shape match rejects", () => {
  deepStrictEqual(cheapScore(row({ title: "Office Engineer", jd_text: "Filing." }), profile), { kind: "rejected", reason: "no_role_shape_match" });
});

const base = (over: Partial<Profile>): Profile => ({ ...profile, must_have_any: [], red_flags: [], locations: { reject: [], accept: [] }, ...over });

test("keywords match whole words, so api does not match capital", () => {
  const p = base({ role_shapes: [{ id: "api", keywords: ["api"], weight: 1 }] });
  deepStrictEqual(cheapScore(row({ title: "Capital Markets Analyst", jd_text: "Venture capital." }), p), { kind: "rejected", reason: "no_role_shape_match" });
  deepStrictEqual(cheapScore(row({ title: "API Engineer", jd_text: "" }), p), { kind: "accepted", score: 1, matched_shapes: ["api"] });  const script = base({ role_shapes: [{ id: "s", keywords: ["script"], weight: 1 }] });
  deepStrictEqual(cheapScore(row({ title: "JavaScript Developer", jd_text: "" }), script), { kind: "rejected", reason: "no_role_shape_match" });
});

test("a red flag of java does not reject JavaScript roles", () => {
  const p = base({ red_flags: ["java"] });
  strictEqual(cheapScore(row({ jd_text: "Golang and JavaScript." }), p).kind, "accepted");
  deepStrictEqual(cheapScore(row({ jd_text: "Golang and Java." }), p), { kind: "rejected", reason: "red_flag: java" });
});

test("a trailing * matches any word that starts with it", () => {
  const p = base({ role_shapes: [{ id: "eng", keywords: ["engineer*"], weight: 1 }] });
  deepStrictEqual(cheapScore(row({ title: "Engineering Lead", jd_text: "" }), p), { kind: "accepted", score: 1, matched_shapes: ["eng"] });
});

test("keywords with symbols still match", () => {
  const p = base({ role_shapes: [{ id: "cpp", keywords: ["c++", "node.js"], weight: 1 }] });
  deepStrictEqual(cheapScore(row({ title: "C++ Developer", jd_text: "Some Node.js too." }), p), { kind: "accepted", score: 2, matched_shapes: ["cpp"] });
});

test("locations.accept keeps only roles whose location names an accepted place", () => {
  const p = base({ locations: { reject: [], accept: ["new zealand", "wellington"] } });
  deepStrictEqual(cheapScore(row({ location: "Remote, Canada" }), p), { kind: "rejected", reason: "location_not_accepted: Remote, Canada" });
  strictEqual(cheapScore(row({ location: "Wellington, NZ" }), p).kind, "accepted");
  strictEqual(cheapScore(row({ location: "" }), p).kind, "accepted", "an unknown location is not a rejection");
  deepStrictEqual(
    cheapScore(row({ location: "Remote, Canada", jd_text: "Golang. We also have a Wellington office." }), p),
    { kind: "rejected", reason: "location_not_accepted: Remote, Canada" },
    "a city named in the text does not make the role located there",
  );
});
