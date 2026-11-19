import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Runs after `npm run build`. The download buttons must work straight from the
// HTML, without JavaScript and whatever GitHub's API answers.
test('every download button in the built page links to a real file or the release page', () => {
  const html = readFileSync(new URL('../dist/download/index.html', import.meta.url), 'utf8');
  const links = [...html.matchAll(/<a\b[^>]*\bdata-format="([^"]+)"[^>]*>/g)];
  assert.equal(links.length, 7);
  for (const [tag, format] of links) {
    assert.match(tag, /\bhref="https:\/\/github\.com\/da-stoaz\/letschat\/releases\/(download\/[^"]+|latest)"/, format);
    assert.doesNotMatch(tag, /aria-disabled|pointer-events-none/, format);
  }
});
