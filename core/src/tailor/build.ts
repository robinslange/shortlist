import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { readJson } from "../files.ts";
import { runShell } from "../io.ts";
import type { ApplicationMeta } from "./init.ts";

export type BuildResult = { ran: boolean; code: number; stderr: string; missing: string[] };

export async function buildCv(folder: string, config: Config): Promise<BuildResult> {
  if (!config.cv.build) return { ran: false, code: 0, stderr: "", missing: [] };
  const meta = readJson<ApplicationMeta>(join(folder, "meta.json"));
  const source = meta.cv_source ? join(folder, meta.cv_source) : "";
  const r = await runShell(config.cv.build, { FOLDER: folder, SOURCE: source }, folder);
  return {
    ran: true,
    code: r.code,
    stderr: r.stderr,
    missing: config.cv.artifacts.filter((a) => !existsSync(join(folder, a))),
  };
}
