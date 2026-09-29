import { test } from "node:test";
import { ok, rejects, strictEqual } from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFetcher, politeDelay, runShell } from "../src/io.ts";

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "shortlist-io-")));

test("runShell passes env and runs in cwd", async () => {
  const dir = tmp();
  const r = await runShell('printf %s "$X"; pwd >&2', { X: "hello" }, dir);
  strictEqual(r.code, 0);
  strictEqual(r.stdout, "hello");
  strictEqual(r.stderr.trim(), dir);
});

test("a URL full of shell syntax reaches the fetcher literally and runs nothing", async () => {
  const dir = tmp();
  const fetchPage = makeFetcher('printf %s "$URL"', dir)!;
  const url = 'https://x.test/?q=1"; touch pwned; echo "$(touch pwned2)`touch pwned3`';
  strictEqual(await fetchPage(url), url);
  ok(!existsSync(join(dir, "pwned")));
  ok(!existsSync(join(dir, "pwned2")));
  ok(!existsSync(join(dir, "pwned3")));
});

test("a failing fetch command rejects with its exit code and stderr", async () => {
  const fetchPage = makeFetcher("echo nope >&2; exit 3", tmp())!;
  await rejects(fetchPage("https://x.test"), /fetch exited 3: nope/);
});

test("no fetch command means no fetcher", () => {
  strictEqual(makeFetcher(null, tmp()), null);
});

test("the politeness delay stays within 750 to 1000ms", () => {
  for (let i = 0; i < 200; i++) {
    const d = politeDelay();
    ok(d >= 750 && d < 1000, `delay ${d}`);
  }
});

test("http sends method, headers and body, and returns status and text for any status", async () => {
  const { createServer } = await import("node:http");
  const seen: Array<{ method?: string; type?: string; body: string }> = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen.push({ method: req.method, type: req.headers["content-type"], body });
      res.statusCode = req.url === "/missing" ? 404 : 200;
      res.end(req.url === "/missing" ? "gone" : '{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const { http } = await import("../src/io.ts");
    const post = await http({ url: `${base}/jobs`, method: "POST", headers: { "content-type": "application/json" }, body: '{"limit":20}' });
    strictEqual(post.status, 200);
    strictEqual(post.body, '{"ok":true}');
    const missing = await http({ url: `${base}/missing` });
    strictEqual(missing.status, 404);
    strictEqual(missing.body, "gone");
    strictEqual(seen[0].method, "POST");
    strictEqual(seen[0].type, "application/json");
    strictEqual(seen[0].body, '{"limit":20}');
    strictEqual(seen[1].method, "GET");
  } finally {
    server.close();
  }
});
