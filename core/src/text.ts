// Pure text helpers shared by every source and the tailor.

import { createHash } from "node:crypto";

// &amp; goes last so an escaped entity is decoded exactly once.
const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/g, " "],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;|&#x27;/g, "'"],
  [/&amp;/g, "&"],
];

export function decodeEntities(s: string): string {
  return ENTITIES.reduce((acc, [re, ch]) => acc.replace(re, ch), s);
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      // A tag starts with a letter, / or !; a bare "<" in text is left alone.
      .replace(/<[/!?]?[a-zA-Z!][^>]*>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const BLOCKED_TITLES = [/<title>[^<]*access denied/i, /<title>\s*just a moment/i];

// Challenge pages are tiny. A real job ad can say "verify you are human" too
// (bot-management companies hire), so the phrase only counts on a short page.
export function looksBlocked(html: string): boolean {
  if (BLOCKED_TITLES.some((re) => re.test(html))) return true;
  return /verify you are human/i.test(html) && stripHtml(html).length < 1500;
}

export function slugify(s: string): string {
  const slug = s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  if (slug) return slug;
  // No Latin letters or digits survive (a title in Japanese, say): a short hash
  // keeps two such titles apart and stays the same across runs.
  return /[\p{L}\p{N}]/u.test(s) ? `role-${createHash("sha256").update(s).digest("hex").slice(0, 8)}` : "role";
}

export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
