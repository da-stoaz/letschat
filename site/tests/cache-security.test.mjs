import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve('astro/package.json'));
const CachePolicy = astroRequire('http-cache-semantics');
const request = { url: 'https://example.invalid/account', method: 'GET', headers: { host: 'example.invalid' } };
const response = (headers) => ({ status: 200, headers: { date: new Date().toUTCString(), ...headers } });
const staleRequest = (directive) => ({ ...request, headers: { ...request.headers, 'cache-control': directive } });

test('Astro resolves the reviewed local backport', () => {
  assert.equal(realpathSync(astroRequire.resolve('http-cache-semantics')),
    fileURLToPath(new URL('../vendor/http-cache-semantics/index.js', import.meta.url)));
});

for (const [name, headers] of Object.entries({
  session: { 'set-cookie': 'session=victim; HttpOnly' },
  private: { 'cache-control': 'private, max-age=600' },
  noStore: { 'cache-control': 'no-store' },
  noCache: { 'cache-control': 'no-cache' },
  varyWildcard: { vary: '*' },
  proxyRevalidate: { 'cache-control': 'proxy-revalidate' },
})) {
  test(`max-stale cannot reuse a zero-lifetime ${name} response`, () => {
    const policy = new CachePolicy(request, response(headers), { shared: true });
    assert.equal(policy.maxAge(), 0);
    for (const cached of [policy, CachePolicy.fromObject(policy.toObject())]) {
      for (const directive of ['max-stale', 'max-stale=2147483647']) {
        const probe = staleRequest(directive);
        assert.equal(cached.satisfiesWithoutRevalidation(probe), false);
        const result = cached.evaluateRequest(probe);
        assert.equal(result.response, undefined);
        assert.equal(result.revalidation.synchronous, true);
      }
    }
  });
}

test('explicitly public responses still use fresh and allowed stale cache entries', () => {
  const now = Date.now();
  const policy = new CachePolicy(request, response({ 'cache-control': 'public, max-age=10' }), { shared: true });
  assert.equal(policy.satisfiesWithoutRevalidation(request), true);
  policy.now = () => now + 20_000;
  assert.equal(policy.satisfiesWithoutRevalidation(request), false);
  assert.equal(policy.satisfiesWithoutRevalidation(staleRequest('max-stale=60')), true);
});
