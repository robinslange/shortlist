// Seek board adapter.
//
// Seek's terms of service restrict automated access to its site. This adapter
// exists for one person looking for their own next job at a human pace: one
// page at a time, 750-1000ms apart, one run on demand. Using it is your call
// and your responsibility. Leave `boards.seek` empty in profile.yaml and it
// never runs.
//
// Seek serialises its search results into the page as
// `window.SEEK_REDUX_DATA = {...};` on a single line, and a job page carries
// its description in the element marked data-automation="jobAdDetails". Both
// parse out of raw HTML, so any fetcher that returns the page works.

import { stripHtml } from "../text.ts";
import type { RoleRow } from "../types.ts";

const DATA_MARKER = "window.SEEK_REDUX_DATA = ";
const JD_MARKER = 'data-automation="jobAdDetails"';

export function seekPageUrl(base: string, n: number): string {
  if (n === 1) return base;
  const u = new URL(base);
  u.searchParams.set("page", String(n));
  return u.href;
}

// null means the results data is missing or unparseable: the page format
// changed or the fetcher got something other than a results page.
export function parseSeekSearch(html: string, pageUrl: string): RoleRow[] | null {
  const at = html.indexOf(DATA_MARKER);
  if (at < 0) return null;
  const blob = html
    .slice(at + DATA_MARKER.length)
    .split("\n")[0]
    .split("</script>")[0]
    .trim()
    .replace(/;$/, "");

  let jobs: any;
  try {
    jobs = JSON.parse(blob)?.results?.results?.jobs;
  } catch {
    return null;
  }
  if (!Array.isArray(jobs)) return null;

  const seen = new Set<string>();
  const rows: RoleRow[] = [];
  for (const j of jobs) {
    const id = String(j?.id ?? "");
    const title = String(j?.title ?? "").trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      source: "seek",
      external_id: id,
      title,
      company: String(j.companyName || j.advertiser?.description || "").trim(),
      location: String(j.locations?.[0]?.label ?? ""),
      url: new URL(`/job/${id}`, pageUrl).href,
      posted_at: j.listingDate || undefined,
      comp_text: j.salaryLabel || undefined,
      jd_text: [j.teaser, (j.bulletPoints ?? []).join(". ")].filter(Boolean).join(" -- "),
    });
  }
  return rows;
}

export function parseSeekJob(html: string): string | null {
  const at = html.indexOf(JD_MARKER);
  if (at < 0) return null;
  // Stop at the next section, or at the start of the next tag Seek marks.
  const block = html.slice(html.indexOf(">", at) + 1).split(/<section\b|<[^<>]*\bdata-automation="/)[0];
  return stripHtml(block) || null;
}
