// Pure: given a careers page's HTML, return the detected ATS and slug, or null.
//
// Signatures are tried in rough order of how often each ATS turns up. The
// first match is the primary verdict; every other ATS that matches is kept as
// secondary so the caller can record it.

import type { AtsKind, DetectorResult } from "../types.ts";

type Sig = {
  ats: AtsKind;
  patterns: RegExp[];
  // Most ATSes are addressed by one capture group. Workday needs three, and
  // carries them in the same slug field as "tenant/wdN/Site".
  slugFrom?: (m: RegExpMatchArray) => string;
};

// Vendor subdomains that are the vendor's own site, never a customer board.
const NOT_A_BOARD = "(?!(?:www|app|support|status|help|docs|blog|developers)\\.)";

const SIGNATURES: Sig[] = [
  {
    ats: "ashby",
    patterns: [
      /jobs\.ashbyhq\.com\/([a-z0-9-]+)\/embed/i,
      /ashbyBaseJobBoardUrl["\s:=]+["']https:\/\/jobs\.ashbyhq\.com\/([a-z0-9-]+)/i,
      /jobs\.ashbyhq\.com\/([a-z0-9-]+)/i,
    ],
  },
  { ats: "workable", patterns: [/apply\.workable\.com\/([a-z0-9-]+)/i] },
  {
    ats: "lever",
    patterns: [/jobs\.lever\.co\/([a-z0-9-]+)/i, /api(?:\.eu)?\.lever\.co\/v0\/postings\/([a-z0-9-]+)/i],
  },
  {
    ats: "greenhouse",
    patterns: [
      /boards\.greenhouse\.io\/embed\/job_board\/js\?for=([a-z0-9_-]+)/i,
      /job-boards\.greenhouse\.io\/([a-z0-9_-]+)/i,
      /boards\.greenhouse\.io\/(?!embed)([a-z0-9_-]+)/i,
    ],
  },
  { ats: "bamboohr", patterns: [new RegExp(`(?<![a-z0-9-])${NOT_A_BOARD}([a-z0-9-]+)\\.bamboohr\\.com`, "i")] },
  { ats: "teamtailor", patterns: [new RegExp(`(?<![a-z0-9-])${NOT_A_BOARD}([a-z0-9-]+)\\.teamtailor\\.com`, "i")] },
  {
    ats: "workday",
    patterns: [/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Za-z]{2}\/)?([A-Za-z0-9_-]+)/i],
    slugFrom: (m) => `${m[1]}/${m[2].toLowerCase()}/${m[3]}`,
  },
  { ats: "smartrecruiters", patterns: [/(?:careers|jobs)\.smartrecruiters\.com\/([a-z0-9-]+)/i] },
  { ats: "recruitee", patterns: [new RegExp(`(?<![a-z0-9-])${NOT_A_BOARD}([a-z0-9-]+)\\.recruitee\\.com`, "i")] },
  { ats: "personio", patterns: [/([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/i] },
];

export function detectAts(html: string): DetectorResult | null {
  const matches: Array<{ ats: AtsKind; slug: string }> = [];

  for (const sig of SIGNATURES) {
    for (const pat of sig.patterns) {
      const m = html.match(pat);
      if (m && m[1]) {
        matches.push({ ats: sig.ats, slug: (sig.slugFrom ? sig.slugFrom(m) : m[1]).trim() });
        break;
      }
    }
  }

  if (matches.length === 0) return null;
  const [primary, ...rest] = matches;
  return rest.length > 0 ? { ...primary, secondary: rest } : primary;
}
