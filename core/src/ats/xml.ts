// Pure: reads the element tree of a small XML feed, as Personio serves. Text
// is entity-decoded, CDATA is kept literally, and attributes, comments, the
// declaration and any doctype are skipped.

export type XmlNode = { name: string; text: string; children: XmlNode[] };

const TOKEN =
  /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)(?:[^<>"']|"[^"]*"|'[^']*')*?(\/?)>|([^<]+|<)/g;

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

// One pass, so "&amp;lt;" decodes to "&lt;" and never on to "<".
export function decodeXml(s: string): string {
  return s.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/g, (m, hex, dec, name) => {
    if (name) return NAMED[name];
    const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "", text: "", children: [] };
  const stack = [root];
  for (const [, cdata, close, open, selfClosing, text] of xml.matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    if (cdata !== undefined) top.text += cdata;
    else if (text !== undefined) top.text += decodeXml(text);
    else if (open) {
      const node: XmlNode = { name: open, text: "", children: [] };
      top.children.push(node);
      if (!selfClosing) stack.push(node);
    } else if (close) {
      // A stray close tag is ignored; a missing one is closed by its parent's.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === close) {
          stack.length = i;
          break;
        }
      }
    }
  }
  return root;
}

// Every node at the end of a path of child names: all(doc, "feed", "item").
export function all(node: XmlNode, ...path: string[]): XmlNode[] {
  return path.reduce<XmlNode[]>((ns, name) => ns.flatMap((n) => n.children.filter((c) => c.name === name)), [node]);
}

export const textAt = (node: XmlNode, ...path: string[]): string => all(node, ...path)[0]?.text.trim() ?? "";
