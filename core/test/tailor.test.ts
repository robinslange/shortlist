import { test } from "node:test";
import { deepStrictEqual, match, ok, rejects, strictEqual, throws } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Config } from "../src/config.ts";
import { runShell } from "../src/io.ts";
import { buildCv } from "../src/tailor/build.ts";
import { bundleEvidence } from "../src/tailor/evidence.ts";
import { folderName, initApplication, resolveTarget } from "../src/tailor/init.ts";
import type { SeenEntry } from "../src/types.ts";

const now = new Date(2026, 8, 28, 12, 0);
const JOB_PAGE = readFileSync(resolve("core/test/fixtures/seek-job.html"), "utf8");
const tmp = () => mkdtempSync(join(tmpdir(), "shortlist-tailor-"));

const config = (dir: string, over: Partial<Config> = {}): Config => ({
  dir,
  fetch: null,
  cv: { source: null, build: null, artifacts: [] },
  voice: { packs: [] },
  evidence: { repos: [] },
  output: { digests: join(dir, "digests"), applications: join(dir, "applications") },
  ...over,
});

const entry = (over: Partial<SeenEntry>): SeenEntry => ({ first_seen: "2026-09-01T00:00:00Z", last_score: null, verdict: "new", ...over });

const SEEN = {
  "seek:1": entry({ verdict: "shortlisted", shortlisted_at: "2026-09-20T00:00:00Z", url: "https://nz.seek.com/job/1", title: "Old", company: "Old Co" }),
  "seek:2": entry({ verdict: "shortlisted", shortlisted_at: "2026-09-25T00:00:00Z", url: "https://nz.seek.com/job/2", title: "Senior Backend Engineer", company: "Example Corp" }),
  "seek:3": entry({ verdict: "tailored", url: "https://nz.seek.com/job/3" }),
};

test("--last picks the most recently shortlisted role", () => {
  deepStrictEqual(resolveTarget("--last", SEEN), {
    key: "seek:2",
    url: "https://nz.seek.com/job/2",
    title: "Senior Backend Engineer",
    company: "Example Corp",
  });
});

test("--last passes over roles already tailored into a folder and roles without a url", () => {
  const seen = {
    ...SEEN,
    "seek:2": { ...SEEN["seek:2"], folder: "/somewhere/app" },
    "seek:4": entry({ verdict: "shortlisted", shortlisted_at: "2026-09-27T00:00:00Z" }),
  };
  strictEqual(resolveTarget("--last", seen).key, "seek:1");
});

test("--last with nothing shortlisted explains how to shortlist", () => {
  throws(() => resolveTarget("--last", {}), /shortlist mark/);
});

test("a seen key, a known URL and an unknown URL all resolve", () => {
  strictEqual(resolveTarget("seek:1", SEEN).url, "https://nz.seek.com/job/1");
  strictEqual(resolveTarget("https://nz.seek.com/job/3", SEEN).key, "seek:3");
  deepStrictEqual(resolveTarget("https://jobs.example.test/9", SEEN), { key: "url:https://jobs.example.test/9", url: "https://jobs.example.test/9" });
  throws(() => resolveTarget("not a thing", SEEN), /not a URL, a seen key or --last/);
});

test("two roles at one company on one day get separate folders", () => {
  const senior = folderName({ key: "a", url: "https://x.test/1", company: "Example Corp", title: "Senior Engineer" }, "2026-09-28");
  const staff = folderName({ key: "b", url: "https://x.test/2", company: "Example Corp", title: "Staff Engineer" }, "2026-09-28");
  strictEqual(senior, "2026-09-28-example-corp-senior-engineer");
  strictEqual(staff, "2026-09-28-example-corp-staff-engineer");
});

test("folderName uses the company, or the host when there is none", () => {
  strictEqual(folderName({ key: "k", url: "https://x.test", company: "Example Corp" }, "2026-09-28"), "2026-09-28-example-corp");
  strictEqual(folderName({ key: "k", url: "https://www.jobs.example.test/1" }, "2026-09-28"), "2026-09-28-jobs-example-test");
});

