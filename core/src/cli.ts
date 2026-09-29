#!/usr/bin/env node
// The shortlist command line. Every command runs in the current directory,
// which is the workspace holding shortlist.yaml.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectAts } from "./ats/detect.ts";
import { shortlistedFrom } from "./digest/read.ts";
import { applyScores } from "./digest/scores.ts";
import type { ScoreLine } from "./digest/scores.ts";
import { digestPath, writeDigest } from "./digest/write.ts";
import { loadCompanies, loadConfig, loadProfile, saveDetections } from "./config.ts";
import { readJson, writeJson } from "./files.ts";
import { initWorkspace } from "./init.ts";
import { http, makeFetcher, sleep } from "./io.ts";
import { runScore } from "./score/run.ts";
import { isVerdict, markShortlisted, mergeInto, setVerdict } from "./seen.ts";
import { runSource } from "./source.ts";
import { buildCv } from "./tailor/build.ts";
import { bundleEvidence } from "./tailor/evidence.ts";
import { initApplication, resolveTarget } from "./tailor/init.ts";
import { localDate } from "./text.ts";
import { SEEN_VERDICTS } from "./types.ts";
import type { RoleRow, SeenStore, SourceSummary, Survivor } from "./types.ts";
import { voicePack } from "./voice/pack.ts";

type Command = {
  usage: string;
  summary: string;
  help?: string;
  run: (args: string[], ws: string) => Promise<number>;
};

const note = (s: string) => process.stderr.write(s + "\n");

const SEEK_NOTICE = `Seek: the board adapter reads Seek's public search and job pages. Seek's
terms of service restrict automated access. The adapter is here for one person
looking for their own next job at a human pace, one request every 750-1000ms.
Whether to use it is your call. Leave boards.seek empty in profile.yaml and it
never runs.`;

