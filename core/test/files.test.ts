import { test } from "node:test";
import { throws } from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson } from "../src/files.ts";

test("readJson names the file when its JSON is malformed", () => {
  const path = join(mkdtempSync(join(tmpdir(), "shortlist-files-")), "scores.json");
  writeFileSync(path, '[{"key": "a",}]');
  throws(() => readJson(path), (e: Error) => e.message.startsWith(`${path}: `));
});
