import { test } from "node:test";
import { ok, strictEqual } from "node:assert/strict";
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
