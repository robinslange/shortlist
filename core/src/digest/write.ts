import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ScoredRow, SourceSummary } from "../types.ts";

export function digestPath(dir: string, today: string): string {
  for (let n = 1; ; n++) {
    const path = join(dir, n === 1 ? `${today}.md` : `${today}-${n}.md`);
    if (!existsSync(path)) return path;
  }
}

export function writeDigest(rows: ScoredRow[], today: string, sources: SourceSummary): string {
  const scored = rows.filter((r) => r.llm_score).sort((a, b) => b.llm_score!.score - a.llm_score!.score);
  const unscored = rows.filter((r) => !r.llm_score).sort((a, b) => b.cheap_score - a.cheap_score);
  const band = (lo: number, hi: number) => scored.filter((r) => r.llm_score!.score >= lo && r.llm_score!.score < hi);

  const lines = [`# Job digest ${today}`, ""];
  if (rows.length === 0) lines.push("no new roles since the last run.", "");
  section(lines, "## Worth a look", band(7, 11), false);
  section(lines, "## Not scored by the model", unscored, false);
  section(lines, "Borderline (score 5-6)", band(5, 7), true);
  section(lines, "Seen and skipped (score below 5)", band(0, 5), true);

  lines.push("### sources", ...Object.entries(sources.counts).map(([name, n]) => `- ${name}: ${n} rows`));
  if (sources.stale.length > 0) {
    lines.push("", "**stale ATS cache:**", ...sources.stale.map((c) => `- ${c}: blank \`ats\` and \`slug\` in companies.yaml and re-run`));
  }
  if (sources.errors.length > 0) {
    lines.push("", "**errors:**", ...sources.errors.map((e) => `- ${e}`));
  }
  lines.push("");
  return lines.join("\n");
}

function section(lines: string[], title: string, rows: ScoredRow[], folded: boolean): void {
  if (rows.length === 0) return;
  lines.push(folded ? `<details><summary>${title}</summary>` : title, "");
  for (const r of rows) lines.push(...renderRow(r));
  if (folded) lines.push("</details>", "");
}

// Every string here comes from a job board or a model. Flattened to one line,
// none of them can start a line of its own, so none can forge a tick box or a
// key comment for `shortlist mark` to read back.
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

function renderRow(r: ScoredRow): string[] {
  const slug = r.source === "seek" ? "" : r.external_id.split(":")[0];
  const badge = `[${r.source}${slug ? ":" + flat(slug) : ""}]`;
  const comp = r.comp_text ? ` -- ${flat(r.comp_text)}` : "";
  const score = r.llm_score
    ? `score: **${r.llm_score.score}** -- ${flat(r.llm_score.rationale)}`
    : `cheap score: ${r.cheap_score.toFixed(1)}`;
  const out = [
    `### ${flat(r.title)} -- ${flat(r.company)} ${badge}`,
    `- ${score}`,
    `- ${flat(r.location) || "location not given"}${comp}`,
    `- ${flat(r.url)}`,
  ];
  if (r.llm_score?.red_flags_spotted.length) out.push(`- red flags: ${r.llm_score.red_flags_spotted.map(flat).join("; ")}`);
  // The seen-store key, so `shortlist mark` reads a ticked box back without
  // re-deriving identity from the URL.
  out.push("- [ ] tailor", `<!-- key: ${flat(r.key)} -->`, "");
  return out;
}
