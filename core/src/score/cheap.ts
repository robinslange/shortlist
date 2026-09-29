// Pure: the deterministic filter. It rejects most roles for free so the model
// only ever sees the shortlist.

import type { CheapScoreResult, Profile, RoleRow } from "../types.ts";

export function cheapScore(row: RoleRow, profile: Profile): CheapScoreResult {
  const haystack = `${row.title}\n${row.location}\n${row.jd_text}`.toLowerCase();
  const has = (s: string) => haystack.includes(s.toLowerCase());

  for (const pat of profile.red_flags) {
    if (has(pat)) return { kind: "rejected", reason: `red_flag: ${pat}` };
  }
  for (const loc of profile.locations.reject) {
    if (has(loc)) return { kind: "rejected", reason: `location_reject: ${loc}` };
  }
  for (const must of profile.must_have_any) {
    if (!must.any_of.some(has)) return { kind: "rejected", reason: `missing_must_have: ${must.signal}` };
  }

  let raw = 0;
  const matched: string[] = [];
  for (const shape of profile.role_shapes) {
    if (shape.must_have_signals?.length && !shape.must_have_signals.some(has)) continue;
    const hits = shape.keywords.filter(has).length;
    if (hits > 0) {
      raw += hits * shape.weight;
      matched.push(shape.id);
    }
  }
  if (raw === 0) return { kind: "rejected", reason: "no_role_shape_match" };

  const board = row.source === "seek" || row.source === "bespoke";
  const weight = board ? profile.source_weights.board : profile.source_weights.ats_api;
  return { kind: "accepted", score: raw * weight, matched_shapes: matched };
}
