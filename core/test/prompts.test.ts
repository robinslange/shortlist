import { test } from "node:test";
import { ok } from "node:assert/strict";
import { readFileSync } from "node:fs";

const PROMPTS = ["01-score.md", "02-tailor-cv.md", "03-cover-letter.md", "04-verify.md"];

for (const name of PROMPTS) {
  test(`${name} states its input, its output and the rule it must not break`, () => {
    const text = readFileSync(`prompts/${name}`, "utf8");
    for (const heading of ["## Input", "## Output", "## The rule you must not break"]) {
      ok(text.includes(`\n${heading}\n`), `${name} lacks "${heading}"`);
    }
  });
}
