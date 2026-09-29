import { test } from "node:test";
import { deepStrictEqual, match, strictEqual, throws } from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadCompanies, loadConfig, loadProfile, saveDetections } from "../src/config.ts";

const workspace = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "shortlist-config-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};

const PROFILE = "role_shapes:\n  - id: eng\n    keywords: [engineer]\n    weight: 1\n";

test("a missing shortlist.yaml points at init", () => {
  throws(() => loadConfig(workspace({})), /run `shortlist init`/);
});

test("an empty shortlist.yaml gives a working config with every default", () => {
  const dir = workspace({ "shortlist.yaml": "" });
  deepStrictEqual(loadConfig(dir), {
    dir,
    fetch: null,
    cv: { source: null, build: null, artifacts: [] },
    voice: { packs: [join(dir, "voice/default"), join(dir, "voice/yours")] },
    evidence: { repos: [] },
    output: { digests: join(dir, "digests"), applications: join(dir, "applications") },
  });
});

test("an unknown top-level key is refused by name", () => {
  throws(() => loadConfig(workspace({ "shortlist.yaml": "mode: hosted\n" })), /unknown key "mode"/);
});

test("an explicitly empty voice.packs stays empty", () => {
  deepStrictEqual(loadConfig(workspace({ "shortlist.yaml": "voice:\n  packs: []\n" })).voice.packs, []);
});

test("paths resolve against the workspace and ~ expands", () => {
  const dir = workspace({
    "shortlist.yaml": "cv:\n  source: ./cv/cv.md\nevidence:\n  repos: [~/code/app]\n",
  });
  const c = loadConfig(dir);
  strictEqual(c.cv.source, join(dir, "cv/cv.md"));
  deepStrictEqual(c.evidence.repos, [join(homedir(), "code/app")]);
});

test("malformed YAML names the file", () => {
  throws(() => loadConfig(workspace({ "shortlist.yaml": "cv: [unclosed\n" })), /shortlist\.yaml/);
});

test("a profile with an unknown key is refused by name", () => {
  const dir = workspace({ "profile.yaml": `${PROFILE}salary_floor: 90000\n` });
  throws(() => loadProfile(dir), /unknown key "salary_floor"/);
});

test("a profile with no role shapes is refused, since it would reject everything", () => {
  throws(() => loadProfile(workspace({ "profile.yaml": "red_flags: [java]\n" })), /role_shapes is empty/);
});

test("profile defaults fill in and partial source weights merge", () => {
  const p = loadProfile(workspace({ "profile.yaml": `${PROFILE}source_weights:\n  board: 0.5\n` }));
  deepStrictEqual(p.source_weights, { board: 0.5, ats_api: 1 });
  deepStrictEqual(p.boards, { seek: [] });
  deepStrictEqual(p.red_flags, []);
  deepStrictEqual(p.locations, { reject: [] });
  strictEqual(p.candidate.name, "");
});

test("no companies.yaml means no companies", () => {
  deepStrictEqual(loadCompanies(workspace({})), []);
});

test("a company without careers_url is refused with its position", () => {
  const dir = workspace({
    "companies.yaml": "- name: A\n  careers_url: https://a.test\n- name: B\n",
  });
  throws(() => loadCompanies(dir), /entry 2 needs name and careers_url/);
});

test("saveDetections writes ats, slug and secondary and keeps comments", () => {
  const dir = workspace({
    "companies.yaml": "# watched companies\n- name: A # the first one\n  careers_url: https://a.test\n",
  });
  saveDetections(dir, [
    { index: 0, result: { ats: "ashby", slug: "a", secondary: [{ ats: "workable", slug: "a" }] } },
  ]);
  const text = readFileSync(join(dir, "companies.yaml"), "utf8");
  match(text, /# watched companies/);
  match(text, /# the first one/);
  const [c] = loadCompanies(dir);
  strictEqual(c.ats, "ashby");
  strictEqual(c.slug, "a");
  deepStrictEqual(c.secondary_ats, [{ ats: "workable", slug: "a" }]);
});

test("unknown keys are refused one level down, with their dotted path", () => {
  throws(
    () => loadProfile(workspace({ "profile.yaml": `${PROFILE}candidate:\n  name: Sam\n  salary_floor: 90000\n` })),
    /unknown key "candidate\.salary_floor"/,
  );
  throws(
    () => loadProfile(workspace({ "profile.yaml": `${PROFILE}locations:\n  accept: [Wellington]\n` })),
    /unknown key "locations\.accept"/,
  );
  throws(() => loadConfig(workspace({ "shortlist.yaml": "cv:\n  biuld: make\n" })), /unknown key "cv\.biuld"/);
});

test("unknown keys inside list entries are refused with their position", () => {
  throws(
    () => loadProfile(workspace({ "profile.yaml": "role_shapes:\n  - id: eng\n    keyword: [engineer]\n    weight: 1\n" })),
    /unknown key "role_shapes\[0\]\.keyword"/,
  );
  throws(
    () => loadCompanies(workspace({ "companies.yaml": "- name: A\n  careers_url: https://a.test\n  atss: lever\n" })),
    /unknown key "\[0\]\.atss"/,
  );
});