test("initApplication snapshots the posting, copies the CV and writes meta", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "cv.md"), "# Sam\n- Built the payments API");
  const target = resolveTarget("seek:2", SEEN);
  const folder = await initApplication(target, config(dir, { cv: { source: join(dir, "cv.md"), build: null, artifacts: [] } }), async () => JOB_PAGE, now);
  strictEqual(folder, join(dir, "applications", "2026-09-28-example-corp-senior-backend-engineer"));
  const snapshot = readFileSync(join(folder, "jd-snapshot.md"), "utf8");
  ok(snapshot.startsWith("# Senior Backend Engineer at Example Corp\n\nSource: https://nz.seek.com/job/2"));
  ok(snapshot.includes("You will own the payments API."));
  strictEqual(readFileSync(join(folder, "cv.md"), "utf8"), "# Sam\n- Built the payments API");
  const meta = JSON.parse(readFileSync(join(folder, "meta.json"), "utf8"));
  strictEqual(meta.key, "seek:2");
  strictEqual(meta.cv_source, "cv.md");
});

test("initApplication refuses to overwrite an existing folder", async () => {
  const dir = tmp();
  const target = resolveTarget("seek:2", SEEN);
  mkdirSync(join(dir, "applications", "2026-09-28-example-corp-senior-backend-engineer"), { recursive: true });
  await rejects(initApplication(target, config(dir), async () => JOB_PAGE, now), /already tailored/);
});

test("a bot-check page fails the init and leaves no folder behind", async () => {
  const dir = tmp();
  const target = resolveTarget("seek:2", SEEN);
  await rejects(initApplication(target, config(dir), async () => "<title>Just a moment...</title>", now), /bot check/);
  ok(!existsSync(join(dir, "applications", "2026-09-28-example-corp-senior-backend-engineer")));
});

test("init without a fetcher, or with a missing CV, fails before creating anything", async () => {
  const dir = tmp();
  const target = resolveTarget("seek:2", SEEN);
  await rejects(initApplication(target, config(dir), null, now), /needs a fetcher/);
  await rejects(
    initApplication(target, config(dir, { cv: { source: join(dir, "missing.md"), build: null, artifacts: [] } }), async () => JOB_PAGE, now),
    /cv.source not found/,
  );
  ok(!existsSync(join(dir, "applications")));
});

const readyFolder = (dir: string) => {
  const folder = join(dir, "applications", "app");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "meta.json"), JSON.stringify({ key: "seek:2", url: "https://nz.seek.com/job/2", title: "Senior Backend Engineer", company: "Example Corp", cv_source: "cv.md", created: "x" }));
  writeFileSync(join(folder, "cv.md"), "tailored cv");
  writeFileSync(join(folder, "jd-snapshot.md"), "posting");
  return folder;
};

test("no build command means nothing runs", async () => {
  deepStrictEqual(await buildCv(readyFolder(tmp()), config(tmp())), { ran: false, code: 0, stderr: "", missing: [] });
});

test("the build runs in the folder with SOURCE and FOLDER set, and checks its artifacts", async () => {
  const dir = tmp();
  const folder = readyFolder(dir);
  const ok1 = await buildCv(folder, config(dir, { cv: { source: null, build: 'printf %s "$SOURCE" > cv.pdf', artifacts: ["cv.pdf"] } }));
  deepStrictEqual(ok1, { ran: true, code: 0, stderr: "", missing: [] });
  strictEqual(readFileSync(join(folder, "cv.pdf"), "utf8"), join(folder, "cv.md"));
  const bad = await buildCv(folder, config(dir, { cv: { source: null, build: "echo broke >&2; exit 4", artifacts: ["other.pdf"] } }));
  strictEqual(bad.code, 4);
  match(bad.stderr, /broke/);
  deepStrictEqual(bad.missing, ["other.pdf"]);
});

test("the evidence bundle needs the letter", async () => {
  const dir = tmp();
  await rejects(bundleEvidence(readyFolder(dir), config(dir)), /missing in .*: cover-letter\.md/);
});

