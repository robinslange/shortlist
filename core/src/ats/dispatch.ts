// Pure: ATS endpoint table and response normalisers. All IO is injected.

import { XMLParser } from "fast-xml-parser";
import { decodeEntities, stripHtml } from "../text.ts";
import type { AtsKind, RoleRow } from "../types.ts";

export type DispatchCtx = { slug: string; company: string };

export type Endpoint = {
  url: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
};

const JSON_ACCEPT = { accept: "application/json" };

// Workday needs tenant, wd host and site. It carries them in the one slug
// field as "tenant/wdN/Site" so no other ATS grows a Workday-shaped bulge.
export function workdayParts(slug: string): { tenant: string; host: string; site: string } {
  const [tenant, host, site] = slug.split("/");
  if (!tenant || !host || !site) {
    throw new Error(`workday slug must be "tenant/wdN/Site", got: ${slug}`);
  }
  return { tenant, host, site };
}

const asArray = <T,>(v: T | T[] | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

// The part of external_id after the "{slug}:" prefix.
const idPart = (row: RoleRow): string => row.external_id.split(":").slice(1).join(":");

// schema.org Place[] as served in a Teamtailor JSON Feed item.
function schemaPlace(places: unknown): string {
  const a = (Array.isArray(places) ? places[0] : places) as any;
  const addr = a?.address ?? {};
  return [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ");
}

// Personio serves XML; every other ATS serves JSON.
export function parseBody(ats: AtsKind, body: string): unknown {
  return ats === "personio" ? body : JSON.parse(body);
}

export function listEndpoint(ats: AtsKind, ctx: DispatchCtx): Endpoint | null {
  const s = encodeURIComponent(ctx.slug);
  switch (ats) {
    case "ashby":
      return { url: `https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true` };
    case "lever":
      return { url: `https://api.lever.co/v0/postings/${s}?mode=json` };
    case "greenhouse":
      return { url: `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true` };
    case "workable":
      return { url: `https://apply.workable.com/api/v1/widget/accounts/${s}` };
    case "teamtailor":
      return { url: `https://${s}.teamtailor.com/jobs.json` };
    case "recruitee":
      return { url: `https://${s}.recruitee.com/api/offers/` };
    case "smartrecruiters":
      return { url: `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100` };
    case "personio":
      return { url: `https://${s}.jobs.personio.de/xml` };
    case "bamboohr":
      return { url: `https://${s}.bamboohr.com/careers/list`, headers: JSON_ACCEPT };
    case "workday": {
      const { tenant, host, site } = workdayParts(ctx.slug);
      return {
        url: `https://${tenant}.${host}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`,
        method: "POST",
        headers: { "content-type": "application/json", ...JSON_ACCEPT },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "" }),
      };
    }
    default:
      return null; // bespoke is a page scrape, not an API
  }
}

// Workday and SmartRecruiters page their list and report the full count.
// Only the first page is read (every listed role costs a detail call), so the
// count is what lets a run say how much it did not read.
export function listTotal(ats: AtsKind, payload: unknown): number | null {
  const p = payload as any;
  if (ats === "workday") return p?.total ?? null;
  if (ats === "smartrecruiters") return p?.totalFound ?? null;
  return null;
}

// These four omit the description from their list response. Their rows arrive
// with jd_text "" and take one detail call each before scoring.
export function needsHydrate(ats: AtsKind): boolean {
  return ats === "smartrecruiters" || ats === "workday" || ats === "workable" || ats === "bamboohr";
}

export function detailEndpoint(ats: AtsKind, ctx: DispatchCtx, row: RoleRow): Endpoint | null {
  const s = encodeURIComponent(ctx.slug);
  const id = encodeURIComponent(idPart(row));
  switch (ats) {
    case "smartrecruiters":
      return { url: `https://api.smartrecruiters.com/v1/companies/${s}/postings/${id}` };
    case "workday": {
      const { tenant, host, site } = workdayParts(ctx.slug);
      return {
        url: `https://${tenant}.${host}.myworkdayjobs.com/wday/cxs/${tenant}/${site}${idPart(row)}`,
        headers: JSON_ACCEPT,
      };
    }
    case "workable":
      return { url: `https://apply.workable.com/api/v1/accounts/${s}/jobs/${id}`, headers: JSON_ACCEPT };
    case "bamboohr":
      return { url: `https://${s}.bamboohr.com/careers/${id}/detail`, headers: JSON_ACCEPT };
    default:
      return null;
  }
}

export function mergeDetail(ats: AtsKind, row: RoleRow, payload: unknown): RoleRow {
  const p = payload as any;
  if (ats === "smartrecruiters") {
    const sections = p?.jobAd?.sections ?? {};
    const text = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"]
      .map((k) => sections[k]?.text)
      .filter(Boolean)
      .join("\n\n");
    return { ...row, jd_text: stripHtml(text), url: p?.postingUrl || p?.applyUrl || row.url };
  }
  if (ats === "workable") {
    const text = [p?.description, p?.requirements, p?.benefits].filter(Boolean).join("\n\n");
    return { ...row, jd_text: stripHtml(text) };
  }
  if (ats === "workday") {
    const info = p?.jobPostingInfo ?? {};
    return {
      ...row,
      jd_text: stripHtml(info.jobDescription ?? ""),
      url: info.externalUrl || row.url,
      posted_at: info.startDate || row.posted_at,
    };
  }
  if (ats === "bamboohr") {
    const o = p?.result?.jobOpening ?? {};
    return { ...row, jd_text: stripHtml(o.description ?? ""), url: o.jobOpeningShareUrl || row.url };
  }
  return row;
}

