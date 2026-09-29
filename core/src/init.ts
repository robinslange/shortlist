// Copy the shipped examples, prompts and voice rules into a workspace.
// Existing files are never overwritten.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const SHIPPED = ["examples/shortlist.yaml", "examples/profile.yaml", "examples/companies.yaml", "examples/cv", "prompts", "voice"];

function walk(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).sort().flatMap((name) => walk(join(path, name)));
}

export function initWorkspace(pkgRoot: string, dir: string): { created: string[]; skipped: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];
  for (const item of SHIPPED) {
    for (const from of walk(join(pkgRoot, item))) {
      const rel = relative(pkgRoot, from).replace(/^examples[\\/]/, "");
      const to = join(dir, rel);
      if (existsSync(to)) {
        skipped.push(rel);
        continue;
      }
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      created.push(rel);
    }
  }
  return { created, skipped };
}