test("the evidence bundle copies the inputs and lists the repositories", async () => {
  const dir = tmp();
  const folder = readyFolder(dir);
  writeFileSync(join(folder, "cover-letter.md"), "letter");
  writeFileSync(join(dir, "master.md"), "master cv");
  const repo = join(dir, "repo");
  mkdirSync(repo);
  await runShell("git init -q && git -c user.name=t -c user.email=t@example.test commit -q --allow-empty -m init", {}, repo);

  const { dir: ev, missingRepos } = await bundleEvidence(
    folder,
    config(dir, { cv: { source: join(dir, "master.md"), build: null, artifacts: [] }, evidence: { repos: [repo, join(dir, "gone")] } }),
  );
  strictEqual(readFileSync(join(ev, "cv-tailored.md"), "utf8"), "tailored cv");
  strictEqual(readFileSync(join(ev, "cv-master.md"), "utf8"), "master cv");
  ok(existsSync(join(ev, "cover-letter.md")));
  ok(existsSync(join(ev, "jd-snapshot.md")));
  deepStrictEqual(missingRepos, [join(dir, "gone")]);
  const manifest = readFileSync(join(ev, "manifest.md"), "utf8");
  match(manifest, /Role: Senior Backend Engineer at Example Corp/);
  match(manifest, new RegExp(`- ${repo} \\(HEAD [0-9a-f]{7,} \\d{4}-\\d{2}-\\d{2}\\)`));
  match(manifest, /\(MISSING\)/);
});

test("a target without title or company still gets a snapshot heading, and no CV is fine", async () => {
  const dir = tmp();
  const folder = await initApplication({ key: "url:https://jobs.example.test/9", url: "https://jobs.example.test/9" }, config(dir), async () => "<p>Build things.</p>", now);
  strictEqual(folder, join(dir, "applications", "2026-09-28-jobs-example-test"));
  ok(readFileSync(join(folder, "jd-snapshot.md"), "utf8").startsWith("# https://jobs.example.test/9\n"));
  strictEqual(JSON.parse(readFileSync(join(folder, "meta.json"), "utf8")).cv_source, null);

  const titled = await initApplication({ key: "k", url: "https://jobs.example.test/10", title: "Platform Engineer" }, config(dir), async () => "<p>Run it.</p>", now);
  ok(readFileSync(join(titled, "jd-snapshot.md"), "utf8").startsWith("# Platform Engineer\n"));
});

test("a page with no readable text fails the init and leaves no folder", async () => {
  const dir = tmp();
  await rejects(initApplication(resolveTarget("seek:2", SEEN), config(dir), async () => "<script>app()</script>", now), /had no readable text/);
  ok(!existsSync(join(dir, "applications")));
});

test("with no CV in the folder the build still runs, with SOURCE empty", async () => {
  const dir = tmp();
  const folder = join(dir, "app");
  mkdirSync(folder);
  writeFileSync(join(folder, "meta.json"), JSON.stringify({ key: "k", url: "https://x.test", cv_source: null, created: "x" }));
  const r = await buildCv(folder, config(dir, { cv: { source: null, build: 'printf "[%s]" "$SOURCE" > out.txt', artifacts: [] } }));
  strictEqual(r.code, 0);
  strictEqual(readFileSync(join(folder, "out.txt"), "utf8"), "[]");
});

test("the evidence manifest handles no CV, no title, no repos, and a directory that is not a git repository", async () => {
  const dir = tmp();
  const folder = join(dir, "app");
  mkdirSync(folder);
  writeFileSync(join(folder, "meta.json"), JSON.stringify({ key: "k", url: "https://x.test/1", cv_source: null, created: "x" }));
  writeFileSync(join(folder, "cover-letter.md"), "letter");
  writeFileSync(join(folder, "jd-snapshot.md"), "posting");

  const bare = await bundleEvidence(folder, config(dir));
  const manifest = readFileSync(join(bare.dir, "manifest.md"), "utf8");
  match(manifest, /Role: unknown/);
  match(manifest, /None\. Only the master CV counts as ground truth\./);
  ok(!manifest.includes("cv-tailored"));

  const plain = join(dir, "plain");
  mkdirSync(plain);
  await bundleEvidence(folder, config(dir, { evidence: { repos: [plain] } }));
  match(readFileSync(join(bare.dir, "manifest.md"), "utf8"), new RegExp(`- ${plain} \\(not a git repository\\)`));
});

test("a configured master CV that has gone missing is left out of the bundle, not fatal", async () => {
  const dir = tmp();
  const folder = readyFolder(dir);
  writeFileSync(join(folder, "cover-letter.md"), "letter");
  const { dir: ev } = await bundleEvidence(folder, config(dir, { cv: { source: join(dir, "gone.md"), build: null, artifacts: [] } }));
  ok(existsSync(join(ev, "cv-tailored.md")));
  ok(!existsSync(join(ev, "cv-master.md")));
  ok(!readFileSync(join(ev, "manifest.md"), "utf8").includes("cv-master"));
});
