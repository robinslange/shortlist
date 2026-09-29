// Loads the workspace: shortlist.yaml, profile.yaml, companies.yaml.
// Unknown keys are refused by name, so a typo or a field copied from some
// other tool fails loudly instead of being ignored.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse, parseDocument } from "yaml";
import type { Company, DetectorResult, Profile } from "./types.ts";

export class ConfigError extends Error {}

export type Config = {
  dir: string;
  fetch: string | null;
  cv: { source: string | null; build: string | null; artifacts: string[] };
  voice: { packs: string[] };
  evidence: { repos: string[] };
  output: { digests: string; applications: string };
};

// Known keys, one entry per level. null is a leaf; [schema] is a list whose
// entries are mappings.
type Schema = { [key: string]: Schema | [Schema] | null };

const CONFIG_SCHEMA: Schema = {
  fetch: null,
  cv: { source: null, build: null, artifacts: null },
  voice: { packs: null },
  evidence: { repos: null },
  output: { digests: null, applications: null },
};

const PROFILE_SCHEMA: Schema = {
  candidate: { name: null, location: null, summary: null, comp_floor: null },
  role_shapes: [{ id: null, keywords: null, weight: null, must_have_signals: null }],
  must_have_any: [{ signal: null, any_of: null }],
  red_flags: null,
  locations: { reject: null },
  source_weights: { board: null, ats_api: null },
  boards: { seek: null },
};

const COMPANY_SCHEMA: Schema = {
  name: null,
  careers_url: null,
  ats: null,
  slug: null,
  secondary_ats: null,
  notes: null,
};

function readYaml(path: string): any {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ConfigError(`${path}: ${(e as Error).message}`);
  }
}

function checkKeys(path: string, value: unknown, schema: Schema, at: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  for (const [k, v] of Object.entries(value)) {
    const name = at ? `${at}.${k}` : k;
    if (!Object.hasOwn(schema, k)) throw new ConfigError(`${path}: unknown key "${name}"`);
    const sub = schema[k];
    if (Array.isArray(sub)) {
      if (Array.isArray(v)) v.forEach((item, i) => checkKeys(path, item, sub[0], `${name}[${i}]`));
    } else if (sub) {
      checkKeys(path, v, sub, name);
    }
  }
}

function mapping(path: string, raw: unknown, schema: Schema): Record<string, any> {
  const obj = raw ?? {};
  if (typeof obj !== "object" || Array.isArray(obj)) {
    throw new ConfigError(`${path}: expected a mapping at the top level`);
  }
  checkKeys(path, obj, schema, "");
  return obj as Record<string, any>;
}

function expand(dir: string, p: string): string {
  return resolve(dir, p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p);
}

export function loadConfig(dir: string): Config {
  const path = join(dir, "shortlist.yaml");
  if (!existsSync(path)) {
    throw new ConfigError(`no shortlist.yaml in ${dir}. run \`shortlist init\` there first.`);
  }
  const raw = mapping(path, readYaml(path), CONFIG_SCHEMA);
  const cv = raw.cv ?? {};
  return {
    dir,
    fetch: raw.fetch ?? null,
    cv: {
      source: cv.source ? expand(dir, cv.source) : null,
      build: cv.build ?? null,
      artifacts: cv.artifacts ?? [],
    },
    voice: { packs: (raw.voice?.packs ?? ["voice/default", "voice/yours"]).map((p: string) => expand(dir, p)) },
    evidence: { repos: (raw.evidence?.repos ?? []).map((p: string) => expand(dir, p)) },
    output: {
      digests: expand(dir, raw.output?.digests ?? "digests"),
      applications: expand(dir, raw.output?.applications ?? "applications"),
    },
  };
}

export function loadProfile(dir: string): Profile {
  const path = join(dir, "profile.yaml");
  if (!existsSync(path)) throw new ConfigError(`no profile.yaml in ${dir}`);
  const raw = mapping(path, readYaml(path), PROFILE_SCHEMA);
  const shapes = raw.role_shapes ?? [];
  if (!Array.isArray(shapes) || shapes.length === 0) {
    throw new ConfigError(`${path}: role_shapes is empty, so every role would be rejected`);
  }
  return {
    candidate: { name: "", location: "", summary: "", ...raw.candidate },
    role_shapes: shapes,
    must_have_any: raw.must_have_any ?? [],
    red_flags: raw.red_flags ?? [],
    locations: { reject: raw.locations?.reject ?? [] },
    source_weights: { board: 1, ats_api: 1, ...raw.source_weights },
    boards: { seek: raw.boards?.seek ?? [] },
  };
}

export function loadCompanies(dir: string): Company[] {
  const path = join(dir, "companies.yaml");
  if (!existsSync(path)) return [];
  const raw = readYaml(path) ?? [];
  if (!Array.isArray(raw)) throw new ConfigError(`${path}: expected a list of companies`);
  raw.forEach((c: any, i: number) => {
    if (!c?.name || !c?.careers_url) {
      throw new ConfigError(`${path}: entry ${i + 1} needs name and careers_url`);
    }
    checkKeys(path, c, COMPANY_SCHEMA, `[${i}]`);
  });
  return raw;
}

// Writes detected ATS details back into companies.yaml, keeping the user's
// comments and ordering.
export function saveDetections(dir: string, detections: Array<{ index: number; result: DetectorResult }>): void {
  if (detections.length === 0) return;
  const path = join(dir, "companies.yaml");
  const doc = parseDocument(readFileSync(path, "utf8"));
  for (const { index, result } of detections) {
    doc.setIn([index, "ats"], result.ats);
    doc.setIn([index, "slug"], result.slug);
    if (result.secondary) doc.setIn([index, "secondary_ats"], doc.createNode(result.secondary));
  }
  writeFileSync(path, doc.toString());
}
