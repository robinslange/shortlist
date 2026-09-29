import { test } from "node:test";
import { match, ok, strictEqual } from "node:assert/strict";
import { decodeEntities, localDate, looksBlocked, slugify, stripHtml } from "../src/text.ts";

test("stripHtml removes markup and decodes entities without gluing words", () => {
  strictEqual(stripHtml("<p>One</p><p>Two</p>"), "One\nTwo");
  strictEqual(stripHtml("a &amp; b &lt;c&gt;"), "a & b <c>");
  strictEqual(stripHtml("<script>evil()</script>text"), "text");
});

test("decodeEntities decodes once, so an escaped entity stays escaped", () => {
  strictEqual(decodeEntities("&amp;lt;p&amp;gt;"), "&lt;p&gt;");
});

test("looksBlocked recognises challenge pages and ignores ordinary ones", () => {
  ok(looksBlocked("<html><head><title>Access Denied</title></head></html>"));
  ok(looksBlocked("<title>Just a moment...</title>"));
  ok(looksBlocked("<p>Please verify you are human</p>"));
  ok(!looksBlocked("<title>Senior Engineer</title><p>Access to denied claims is logged.</p>"));
});

test("slugify makes a folder-safe slug and never returns empty", () => {
  strictEqual(slugify("Café Société Ltd."), "cafe-societe-ltd");
  strictEqual(slugify("  --  "), "role");
  ok(slugify("x".repeat(100)).length <= 60);
});

test("localDate formats the local calendar date", () => {
  strictEqual(localDate(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("slugify never ends on a dash, even when truncation lands on one", () => {
  strictEqual(slugify(`${"a".repeat(59)} b`), "a".repeat(59));
});

test("a real job ad that mentions human verification is not a bot check", () => {
  const ad = `<title>Senior Engineer, Bot Management</title><p>${"You will build the systems that verify you are human before checkout. ".repeat(40)}</p>`;
  strictEqual(looksBlocked(ad), false);
  ok(looksBlocked("<html><body><p>Please verify you are human by completing the action below.</p></body></html>"));
});

test("a bare < in text is kept, not treated as the start of a tag", () => {
  strictEqual(stripHtml("<p>if a < b then c > d</p>"), "if a < b then c > d");
  strictEqual(stripHtml("5 < 10 years<br>next"), "5 < 10 years\nnext");
});

test("titles with no Latin letters still get distinct, stable slugs", () => {
  const a = slugify("シニアエンジニア");
  const b = slugify("高级工程师");
  ok(a !== b, `${a} vs ${b}`);
  ok(a !== "role" && b !== "role");
  strictEqual(slugify("シニアエンジニア"), a);
  match(a, /^role-[a-z0-9]+$/);
});
