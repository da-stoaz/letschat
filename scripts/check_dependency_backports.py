#!/usr/bin/env python3
"""Verify both security backports against their exact published archives."""
import hashlib
import io
from pathlib import Path
import sys
import tarfile
import tomllib
import json
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def check(condition, message):
    if not condition:
        raise SystemExit(message)


def verify_archive(directory, prefix, url, checksum, changed_file, changes, argument):
    archive = Path(sys.argv[argument]).read_bytes() if len(sys.argv) > argument else urlopen(url, timeout=60).read()
    check(hashlib.sha256(archive).hexdigest() == checksum, f'Upstream archive checksum mismatch: {prefix}')
    expected_files = set()
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            if member.isdir():
                continue
            check(member.isfile(), f'Unexpected archive entry: {member.name}')
            relative = Path(member.name).relative_to(prefix)
            check('..' not in relative.parts, 'Invalid archive path')
            expected_files.add(relative)
            expected = tar.extractfile(member).read()
            if relative == changed_file:
                for before, after in changes:
                    check(expected.count(before) == 1, 'Upstream patch context changed')
                    expected = expected.replace(before, after)
            actual = directory / relative
            check(actual.is_file() and actual.read_bytes() == expected, f'Unexpected vendor difference: {relative}')
    check({p.relative_to(directory) for p in directory.rglob('*') if p.is_file()} == expected_files,
          'Unexpected extra files in vendored dependency')
    print(f'{prefix}: {len(expected_files)} files verified against published archive plus documented patch.')


verify_archive(ROOT / 'src-tauri/vendor/glib-0.18.5', 'glib-0.18.5',
    'https://static.crates.io/crates/glib/glib-0.18.5.crate',
    '233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5',
    Path('src/variant_iter.rs'), [
        (b'let p: *mut libc::c_char = std::ptr::null_mut();', b'let mut p: *mut libc::c_char = std::ptr::null_mut();'),
        (b'                &p,', b'                &mut p,'),
    ], 1)

verify_archive(ROOT / 'site/vendor/http-cache-semantics', 'package',
    'https://registry.npmjs.org/http-cache-semantics/-/http-cache-semantics-4.3.0.tgz',
    'd75e1e6a11587954da5e2f0e2b5c4b397a16d28cc2f7bdf64e9027fc2fe593ee', Path('index.js'), [
        (b'        this._assertRequestHasHeaders(req);\n\n        // In all circumstances',
         b'        this._assertRequestHasHeaders(req);\n\n'
         b'        // CVE-2026-93748: max-stale must not revive a security-zeroed entry.\n'
         b'        // Conservatively require revalidation for every zero-lifetime response.\n'
         b'        if (this.maxAge() === 0) {\n'
         b'            return this._evaluateRequestMissResult(req);\n'
         b'        }\n\n        // In all circumstances'),
    ], 2)

manifest = tomllib.loads((ROOT / 'src-tauri/Cargo.toml').read_text())
check(manifest['patch']['crates-io']['glib']['path'] == 'vendor/glib-0.18.5', 'GLib patch is not enabled')
lock = tomllib.loads((ROOT / 'src-tauri/Cargo.lock').read_text())
glib = [p for p in lock['package'] if p['name'] == 'glib']
check(len(glib) == 1 and glib[0]['version'] == '0.18.5' and 'source' not in glib[0],
      'Lockfile must resolve only the patched local GLib')
test_manifest = tomllib.loads((ROOT / 'src-tauri/security-tests/Cargo.toml').read_text())
check(test_manifest['dependencies']['glib']['path'] == '../vendor/glib-0.18.5',
      'Regression tests must exercise the patched local GLib')
site = json.loads((ROOT / 'site/package.json').read_text())
check(site['overrides']['http-cache-semantics'] == '$http-cache-semantics' and site['dependencies']['http-cache-semantics'] == 'file:./vendor/http-cache-semantics', 'Cache policy override is not enabled')
site_lock = json.loads((ROOT / 'site/package-lock.json').read_text())
cache_packages = [package for name, package in site_lock['packages'].items()
                  if name.endswith('node_modules/http-cache-semantics')]
check(cache_packages and all(package.get('link') and package.get('resolved') == 'vendor/http-cache-semantics'
                             for package in cache_packages),
      'All cache-semantics consumers must resolve to the local patch')
print('Production manifests and lockfiles resolve to the verified backports.')
