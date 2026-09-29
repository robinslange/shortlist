import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pageDescription } from "../boards/page.ts";
import type { Config } from "../config.ts";
import { writeJson } from "../files.ts";
import type { Fetcher } from "../io.ts";
import { localDate, looksBlocked, slugify } from "../text.ts";
import type { SeenStore } from "../types.ts";

export type TailorTarget = { key: string; url: string; title?: string; company?: string };

export type ApplicationMeta = TailorTarget & { cv_source: string | null; created: string };

export function resolveTarget(arg: string, seen: SeenStore): TailorTarget {
  if (arg === "--last") {
    const stamp = (k: string) => String(seen[k].shortlisted_at ?? seen[k].first_seen);
    const [key] = Object.keys(seen)
      .filter((k) => seen[k].verdict === "shortlisted" && seen[k].url && !seen[k].folder)
      .sort((a, b) => stamp(b).localeCompare(stamp(a)));
    if (!key) {
      throw new Error("nothing is shortlisted. tick `- [ ] tailor` in a digest, then run `shortlist mark <digest>`.");
    }
    return { key, url: seen[key].url!, title: seen[key].title, company: seen[key].company };
  }
  if (seen[arg]?.url) return { key: arg, url: seen[arg].url!, title: seen[arg].title, company: seen[arg].company };
  if (!/^https?:\/\//.test(arg)) throw new Error(`"${arg}" is not a URL, a seen key or --last`);
  const hit = Object.entries(seen).find(([, e]) => e.url === arg);
  return hit ? { key: hit[0], url: arg, title: hit[1].title, company: hit[1].company } : { key: `url:${arg}`, url: arg };
}

// The title keeps two roles at one company, tailored on one day, apart.
export function folderName(t: TailorTarget, today: string): string {
  const who = slugify(t.company || new URL(t.url).hostname.replace(/^www\./, ""));
  return [today, who, ...(t.title ? [slugify(t.title)] : [])].join("-");
}

// Every check that can fail runs before the folder exists, so a failed init
// leaves nothing half-built.
export async function initApplication(
  target: TailorTarget,
  config: Config,
  fetchPage: Fetcher | null,
  now: Date,
): Promise<string> {
  const folder = join(config.output.applications, folderName(target, localDate(now)));
  if (existsSync(folder)) throw new Error(`already tailored at ${folder}. delete the folder to redo.`);
  if (!fetchPage) throw new Error("tailor needs a fetcher: set `fetch` in shortlist.yaml");
  if (config.cv.source && !existsSync(config.cv.source)) throw new Error(`cv.source not found: ${config.cv.source}`);

  const html = await fetchPage(target.url);
  if (looksBlocked(html)) throw new Error(`${target.url} answered with a bot check. try a browser-based fetcher.`);
  const text = pageDescription(html).trim();
  if (!text) throw new Error(`${target.url} had no readable text`);

  mkdirSync(folder, { recursive: true });
  const heading = target.title ? `# ${target.title}${target.company ? ` at ${target.company}` : ""}` : `# ${target.url}`;
  writeFileSync(join(folder, "jd-snapshot.md"), `${heading}\n\nSource: ${target.url}\nFetched: ${now.toISOString()}\n\n${text}\n`);
  if (config.cv.source) copyFileSync(config.cv.source, join(folder, basename(config.cv.source)));
  const meta: ApplicationMeta = {
    ...target,
    cv_source: config.cv.source ? basename(config.cv.source) : null,
    created: now.toISOString(),
  };
  writeJson(join(folder, "meta.json"), meta);
  return folder;
}
