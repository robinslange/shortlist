// Assemble the verifier's input set, so a fresh agent starts from a defined
// bundle instead of exploring a filesystem it has never seen.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Config } from "../config.ts";
import { readJson } from "../files.ts";
import { runShell } from "../io.ts";
import type { ApplicationMeta } from "./init.ts";

export async function bundleEvidence(folder: string, config: Config): Promise<{ dir: string; missingRepos: string[] }> {
  const meta = readJson<ApplicationMeta>(join(folder, "meta.json"));
  const need = ["cover-letter.md", "jd-snapshot.md", ...(meta.cv_source ? [meta.cv_source] : [])];
  const absent = need.filter((f) => !existsSync(join(folder, f)));
  if (absent.length > 0) throw new Error(`missing in ${folder}: ${absent.join(", ")}`);

  const dir = join(folder, "evidence");
  mkdirSync(dir, { recursive: true });
  const files: Array<[string, string]> = [
    ["cover-letter.md", "the drafted letter"],
    ["jd-snapshot.md", "the job posting as fetched"],
  ];
  copyFileSync(join(folder, "cover-letter.md"), join(dir, "cover-letter.md"));
  copyFileSync(join(folder, "jd-snapshot.md"), join(dir, "jd-snapshot.md"));
  if (meta.cv_source) {
    const ext = extname(meta.cv_source);
    copyFileSync(join(folder, meta.cv_source), join(dir, `cv-tailored${ext}`));
    files.push([`cv-tailored${ext}`, "the tailored CV"]);
    if (config.cv.source && existsSync(config.cv.source)) {
      copyFileSync(config.cv.source, join(dir, `cv-master${ext}`));
      files.push([`cv-master${ext}`, "the master CV, which the candidate has reviewed"]);
    }
  }

  const missingRepos: string[] = [];
  const repoLines: string[] = [];
  for (const repo of config.evidence.repos) {
    if (!existsSync(repo)) {
      missingRepos.push(repo);
      repoLines.push(`- ${repo} (MISSING)`);
      continue;
    }
    const git = await runShell(`git -C "$REPO" log -1 --format='%h %cs'`, { REPO: repo }, folder);
    repoLines.push(git.code === 0 ? `- ${repo} (HEAD ${git.stdout.trim()})` : `- ${repo} (not a git repository)`);
  }

  const role = meta.title ? `${meta.title}${meta.company ? ` at ${meta.company}` : ""}` : "unknown";
  writeFileSync(
    join(dir, "manifest.md"),
    [
      "# Evidence bundle",
      "",
      `Role: ${role}`,
      `Posting: ${meta.url}`,
      `Application folder: ${folder}`,
      "",
      "## Files",
      ...files.map(([f, what]) => `- ${f}: ${what}`),
      "",
      "## Repositories declared as evidence",
      ...(repoLines.length > 0 ? repoLines : ["None. Only the master CV counts as ground truth."]),
      "",
    ].join("\n"),
  );
  return { dir, missingRepos };
}
