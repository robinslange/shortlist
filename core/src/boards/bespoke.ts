// Fallback for careers pages with no detectable ATS: keep the links whose text
// looks like a role, judged by the profile's role-shape keywords. The rows
// carry only the link text; `shortlist score` fetches the full page for the
// ones that survive.

import { hasTerm, slugify, stripHtml } from "../text.ts";
import type { RoleRow } from "../types.ts";

const ANCHOR = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

export function anchorRows(html: string, careersUrl: string, company: string, keywords: string[]): RoleRow[] {
  const slug = slugify(company);
  const seen = new Set<string>();
  const rows: RoleRow[] = [];

  for (const m of html.matchAll(ANCHOR)) {
    const href = m[1];
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    const title = stripHtml(m[2]).replace(/\s+/g, " ");
    if (title.length < 3 || title.length > 120) continue;
    if (!keywords.some((k) => hasTerm(title, k))) continue;

    let url: string;
    try {
      url = new URL(href, careersUrl).href;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    rows.push({
      source: "bespoke",
      external_id: `${slug}:${url}`,
      title,
      company,
      location: "",
      url,
      jd_text: title,
    });
  }
  return rows;
}
