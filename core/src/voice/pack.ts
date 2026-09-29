// Concatenate voice rule packs for the drafting prompts. A pack is a folder of
// Markdown rules or a single file. A pack that does not exist is named, never
// silently skipped: renamed rule files are how voice rules rot.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function voicePack(packs: string[]): { text: string; missing: string[] } {
  const parts: string[] = [];
  const missing: string[] = [];
  for (const pack of packs) {
    if (!existsSync(pack)) {
      missing.push(pack);
      continue;
    }
    const files = statSync(pack).isDirectory()
      ? readdirSync(pack)
          .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
          .sort()
          .map((f) => join(pack, f))
      : [pack];
    for (const f of files) {
      parts.push(`--- ${basename(dirname(f))}/${basename(f)} ---\n${readFileSync(f, "utf8").trim()}\n`);
    }
  }
  return { text: parts.join("\n"), missing };
}
