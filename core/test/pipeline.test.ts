// The hunt and tailor pipeline end to end, through the compiled CLI, offline.
// `fetch` is a shell `case` over $URL that serves fixture pages from the
// workspace, so every command's file hand-off runs for real.

import { test } from "node:test";
import { deepStrictEqual, match, ok, strictEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve("dist/core/src/cli.js");
const run = (ws: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: ws, encoding: "utf8" });
const json = (ws: string, name: string) => JSON.parse(readFileSync(join(ws, name), "utf8"));

const searchPage = (jobs: unknown[]) =>
  `<html><body><script>\nwindow.SEEK_REDUX_DATA = ${JSON.stringify({ results: { results: { jobs } } })};\n</script></body></html>`;

const FETCH = `fetch: |
  case "$URL" in
    https://plain.test/careers) cat careers.html ;;
    https://plain.test/jobs/*) cat plain-job.html ;;
    */job/*) cat seek-job.html ;;
    *page=2*) cat seek-empty.html ;;
    *) cat seek-search.html ;;
  esac
cv:
  source: ./cv.md
  build: cp "$SOURCE" cv.out
  artifacts: [cv.out]
`;

function workspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "shortlist-pipeline-"));
  strictEqual(run(ws, "init").status, 0);
  writeFileSync(join(ws, "shortlist.yaml"), FETCH);
  writeFileSync(
    join(ws, "profile.yaml"),
    [
      "candidate:",
      "  name: Sam Rivera",
      "role_shapes:",
      "  - id: eng",
      "    keywords: [engineer, backend]",
      "    weight: 1",
      "red_flags: [java]",
      "boards:",
      "  seek: [https://nz.seek.com/engineer-jobs]",
      "",
    ].join("\n"),
  );
  writeFileSync(join(ws, "companies.yaml"), "- name: Plain Co\n  careers_url: https://plain.test/careers\n");
  writeFileSync(join(ws, "careers.html"), '<a href="/jobs/backend">Backend Engineer</a><a href="/about">About us</a>');
  writeFileSync(join(ws, "plain-job.html"), "<h1>Backend Engineer</h1><p>Build our backend in Go.</p>");
  writeFileSync(
    join(ws, "seek-search.html"),
    searchPage([
      { id: "90000001", title: "Senior Backend Engineer", companyName: "Example Corp", teaser: "Payments API." },
      { id: "90000002", title: "Backend Engineer", companyName: "Legacy Ltd", teaser: "A Java shop." },
    ]),
  );
  writeFileSync(join(ws, "seek-empty.html"), searchPage([]));
  copyFileSync(resolve("core/test/fixtures/seek-job.html"), join(ws, "seek-job.html"));
  writeFileSync(join(ws, "cv.md"), "# Sam Rivera\n- Built the payments API\n");
  return ws;
}

