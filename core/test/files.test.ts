import { test } from "node:test";
import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { linkSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, writeJson } from "../src/files.ts";

test("readJson names the file when its JSON is malformed", () => {
  const path = join(mkdtempSync(join(tmpdir(), "shortlist-files-")), "scores.json");
  writeFileSync(path, '[{"key": "a",}]');
  throws(() => readJson(path), (e: Error) => e.message.startsWith(`${path}: `));
});

test("writeJson replaces the file in one step instead of rewriting it in place", () => {
  const dir = mkdtempSync(join(tmpdir(), "shortlist-files-"));
  const path = join(dir, "seen.json");
  writeFileSync(path, "old");
  // A second name for the same file: an in-place rewrite changes both names,
  // a write-then-rename leaves this one holding the old content.
  linkSync(path, join(dir, "snapshot"));
  writeJson(path, { a: 1 });
  deepStrictEqual(readJson(path), { a: 1 });
  strictEqual(readFileSync(join(dir, "snapshot"), "utf8"), "old");
  deepStrictEqual(readdirSync(dir).sort(), ["seen.json", "snapshot"]);
});
