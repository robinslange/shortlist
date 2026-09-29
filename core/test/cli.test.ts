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
