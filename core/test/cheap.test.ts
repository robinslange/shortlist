import { test } from "node:test";
import { deepStrictEqual } from "node:assert/strict";
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
  locations: { reject: ["sydney"] },
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
