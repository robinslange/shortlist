// Pure: read a digest back. The writer emits each role's tick box with its
// key comment on the very next line, so only that exact pair counts. Nothing
// else in the digest is parsed: titles and urls live in seen.json already.

export type DigestTick = { key: string; ticked: boolean };

const TICK = /^- \[([ xX])\] tailor\s*$/;
const KEY = /^<!-- key: (.+) -->\s*$/;

export function readDigest(markdown: string): DigestTick[] {
  const lines = markdown.split("\n");
  const out: DigestTick[] = [];
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i - 1].match(TICK);
    const k = lines[i].match(KEY);
    if (t && k) out.push({ key: k[1], ticked: t[1].toLowerCase() === "x" });
  }
  return out;
}

export function shortlistedFrom(markdown: string): DigestTick[] {
  return readDigest(markdown).filter((r) => r.ticked);
}