test("source, score, digest, mark, tailor, build and bundle hand their files to each other", () => {
  const ws = workspace();

  const source = run(ws, "source");
  strictEqual(source.status, 0, source.stderr);
  match(source.stderr, /3 candidates \(companies 1, seek 2\); 0 errors; 0 stale/);
  deepStrictEqual(json(ws, "sources.json"), { counts: { companies: 1, seek: 2 }, errors: [], stale: [] });
  deepStrictEqual(
    json(ws, "candidates.json").map((r: { source: string }) => r.source).sort(),
    ["bespoke", "seek", "seek"],
  );

  const score = run(ws, "score");
  strictEqual(score.status, 0, score.stderr);
  match(score.stderr, /2 survivors; 0 already decided; 1 filtered/);
  const survivors = json(ws, "survivors.json");
  const seekRole = survivors.find((s: { key: string }) => s.key === "seek:90000001");
  ok(seekRole.jd_text.includes("You will own the payments API."), "board survivor was hydrated from its job page");
  ok(survivors.some((s: { key: string; jd_text: string }) => s.key.startsWith("bespoke:") && s.jd_text.includes("Build our backend in Go.")));
  strictEqual(json(ws, "seen.json")["seek:90000002"].reason, "red_flag: java");

  writeFileSync(join(ws, "scores.json"), JSON.stringify([{ key: "seek:90000001", score: 8, rationale: "Go payments work." }]));
  const digest = run(ws, "digest");
  strictEqual(digest.status, 0, digest.stderr);
  const digestPath = digest.stdout.trim();
  const md = readFileSync(digestPath, "utf8");
  ok(md.indexOf("Senior Backend Engineer -- Example Corp") < md.indexOf("## Not scored by the model"));
  match(md, /## Not scored by the model[\s\S]*Backend Engineer -- Plain Co/);
  strictEqual(json(ws, "seen.json")["seek:90000001"].last_score, 8);

  writeFileSync(digestPath, md.replace("- [ ] tailor\n<!-- key: seek:90000001 -->", "- [x] tailor\n<!-- key: seek:90000001 -->"));
  const mark = run(ws, "mark", digestPath);
  strictEqual(mark.status, 0, mark.stderr);
  match(mark.stderr, /marked 1 shortlisted/);
  strictEqual(json(ws, "seen.json")["seek:90000001"].verdict, "shortlisted");

  const init = run(ws, "tailor", "init", "--last");
  strictEqual(init.status, 0, init.stderr);
  const folder = init.stdout.trim();
  match(folder, /-example-corp-senior-backend-engineer$/);

  const build = run(ws, "cv", "build", folder);
  strictEqual(build.status, 0, build.stderr);
  strictEqual(readFileSync(join(folder, "cv.out"), "utf8"), "# Sam Rivera\n- Built the payments API\n");

  writeFileSync(join(folder, "cover-letter.md"), "Hi,\n\nSam");
  const bundle = run(ws, "evidence", "bundle", folder);
  strictEqual(bundle.status, 0, bundle.stderr);
  const evidence = bundle.stdout.trim();
  for (const f of ["manifest.md", "cover-letter.md", "cv-tailored.md", "cv-master.md", "jd-snapshot.md"]) {
    ok(existsSync(join(evidence, f)), f);
  }

  strictEqual(run(ws, "set", "seek:90000001", "tailored").status, 0);
  const again = run(ws, "score");
  match(again.stderr, /1 survivors; 1 already decided; 1 filtered/);
});

test("digest without scores.json says so and still ranks every survivor", () => {
  const ws = workspace();
  run(ws, "source");
  run(ws, "score");
  const r = run(ws, "digest");
  strictEqual(r.status, 0, r.stderr);
  match(r.stderr, /no scores\.json: ranking on cheap scores only/);
  const md = readFileSync(r.stdout.trim(), "utf8");
  match(md, /## Not scored by the model[\s\S]*Senior Backend Engineer[\s\S]*Backend Engineer -- Plain Co|## Not scored by the model[\s\S]*Backend Engineer -- Plain Co[\s\S]*Senior Backend Engineer/);
});

test("score before source names the missing file", () => {
  const ws = workspace();
  const r = run(ws, "score");
  strictEqual(r.status, 1);
  match(r.stderr, /candidates\.json not found/);
});

test("a failing CV build exits 1 with the build's own error; no build command is not a failure", () => {
  const ws = workspace();
  writeFileSync(join(ws, "seen.json"), JSON.stringify({ "seek:90000001": { first_seen: "x", last_score: null, verdict: "shortlisted", url: "https://nz.seek.com/job/90000001", title: "Senior Backend Engineer", company: "Example Corp" } }));
  const folder = run(ws, "tailor", "init", "seek:90000001").stdout.trim();

  writeFileSync(join(ws, "shortlist.yaml"), `${FETCH.replace('cp "$SOURCE" cv.out', "echo typst said no >&2; exit 7")}`);
  const failed = run(ws, "cv", "build", folder);
  strictEqual(failed.status, 1);
  match(failed.stderr, /build exited 7:\ntypst said no/);
  match(failed.stderr, /missing artifacts: cv\.out/);

  writeFileSync(join(ws, "shortlist.yaml"), "cv:\n  source: ./cv.md\n");
  const none = run(ws, "cv", "build", folder);
  strictEqual(none.status, 0);
  match(none.stderr, /no cv\.build configured/);
});

test("evidence bundle names a declared repository that does not exist", () => {
  const ws = workspace();
  writeFileSync(join(ws, "seen.json"), JSON.stringify({ "seek:90000001": { first_seen: "x", last_score: null, verdict: "shortlisted", url: "https://nz.seek.com/job/90000001", title: "Senior Backend Engineer", company: "Example Corp" } }));
  const folder = run(ws, "tailor", "init", "seek:90000001").stdout.trim();
  writeFileSync(join(folder, "cover-letter.md"), "Hi");
  writeFileSync(join(ws, "shortlist.yaml"), `${FETCH}evidence:\n  repos: [./no-such-repo]\n`);
  const r = run(ws, "evidence", "bundle", folder);
  strictEqual(r.status, 0, r.stderr);
  match(r.stderr, /evidence repo not found: .*no-such-repo/);
});

test("detect-ats reads a saved careers page", () => {
  const ws = mkdtempSync(join(tmpdir(), "shortlist-detect-"));
  writeFileSync(join(ws, "careers.html"), '<a href="https://jobs.lever.co/example-limited">Jobs</a>');
  const r = run(ws, "detect-ats", "careers.html");
  strictEqual(r.status, 0, r.stderr);
  deepStrictEqual(JSON.parse(r.stdout), { ats: "lever", slug: "example-limited" });
});

test("every command that needs an argument exits 2 without one", () => {
  const ws = mkdtempSync(join(tmpdir(), "shortlist-usage-"));
  for (const args of [["detect-ats"], ["set"], ["set", "k"], ["mark"], ["tailor", "init"], ["cv", "build"], ["evidence", "bundle"]]) {
    const r = run(ws, ...args);
    strictEqual(r.status, 2, args.join(" "));
    match(r.stderr, /^usage: shortlist /, args.join(" "));
  }
});

test("each command's --help prints its usage", () => {
  const ws = mkdtempSync(join(tmpdir(), "shortlist-help-"));
  const r = run(ws, "set", "--help");
  strictEqual(r.status, 0);
  match(r.stdout, /^usage: shortlist set <key> <verdict> \[--force\]/);
  match(r.stdout, /Verdicts: new, shortlisted/);
});
