// Pure: read a digest back. Each role block ends with its key comment.

export type DigestTick = { key: string; title: string; url?: string; ticked: boolean };

const KEY = /<!--\s*key:\s*(.+?)\s*-->/;
const TICK = /^- \[([ xX])\] tailor\s*$/;
const HEADING = /^### (.+?)\s+--\s+(.+?)\s+\[/;
const URL_LINE = /^- (https?:\/\/\S+)\s*$/;

export function readDigest(markdown: string): DigestTick[] {
  const out: DigestTick[] = [];
  let title = "";
  let url: string | undefined;
  let ticked: boolean | undefined;

  for (const line of markdown.split("\n")) {
    const h = line.match(HEADING);
    if (h) {
      title = h[1];
      url = undefined;
      ticked = undefined;
      continue;
    }
    const u = line.match(URL_LINE);
    if (u) {
      url = u[1];
      continue;
    }
    const t = line.match(TICK);
    if (t) {
      ticked = t[1].toLowerCase() === "x";
      continue;
    }
    const k = line.match(KEY);
    if (k && ticked !== undefined) {
      out.push({ key: k[1], title, url, ticked });
      ticked = undefined;
    }
  }
  return out;
}

export function shortlistedFrom(markdown: string): DigestTick[] {
  return readDigest(markdown).filter((r) => r.ticked);
}
