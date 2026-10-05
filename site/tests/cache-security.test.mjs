import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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


test('Connection header tokens are trimmed and removed from cached response headers', () => {
  const policy = new CachePolicy(request, response({
    'cache-control': 'public, max-age=600',
    connection: '  x-private \t, x-other  ',
    'x-private': 'secret',
    'x-other': 'secret',
    'x-retained': 'public',
  }));
  const headers = policy.responseHeaders();
  assert.equal(headers.connection, undefined);
  assert.equal(headers['x-private'], undefined);
  assert.equal(headers['x-other'], undefined);
  assert.equal(headers['x-retained'], 'public');
});

test('Vary header tokens retain case-insensitive trimmed matching', () => {
  const varyingRequest = { ...request, headers: { ...request.headers, 'accept-language': 'en', accept: 'text/html' } };
  const policy = new CachePolicy(varyingRequest, response({
    'cache-control': 'public, max-age=600', vary: ' Accept-Language \t, Accept  ',
  }));
  assert.equal(policy.satisfiesWithoutRevalidation(varyingRequest), true);
  assert.equal(policy.satisfiesWithoutRevalidation({ ...varyingRequest,
    headers: { ...varyingRequest.headers, 'accept-language': 'de' },
  }), false);
});

test('whitespace-heavy Connection and Vary headers finish within a bounded subprocess', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const CachePolicy = require(process.argv[1]);
    const token = 'x' + ' '.repeat(250_000) + 'y';
    const req = { url: 'https://example.invalid/', method: 'GET', headers: { host: 'example.invalid', [token]: 'value' } };
    const policy = new CachePolicy(req, { status: 200, headers: {
      'cache-control': 'public, max-age=600', connection: token, vary: token, [token]: 'secret',
    } });
    assert.equal(policy.responseHeaders()[token], undefined);
    assert.equal(policy.satisfiesWithoutRevalidation(req), true);
    assert.equal(policy.satisfiesWithoutRevalidation({ ...req, headers: { host: 'example.invalid' } }), false);
  `, astroRequire.resolve('http-cache-semantics')], { timeout: 5000, encoding: 'utf8' });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});