export function normalise(ats: AtsKind, payload: unknown, ctx: DispatchCtx): RoleRow[] {
  const p = payload as any;
  const base = { source: ats as RoleRow["source"], company: ctx.company };

  switch (ats) {
    case "ashby":
      return asArray(p?.jobs).map((j: any) => ({
        ...base,
        external_id: `${ctx.slug}:${j.id}`,
        title: j.title ?? "",
        location: j.location ?? j.locationName ?? "",
        url: j.jobUrl ?? `https://jobs.ashbyhq.com/${ctx.slug}/${j.id}`,
        comp_text: j.compensation?.compensationTierSummary || undefined,
        posted_at: j.publishedAt || undefined,
        jd_text: j.descriptionPlain ?? "",
      }));

    case "lever":
      return asArray(p).map((j: any) => ({
        ...base,
        external_id: `${ctx.slug}:${j.id}`,
        title: j.text ?? "",
        location: j.categories?.location ?? "",
        url: j.hostedUrl ?? "",
        posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
        jd_text: [
          j.descriptionPlain || stripHtml(j.description ?? ""),
          ...asArray(j.lists).map((l: any) => `${l?.text ?? ""}\n${stripHtml(l?.content ?? "")}`),
        ]
          .filter(Boolean)
          .join("\n\n")
          .trim(),
      }));

    case "greenhouse":
      // content=true serves the description HTML-entity-encoded.
      return asArray(p?.jobs).map((j: any) => ({
        ...base,
        external_id: `${ctx.slug}:${j.id}`,
        title: j.title ?? "",
        location: j.location?.name ?? "",
        url: j.absolute_url ?? "",
        posted_at: j.updated_at || undefined,
        jd_text: stripHtml(decodeEntities(j.content ?? "")),
      }));

    case "workable":
      return asArray(p?.jobs).map((j: any) => ({
        ...base,
        external_id: `${ctx.slug}:${j.shortcode}`,
        title: j.title ?? "",
        location: [j.city, j.state, j.country].filter(Boolean).join(", "),
        url: j.url ?? j.shortlink ?? j.application_url ?? "",
        posted_at: j.published_on || undefined,
        jd_text: "",
      }));

    case "teamtailor":
      return asArray(p?.items).map((j: any) => ({
        ...base,
        external_id: `${ctx.slug}:${j.id}`,
        title: j.title ?? "",
        location: schemaPlace(j._jobposting?.jobLocation),
        url: j.url ?? "",
        posted_at: j.date_published || undefined,
        jd_text: stripHtml(j.content_html ?? ""),
      }));

    case "recruitee":
      return asArray(p?.offers).map((j: any) => ({
        ...base,
        external_id: `${ctx.slug}:${j.id}`,
        title: j.title ?? "",
        location: [j.city, j.country].filter(Boolean).join(", ") || j.location || "",
        url: j.careers_url ?? j.careers_apply_url ?? "",
        posted_at: j.published_at || j.created_at || undefined,
        jd_text: stripHtml(j.description ?? ""),
      }));

    case "smartrecruiters":
      return asArray(p?.content).map((j: any) => ({
        ...base,
        external_id: `${ctx.slug}:${j.id}`,
        title: j.name ?? "",
        location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(", "),
        url: `https://jobs.smartrecruiters.com/${ctx.slug}/${j.id}`,
        posted_at: j.releasedDate || undefined,
        jd_text: "",
      }));

    case "workday": {
      // externalPath is the detail key; carry it as the external id suffix.
      const { tenant, host, site } = workdayParts(ctx.slug);
      const origin = `https://${tenant}.${host}.myworkdayjobs.com/${site}`;
      return asArray(p?.jobPostings).map((j: any) => ({
        ...base,
        external_id: `${ctx.slug}:${j.externalPath}`,
        title: j.title ?? "",
        location: j.locationsText ?? "",
        url: `${origin}${j.externalPath ?? ""}`,
        posted_at: j.postedOn || undefined,
        jd_text: "",
      }));
    }

    case "bamboohr":
      return asArray(p?.result).map((j: any) => ({
        ...base,
        external_id: `${ctx.slug}:${j.id}`,
        title: j.jobOpeningName ?? "",
        location: [j.location?.city, j.location?.state].filter(Boolean).join(", "),
        url: `https://${ctx.slug}.bamboohr.com/careers/${j.id}`,
        jd_text: "",
      }));

    case "personio": {
      const parser = new XMLParser({
        ignoreAttributes: true,
        parseTagValue: false,
        isArray: (name) => ["position", "jobDescription", "office"].includes(name),
      });
      const doc = parser.parse(String(payload));
      return asArray(doc?.["workzag-jobs"]?.position).map((j: any) => {
        // jobDescriptions is empty on many tenants. Degrade, never drop the row.
        const desc = asArray(j.jobDescriptions?.jobDescription)
          .map((d: any) => [d?.name, d?.value].filter(Boolean).join("\n"))
          .join("\n\n");
        const offices = [j.office, ...asArray(j.additionalOffices?.office)].flat().filter(Boolean);
        return {
          ...base,
          external_id: `${ctx.slug}:${j.id}`,
          title: j.name ?? "",
          location: offices.join(", "),
          url: `https://${ctx.slug}.jobs.personio.de/job/${j.id}`,
          posted_at: j.createdAt || undefined,
          jd_text:
            stripHtml(desc) || [j.name, j.department, j.seniority, j.schedule].filter(Boolean).join(" "),
        };
      });
    }

    default:
      return [];
  }
}
