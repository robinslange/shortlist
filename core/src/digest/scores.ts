import type { LlmScore, ScoredRow, Survivor } from "../types.ts";

// One line of scores.json, as written by prompts/01-score.md.
export type ScoreLine = { key: string; score: number; rationale: string; red_flags_spotted?: string[] };

export function applyScores(survivors: Survivor[], scores: ScoreLine[]): { rows: ScoredRow[]; problems: string[] } {
  // The one file a model writes, so its shape is checked, not trusted.
  if (!Array.isArray(scores)) throw new Error("scores.json must be an array of {key, score, rationale}");
  const keys = new Set(survivors.map((s) => s.key));
  const byKey = new Map<string, LlmScore>();
  const problems: string[] = [];

  for (const s of scores) {
    if (!keys.has(s.key)) {
      problems.push(`scores.json names ${s.key}, which is not in survivors.json`);
      continue;
    }
    if (!Number.isInteger(s.score) || s.score < 1 || s.score > 10) {
      problems.push(`${s.key}: score ${s.score} is not an integer from 1 to 10`);
      continue;
    }
    byKey.set(s.key, { score: s.score, rationale: s.rationale ?? "", red_flags_spotted: s.red_flags_spotted ?? [] });
  }
  return { rows: survivors.map((s) => ({ ...s, llm_score: byKey.get(s.key) })), problems };
}
