import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { voicePack } from "../src/voice/pack.ts";

const packDir = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "shortlist-voice-"));
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};

test("packs concatenate in order, files sorted, READMEs skipped", () => {
  const a = packDir({ "b.md": "rule b", "a.md": "rule a", "README.md": "not a rule", "notes.txt": "no" });
  const b = packDir({ "c.md": "rule c" });
  const { text, missing } = voicePack([a, b]);
  deepStrictEqual(missing, []);
  ok(text.indexOf("rule a") < text.indexOf("rule b"));
  ok(text.indexOf("rule b") < text.indexOf("rule c"));
  ok(!text.includes("not a rule"));
  ok(!text.includes("no\n"));
});

test("a missing pack is named and the others still print", () => {
  const a = packDir({ "a.md": "rule a" });
  const { text, missing } = voicePack(["/nonexistent/voice/pack", a]);
  deepStrictEqual(missing, ["/nonexistent/voice/pack"]);
  ok(text.includes("rule a"));
});

test("a pack entry may be a single file", () => {
  const a = packDir({ "one.md": "just this" });
  ok(voicePack([join(a, "one.md")]).text.includes("just this"));
});

test("no packs is an empty pack, not an error", () => {
  deepStrictEqual(voicePack([]), { text: "", missing: [] });
});

test("the shipped default pack has six rules", () => {
  strictEqual(readdirSync("voice/default").filter((f) => f.endsWith(".md")).length, 6);
});
