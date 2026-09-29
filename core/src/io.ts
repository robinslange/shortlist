// Every side effect that talks to the outside world.
//
// User commands run under `sh -c` with their inputs in environment variables.
// Values are never spliced into the command text, so a URL scraped off a job
// board cannot inject shell.

import { spawn } from "node:child_process";
import type { Endpoint } from "./ats/dispatch.ts";

export type ShellResult = { code: number; stdout: string; stderr: string };

export function runShell(cmd: string, env: Record<string, string>, cwd: string): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", cmd], { cwd, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export type Fetcher = (url: string) => Promise<string>;

export function makeFetcher(command: string | null, cwd: string): Fetcher | null {
  if (!command) return null;
  return async (url) => {
    const r = await runShell(command, { URL: url }, cwd);
    if (r.code !== 0) throw new Error(`fetch exited ${r.code}: ${r.stderr.trim().slice(0, 200)}`);
    return r.stdout;
  };
}

export type HttpResponse = { status: number; body: string };
export type Http = (ep: Endpoint) => Promise<HttpResponse>;

export const http: Http = async (ep) => {
  const res = await fetch(ep.url, {
    method: ep.method ?? "GET",
    headers: ep.headers,
    body: ep.body,
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, body: await res.text() };
};

// Politeness delay between requests. A constant, not a knob: a user who wants
// to hammer a board can edit this line and own that decision.
export const politeDelay = (): number => 750 + Math.floor(Math.random() * 250);

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
