import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

// Runs after `npm run build`. Every sitemap entry must be a page the build made.
test('the sitemap lists every built page and nothing else', () => {
  const xml = readFileSync(new URL('../dist/sitemap.xml', import.meta.url), 'utf8');
  const locs = [...xml.matchAll(/<loc>https:\/\/letschat\.stoaz\.net(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.includes('/') && locs.includes('/self-hosting/caddy/'), xml);
  for (const path of locs) assert.ok(existsSync(new URL(`../dist${path}index.html`, import.meta.url)), path);
  assert.match(readFileSync(new URL('../dist/robots.txt', import.meta.url), 'utf8'), /Sitemap: https:\/\/letschat\.stoaz\.net\/sitemap\.xml/);
});

// Each sitemap page points at itself as canonical, with its own title and description.
test('every page has a self-canonical and a unique title and description', () => {
  const xml = readFileSync(new URL('../dist/sitemap.xml', import.meta.url), 'utf8');
  const seen = new Set();
  for (const [, url, path] of xml.matchAll(/<loc>(https:\/\/[^/]+(\/[^<]*))<\/loc>/g)) {
    const html = readFileSync(new URL(`../dist${path}index.html`, import.meta.url), 'utf8');
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`), path);
    for (const re of [/<title>([^<]+)<\/title>/, /<meta name="description" content="([^"]+)"/]) {
      const value = html.match(re)?.[1];
      assert.ok(value && !seen.has(value), `${path}: ${value}`);
      seen.add(value);
    }
  }
  assert.match(readFileSync(new URL('../dist/404.html', import.meta.url), 'utf8'), /<meta name="robots" content="noindex">/);
});
