// Shared data shapes. No behaviour.

export const ATS_KINDS = [
  "ashby",
  "lever",
  "greenhouse",
  "workable",
  "bamboohr",
  "teamtailor",
  "workday",
  "smartrecruiters",
  "recruitee",
  "personio",
  "bespoke",
] as const;

export type AtsKind = (typeof ATS_KINDS)[number];

export type DetectorResult = {
  ats: AtsKind;
  slug: string;
  // A careers page can link more than one ATS. Primary first, the rest here.
  secondary?: Array<{ ats: AtsKind; slug: string }>;
};

export type RoleShape = {
  id: string;
  keywords: string[];
  weight: number;
  must_have_signals?: string[];
};

export type Profile = {
  candidate: { name: string; location: string; summary: string; comp_floor?: string };
  role_shapes: RoleShape[];
  must_have_any: Array<{ signal: string; any_of: string[] }>;
  red_flags: string[];
  locations: { reject: string[]; accept: string[] };
  source_weights: { board: number; ats_api: number };
  boards: { seek: string[] };
};

export type Company = {
  name: string;
  careers_url: string;
  ats?: AtsKind;
  slug?: string;
  secondary_ats?: Array<{ ats: AtsKind; slug: string }>;
  notes?: string;
};

// Normalised role row. Every source emits this shape.
export type RoleRow = {
  source: AtsKind | "seek";
  // seek: the numeric job id. ATS: "{slug}:{job id}". bespoke: "{company slug}:{url}".
  external_id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  posted_at?: string;
  comp_text?: string;
  jd_text: string;
};

export type CheapScoreResult =
  | { kind: "accepted"; score: number; matched_shapes: string[] }
  | { kind: "rejected"; reason: string };

export type LlmScore = {
  score: number; // integer 1-10
  rationale: string;
  red_flags_spotted: string[];
};

export type Survivor = RoleRow & { key: string; cheap_score: number; matched_shapes: string[] };

export type ScoredRow = Survivor & { llm_score?: LlmScore };

export type SourceSummary = {
  counts: Record<string, number>;
  errors: string[];
  stale: string[];
};

// Terminal verdicts are never resurfaced. `skipped` expires (see SKIP_EXPIRY_DAYS).
export const SEEN_VERDICTS = [
  "new",
  "shortlisted",
  "tailored",
  "applied",
  "rejected",
  "withdrawn",
  "skipped",
  "filtered_cheap",
] as const;

export type SeenVerdict = (typeof SEEN_VERDICTS)[number];

// Keyed by `{source}:{external_id}`. Writers MERGE: the store accrues fields
// from stages this type does not model, and replacing an entry destroys them.
export type SeenEntry = {
  first_seen: string;
  last_score: number | null;
  verdict: SeenVerdict;
  url?: string;
  title?: string;
  company?: string;
  reason?: string;
  folder?: string;
  shortlisted_at?: string;
  tailored_at?: string;
  skipped_at?: string;
  applied_at?: string;
  rejected_at?: string;
  withdrawn_at?: string;
  [extra: string]: unknown;
};

export type SeenStore = Record<string, SeenEntry>;
