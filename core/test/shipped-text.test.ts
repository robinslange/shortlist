import { test } from "node:test";
import { deepStrictEqual } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SHIPPED = ["prompts", "voice", "adapters", "examples", "README.md"];

function files(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

test("shipped prose has no em or en dashes", () => {
  const hits = SHIPPED.flatMap(files).flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .flatMap((line, i) => (/[\u2013\u2014]/.test(line) ? [`${f}:${i + 1}`] : [])),
  );
  deepStrictEqual(hits, []);
});
