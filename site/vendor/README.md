# Cache policy security backport

`http-cache-semantics/` contains the complete published 4.3.0 archive from
https://registry.npmjs.org/http-cache-semantics/-/http-cache-semantics-4.3.0.tgz.
Its SHA-256 is `d75e1e6a11587954da5e2f0e2b5c4b397a16d28cc2f7bdf64e9027fc2fe593ee`. License and package version are unchanged.

The behavior described by [GHSA-ch52-4w7c-c8xp / CVE-2026-93748](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
also reproduces in 4.3.0, even though the advisory currently lists only <=4.2.0.
A shared response containing Set-Cookie without public/immutable opt-in has
maxAge() == 0, yet a large or unbounded client max-stale can still reuse it.
An audit reporting zero findings is therefore insufficient validation.

The cache reuse fix is a guard in evaluateRequest: zero-lifetime entries
require synchronous revalidation and never supply a cached response. This is
intentionally conservative: even an explicitly public max-age=0 entry must
revalidate. Normal positive-lifetime public caching and permitted stale reuse
remain available. This avoids guessing which of maxAge's zero-return paths
represent security restrictions.

CodeQL also identified quadratic whitespace backtracking in the upstream
comma-separated header parser. Both Connection and Vary now split on a literal
comma and trim each token separately, preserving token handling in linear time.

The npm override routes every Astro consumer to this local copy. The site is
statically generated, but the dependency is fixed rather than merely dismissing
the alert based on deployment mode.

Verification:

```sh
python3 scripts/check_dependency_backports.py
cd site
npm ci
npm run test:security
npm audit --audit-level=low
npm run build
```

The archive check permits only this guard and the two header-parser replacements. Regression tests cover session
cookies, private/no-store/no-cache responses, wildcard Vary, proxy revalidation,
serialized policies, normal public caching, and whitespace-heavy header parsing
in a subprocess with a five-second deadline. Remove this override and copy
when an upstream release passes these behavioral checks without the patch.
