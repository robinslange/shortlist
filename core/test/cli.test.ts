import { test } from "node:test";
import { match, ok, strictEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve("dist/core/src/cli.js");
const JOB_PAGE = resolve("core/test/fixtures/seek-job.html");
const run = (ws: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: ws, encoding: "utf8" });
const fresh = () => {
  const ws = mkdtempSync(join(tmpdir(), "shortlist-e2e-"));
  strictEqual(run(ws, "init").status, 0);
  return ws;
};

test("init makes a workspace and never overwrites a file", () => {
  const ws = fresh();
  for (const f of ["shortlist.yaml", "profile.yaml", "companies.yaml", "prompts/04-verify.md", "voice/default/no-dashes.md", "voice/yours/README.md"]) {
    ok(existsSync(join(ws, f)), f);
  }
  writeFileSync(join(ws, "profile.yaml"), "edited");
  const again = run(ws, "init");
  strictEqual(again.status, 0);
  strictEqual(readFileSync(join(ws, "profile.yaml"), "utf8"), "edited");
  match(again.stdout, /skipped profile\.yaml/);
});

test("the example workspace loads: voice pack prints the default rules", () => {
  const r = run(fresh(), "voice", "pack");
  strictEqual(r.status, 0, r.stderr);
  match(r.stdout, /# No em or en dashes/);
});

test("tailor init, set, and the regression refusal work end to end", () => {
  const ws = fresh();
  writeFileSync(join(ws, "shortlist.yaml"), `fetch: cat "${JOB_PAGE}"\ncv:\n  source: ./cv.md\n`);
  writeFileSync(join(ws, "cv.md"), "# Sam Rivera\n");
  writeFileSync(
    join(ws, "seen.json"),
    JSON.stringify({
      "seek:90000001": {
        first_seen: "2026-09-20T00:00:00Z",
        last_score: 8,
        verdict: "shortlisted",
        shortlisted_at: "2026-09-21T00:00:00Z",
        url: "https://nz.seek.com/job/90000001",
        title: "Senior Backend Engineer",
        company: "Example Corp",
      },
    }),
  );

  const init = run(ws, "tailor", "init", "--last");
  strictEqual(init.status, 0, init.stderr);
  const folder = init.stdout.trim();
  ok(readFileSync(join(folder, "jd-snapshot.md"), "utf8").includes("You will own the payments API."));
  ok(existsSync(join(folder, "cv.md")));

  strictEqual(run(ws, "set", "seek:90000001", "tailored").status, 0);
  const back = run(ws, "set", "seek:90000001", "shortlisted");
  strictEqual(back.status, 3);
  match(back.stderr, /refusing/);
  strictEqual(run(ws, "set", "seek:90000001", "bogus").status, 2);
});

test("help, unknown commands and missing arguments", () => {
  const ws = fresh();
  strictEqual(run(ws, "--help").status, 0);
  match(run(ws, "source", "--help").stdout, /terms of service/);
  strictEqual(run(ws, "nonsense").status, 2);
  strictEqual(run(ws, "mark").status, 2);
});

test("a command outside a workspace says to run init", () => {
  const r = run(mkdtempSync(join(tmpdir(), "shortlist-empty-")), "voice", "pack");
  strictEqual(r.status, 1);
  match(r.stderr, /run `shortlist init`/);
});

test("large output survives a pipe: the process does not exit before stdout drains", () => {
  const ws = fresh();
  const rule = "x".repeat(3_000_000);
  writeFileSync(join(ws, "voice", "yours", "big.md"), rule);
  const r = spawnSync(process.execPath, [CLI, "voice", "pack"], { cwd: ws, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  strictEqual(r.status, 0, r.stderr);
  ok(r.stdout.includes(rule), `stdout was ${r.stdout.length} chars`);
});

test("set --force moves a role backwards on purpose", () => {
  const ws = fresh();
  writeFileSync(join(ws, "seen.json"), JSON.stringify({ k: { first_seen: "x", last_score: null, verdict: "applied" } }));
  strictEqual(run(ws, "set", "k", "tailored").status, 3);
  const forced = run(ws, "set", "k", "tailored", "--force");
  strictEqual(forced.status, 0, forced.stderr);
  strictEqual(JSON.parse(readFileSync(join(ws, "seen.json"), "utf8")).k.verdict, "tailored");
});

test("init into a named directory creates it", () => {
  const parent = mkdtempSync(join(tmpdir(), "shortlist-initdir-"));
  const r = run(parent, "init", "search");
  strictEqual(r.status, 0, r.stderr);
  ok(existsSync(join(parent, "search", "shortlist.yaml")));
});

test("help, -h and no arguments all print the overview", () => {
  const ws = fresh();
  for (const args of [[], ["help"], ["-h"]]) {
    const r = run(ws, ...args);
    strictEqual(r.status, 0, args.join(" "));
    match(r.stdout, /shortlist init \[dir\]/);
  }
  match(run(ws, "digest", "-h").stdout, /^usage: shortlist digest/);
});

test("--version prints the package version", () => {
  const r = run(fresh(), "--version");
  strictEqual(r.status, 0);
  strictEqual(r.stdout.trim(), JSON.parse(readFileSync(resolve("package.json"), "utf8")).version);
});

test("names that exist on every object are unknown commands, not crashes", () => {
  const ws = fresh();
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    const r = run(ws, name, "x");
    strictEqual(r.status, 2, name);
    match(r.stderr, new RegExp(`unknown command "${name}"`));
  }
});

test("init ends by saying what to do next", () => {
  const r = run(mkdtempSync(join(tmpdir(), "shortlist-next-")), "init");
  match(r.stdout, /Next:[\s\S]*profile\.yaml[\s\S]*companies\.yaml[\s\S]*shortlist source/);
});

test("each step run too early names the step to run first", () => {
  const ws = fresh();
  match(run(ws, "score").stderr, /candidates\.json not found\. run `shortlist source` first/);
  match(run(ws, "digest").stderr, /survivors\.json not found\. run `shortlist score` first/);
  writeFileSync(join(ws, "survivors.json"), "[]");
  match(run(ws, "digest").stderr, /sources\.json not found\. run `shortlist source` first/);
});

test("a missing digest or careers file is named plainly", () => {
  const ws = fresh();
  const mark = run(ws, "mark", "digests/nope.md");
  strictEqual(mark.status, 1);
  match(mark.stderr, /^shortlist: digests\/nope\.md not found/);
  match(run(ws, "detect-ats", "nope.html").stderr, /^shortlist: nope\.html not found/);
});

test("set refuses a key it has never seen, so a typo cannot invent a role", () => {
  const ws = fresh();
  writeFileSync(join(ws, "seen.json"), JSON.stringify({ "seek:1": { first_seen: "x", last_score: null, verdict: "new" } }));
  const r = run(ws, "set", "seek:2", "skipped");
  strictEqual(r.status, 2);
  match(r.stderr, /no role "seek:2" in seen\.json/);
  strictEqual(run(ws, "set", "seek:1", "skipped").status, 0);
});