const COMMANDS: Record<string, Command> = {
  init: {
    usage: "init [dir]",
    summary: "Set up a workspace: example config, profile and company list, the prompts, the voice rules.",
    run: async (args, ws) => {
      const dir = resolve(ws, args[0] ?? ".");
      mkdirSync(dir, { recursive: true });
      // dist/core/src/cli.js -> package root
      const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
      const { created, skipped } = initWorkspace(pkgRoot, dir);
      for (const f of created) process.stdout.write(`created ${f}\n`);
      for (const f of skipped) process.stdout.write(`skipped ${f} (exists)\n`);
      return 0;
    },
  },

  source: {
    usage: "source",
    summary: "Fetch roles from companies.yaml and the boards in profile.yaml. Writes candidates.json and sources.json.",
    help: SEEK_NOTICE,
    run: async (_args, ws) => {
      const config = loadConfig(ws);
      const result = await runSource(loadCompanies(ws), loadProfile(ws), {
        http,
        fetchPage: makeFetcher(config.fetch, ws),
        sleep,
      });
      saveDetections(ws, result.detections);
      writeJson(join(ws, "candidates.json"), result.rows);
      writeJson(join(ws, "sources.json"), result.summary);
      const { counts, errors, stale } = result.summary;
      const perSource = Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", ");
      note(`${result.rows.length} candidates (${perSource}); ${errors.length} errors; ${stale.length} stale`);
      for (const e of errors) note(`  ${e}`);
      return 0;
    },
  },

  "detect-ats": {
    usage: "detect-ats <html-file>",
    summary: "Print the ATS and slug a saved careers page links to, as JSON, or null.",
    run: async (args) => {
      if (!args[0]) return usageError("detect-ats <html-file>");
      process.stdout.write(JSON.stringify(detectAts(readFileSync(args[0], "utf8"))) + "\n");
      return 0;
    },
  },

  score: {
    usage: "score",
    summary: "Drop roles already decided, filter the rest against profile.yaml, keep the top 30. Writes survivors.json.",
    run: async (_args, ws) => {
      const config = loadConfig(ws);
      const seenPath = join(ws, "seen.json");
      const r = await runScore(
        readJson<RoleRow[]>(join(ws, "candidates.json")),
        loadProfile(ws),
        readJson<SeenStore>(seenPath, {}),
        { fetchPage: makeFetcher(config.fetch, ws), sleep, now: new Date() },
      );
      writeJson(join(ws, "survivors.json"), r.survivors);
      writeJson(seenPath, r.seen);
      note(`${r.survivors.length} survivors; ${r.dropped} already decided; ${r.filtered} filtered`);
      for (const w of r.warnings) note(`  ${w}`);
      return 0;
    },
  },

  digest: {
    usage: "digest",
    summary: "Merge scores.json onto survivors.json and write a dated digest. Prints its path.",
    run: async (_args, ws) => {
      const config = loadConfig(ws);
      const scoresPath = join(ws, "scores.json");
      if (!existsSync(scoresPath)) {
        note("no scores.json: ranking on cheap scores only. run prompts/01-score.md first for model scores.");
      }
      const { rows, problems } = applyScores(
        readJson<Survivor[]>(join(ws, "survivors.json")),
        readJson<ScoreLine[]>(scoresPath, []),
      );
      for (const p of problems) note(`  ${p}`);

      const today = localDate(new Date());
      mkdirSync(config.output.digests, { recursive: true });
      const path = digestPath(config.output.digests, today);
      writeFileSync(path, writeDigest(rows, today, readJson<SourceSummary>(join(ws, "sources.json"))));

      const seenPath = join(ws, "seen.json");
      let store = readJson<SeenStore>(seenPath, {});
      for (const r of rows) {
        store = mergeInto(store, r.key, { last_score: r.llm_score?.score ?? null, url: r.url, title: r.title, company: r.company });
      }
      writeJson(seenPath, store);
      process.stdout.write(path + "\n");
      return 0;
    },
  },

  mark: {
    usage: "mark <digest>",
    summary: "Record every ticked `- [x] tailor` box in a digest as shortlisted.",
    run: async (args, ws) => {
      if (!args[0]) return usageError("mark <digest>");
      const seenPath = join(ws, "seen.json");
      const r = markShortlisted(readJson<SeenStore>(seenPath, {}), shortlistedFrom(readFileSync(args[0], "utf8")), new Date());
      writeJson(seenPath, r.store);
      note(`marked ${r.marked} shortlisted` + (r.skipped.length ? `; left alone: ${r.skipped.join(", ")}` : ""));
      return 0;
    },
  },

  "voice pack": {
    usage: "voice pack",
    summary: "Print every voice rule from the packs in shortlist.yaml. Missing packs are named on stderr.",
    run: async (_args, ws) => {
      const { text, missing } = voicePack(loadConfig(ws).voice.packs);
      process.stdout.write(text);
      for (const m of missing) note(`missing voice pack: ${m}`);
      return 0;
    },
  },

  "tailor init": {
    usage: "tailor init <url|key|--last>",
    summary: "Fetch a posting and start an application folder with a copy of your CV. Prints the folder.",
    run: async (args, ws) => {
      if (!args[0]) return usageError("tailor init <url|key|--last>");
      const config = loadConfig(ws);
      const target = resolveTarget(args[0], readJson<SeenStore>(join(ws, "seen.json"), {}));
      const folder = await initApplication(target, config, makeFetcher(config.fetch, ws), new Date());
      if (!config.cv.source) note("no cv.source configured: the folder has the posting but no CV to tailor");
      process.stdout.write(folder + "\n");
      return 0;
    },
  },

  "cv build": {
    usage: "cv build <folder>",
    summary: "Run cv.build inside an application folder and check the declared artifacts.",
    run: async (args, ws) => {
      if (!args[0]) return usageError("cv build <folder>");
      const r = await buildCv(resolve(ws, args[0]), loadConfig(ws));
      if (!r.ran) {
        note("no cv.build configured: the tailored source file is the deliverable");
        return 0;
      }
      if (r.code !== 0) note(`build exited ${r.code}:\n${r.stderr.trim()}`);
      if (r.missing.length > 0) note(`missing artifacts: ${r.missing.join(", ")}`);
      return r.code === 0 && r.missing.length === 0 ? 0 : 1;
    },
  },

  "evidence bundle": {
    usage: "evidence bundle <folder>",
    summary: "Assemble <folder>/evidence/ for the verifier. Prints its path.",
    run: async (args, ws) => {
      if (!args[0]) return usageError("evidence bundle <folder>");
      const { dir, missingRepos } = await bundleEvidence(resolve(ws, args[0]), loadConfig(ws));
      for (const r of missingRepos) note(`evidence repo not found: ${r}`);
      process.stdout.write(dir + "\n");
      return 0;
    },
  },

  set: {
    usage: "set <key> <verdict> [--force]",
    summary: "Record a verdict for one role in seen.json.",
    help: `Verdicts: ${SEEN_VERDICTS.join(", ")}.\nMoving a role backwards (applied to tailored, say) needs --force.`,
    run: async (args, ws) => {
      const [key, verdict] = args;
      if (!key || !verdict) return usageError("set <key> <verdict> [--force]");
      if (!isVerdict(verdict)) {
        note(`unknown verdict "${verdict}". one of: ${SEEN_VERDICTS.join(", ")}`);
        return 2;
      }
      const seenPath = join(ws, "seen.json");
      const r = setVerdict(readJson<SeenStore>(seenPath, {}), key, verdict, args.includes("--force"), new Date());
      if (r.refusedFrom) {
        note(`refusing to move ${key} from ${r.refusedFrom} back to ${verdict}. pass --force if you mean it.`);
        return 3;
      }
      writeJson(seenPath, r.store);
      note(`${key} -> ${verdict}`);
      return 0;
    },
  },
};

function usageError(usage: string): number {
  note(`usage: shortlist ${usage}`);
  return 2;
}

function overview(): string {
  const lines = Object.values(COMMANDS).map((c) => `  shortlist ${c.usage.padEnd(30)} ${c.summary}`);
  return `shortlist: find roles, tailor an application, verify every claim.\n\n${lines.join("\n")}\n\nRun \`shortlist <command> --help\` for more.\n`;
}

async function main(argv: string[]): Promise<number> {
  const [a, b, ...rest] = argv;
  if (!a || a === "help" || a === "--help" || a === "-h") {
    process.stdout.write(overview());
    return 0;
  }
  const pair = b === undefined ? undefined : COMMANDS[`${a} ${b}`];
  const cmd = pair ?? COMMANDS[a];
  const args = pair ? rest : argv.slice(1);
  if (!cmd) {
    note(`shortlist: unknown command "${a}"\n`);
    process.stderr.write(overview());
    return 2;
  }
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`usage: shortlist ${cmd.usage}\n\n${cmd.summary}\n${cmd.help ? `\n${cmd.help}\n` : ""}`);
    return 0;
  }
  try {
    return await cmd.run(args, process.cwd());
  } catch (e) {
    note(`shortlist: ${(e as Error).message}`);
    return 1;
  }
}

// exitCode, not exit(): exit() would drop stdout still queued for a pipe.
main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
