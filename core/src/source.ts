// Gathers candidate roles from the company list and the job boards.
// Nothing here throws for a single source: each failure becomes a line in
// summary.errors, which the digest prints as its footer.

import { detectAts } from "./ats/detect.ts";
import { detailEndpoint, listEndpoint, listTotal, mergeDetail, needsHydrate, normalise, parseBody } from "./ats/dispatch.ts";
import type { DispatchCtx } from "./ats/dispatch.ts";
import { anchorRows } from "./boards/bespoke.ts";
import { parseSeekSearch, seekPageUrl } from "./boards/seek.ts";
import type { Fetcher, Http } from "./io.ts";
import { politeDelay } from "./io.ts";
import { seenKey } from "./seen.ts";
import { looksBlocked, slugify } from "./text.ts";
import type { AtsKind, Company, DetectorResult, Profile, RoleRow, SourceSummary } from "./types.ts";

export const SEEK_MAX_PAGES = 25;

export type SourceDeps = {
  http: Http;
  fetchPage: Fetcher | null;
  sleep: (ms: number) => Promise<void>;
  // One line per company and per board search, so a long run shows progress.
  log: (line: string) => void;
};

const roles = (n: number) => `${n} role${n === 1 ? "" : "s"}`;

export type SourceResult = {
  rows: RoleRow[];
  summary: SourceSummary;
  detections: Array<{ index: number; result: DetectorResult }>;
};

const message = (e: unknown) => (e as Error).message;

async function page(deps: SourceDeps, url: string): Promise<string> {
  if (!deps.fetchPage) throw new Error("no fetcher configured");
  const html = await deps.fetchPage(url);
  if (looksBlocked(html)) throw new Error(`blocked at ${url} (bot check)`);
  return html;
}

export async function runSource(companies: Company[], profile: Profile, deps: SourceDeps): Promise<SourceResult> {
  const out: SourceResult = {
    rows: [],
    summary: { counts: { companies: 0, seek: 0 }, errors: [], stale: [] },
    detections: [],
  };
  const keywords = profile.role_shapes.flatMap((s) => s.keywords);

  for (const [index, c] of companies.entries()) {
    const errorsBefore = out.summary.errors.length;
    const staleBefore = out.summary.stale.length;
    let found = 0;
    let targets: Target[] = [];
    try {
      targets = await resolveTargets(c, index, deps, out);
    } catch (e) {
      out.summary.errors.push(`${c.name}: ${message(e)}`);
    }
    // A careers page can link more than one board; each is read, and one
    // failing does not lose the others.
    for (const target of targets) {
      try {
        const rows =
          target.ats === "bespoke"
            ? anchorRows(await page(deps, c.careers_url), c.careers_url, c.name, keywords)
            : await apiRows(target.ats, { slug: target.slug, company: c.name }, deps, out);
        out.rows.push(...rows);
        out.summary.counts.companies += rows.length;
        found += rows.length;
      } catch (e) {
        out.summary.errors.push(`${c.name}: ${message(e)}`);
      }
    }
    const errors = out.summary.errors.slice(errorsBefore);
    for (const e of errors) deps.log(e);
    if (out.summary.stale.length > staleBefore) deps.log(`${c.name}: board not found; blank ats and slug in companies.yaml to detect it again`);
    else if (found > 0 || errors.length === 0) deps.log(`${c.name}: ${roles(found)}`);
    await deps.sleep(politeDelay());
  }

  await seekRows(profile.boards.seek, deps, out);

  const byKey = new Map(out.rows.map((r) => [seenKey(r.source, r.external_id), r]));
  out.rows = [...byKey.values()];
  return out;
}

type Target = { ats: AtsKind; slug: string };

async function resolveTargets(c: Company, index: number, deps: SourceDeps, out: SourceResult): Promise<Target[]> {
  if (c.ats === "bespoke") return [{ ats: "bespoke", slug: c.slug ?? slugify(c.name) }];
  if (c.ats && c.slug) return [{ ats: c.ats, slug: c.slug }, ...(c.secondary_ats ?? [])];
  const found = detectAts(await page(deps, c.careers_url));
  if (!found) return [{ ats: "bespoke", slug: slugify(c.name) }];
  out.detections.push({ index, result: found });
  return [{ ats: found.ats, slug: found.slug }, ...(found.secondary ?? [])];
}

async function apiRows(ats: AtsKind, ctx: DispatchCtx, deps: SourceDeps, out: SourceResult): Promise<RoleRow[]> {
  const res = await deps.http(listEndpoint(ats, ctx)!);
  if (res.status === 404) {
    // Not transient: the cached slug is wrong, usually an ATS migration.
    out.summary.stale.push(ctx.company);
    return [];
  }
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  const payload = parseBody(ats, res.body);
  const rows = normalise(ats, payload, ctx);
  const total = listTotal(ats, payload);
  if (total !== null && total > rows.length) {
    out.summary.errors.push(
      `${ctx.company}: read ${rows.length} of ${total} roles; this ATS pages its results and shortlist reads only the first page`,
    );
  }
  if (!needsHydrate(ats)) return rows;

  const hydrated: RoleRow[] = [];
  for (const row of rows) {
    await deps.sleep(politeDelay());
    try {
      const d = await deps.http(detailEndpoint(ats, ctx, row)!);
      if (d.status >= 400) throw new Error(`HTTP ${d.status}`);
      hydrated.push(mergeDetail(ats, row, JSON.parse(d.body)));
    } catch (e) {
      out.summary.errors.push(`${ctx.company}: hydrate ${row.external_id}: ${message(e)}`);
      hydrated.push(row);
    }
  }
  return hydrated;
}

async function seekRows(urls: string[], deps: SourceDeps, out: SourceResult): Promise<void> {
  const fail = (line: string) => {
    out.summary.errors.push(line);
    deps.log(line);
  };
  for (const base of urls) {
    let found = 0;
    for (let n = 1; n <= SEEK_MAX_PAGES; n++) {
      const url = seekPageUrl(base, n);
      let html: string;
      try {
        html = await page(deps, url);
      } catch (e) {
        fail(`seek: ${message(e)}`);
        return;
      }
      const rows = parseSeekSearch(html, url);
      if (rows === null) {
        fail(`seek: no results data in ${url}; the page format may have changed`);
        return;
      }
      if (rows.length === 0) break;
      out.rows.push(...rows);
      out.summary.counts.seek += rows.length;
      found += rows.length;
      if (n === SEEK_MAX_PAGES) {
        fail(`seek: stopped after ${SEEK_MAX_PAGES} pages of ${base}; narrow the search to see the rest`);
      }
      await deps.sleep(politeDelay());
    }
    deps.log(`seek ${base}: ${roles(found)}`);
  }
}
