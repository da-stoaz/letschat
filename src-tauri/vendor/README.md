# GLib 0.18 security backport

Tauri's GTK3/WebKitGTK dependencies require `glib` 0.18. The published fix for
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
starts at 0.20, which cannot replace 0.18 without migrating that dependency
chain. There is no patched 0.18 release.

`glib-0.18.5/` is the complete published crate from
https://static.crates.io/crates/glib/glib-0.18.5.crate, with SHA-256:

```
233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5
```

The only source changes are the two lines from the reviewed
[upstream fix](https://github.com/gtk-rs/gtk-rs-core/pull/1343):
`VariantStrIter::impl_get` declares `p` mutable and passes `&mut p` to
`g_variant_get_child`. This prevents writes through an immutable reference
and the resulting null dereference under optimization. Original license,
copyright notices, version, and upstream tests are preserved.

`[patch.crates-io]` in the desktop manifest applies this to every transitive
consumer, including GTK, WebKitGTK, and Tauri. The lockfile resolves GLib to
this local source. The version intentionally remains 0.18.5: this is a
backport, not a claim that the dependency is upstream GLib 0.20.

Verification (also run by the dependency security PR workflow):

```sh
python3 scripts/check_dependency_backports.py
cargo test --manifest-path src-tauri/security-tests/Cargo.toml --locked --release
```

The first check compares every vendored file with the checksum-verified
published archive, allowing exactly the two-line fix, and checks the manifest
and lockfile routing. The second exercises forward/reverse, indexed, Unicode and empty string iteration with release
optimizations, where the original bug manifests. Linux requires
`libglib2.0-dev` and `pkg-config`.

Remove this patch and directory when Tauri's full GTK dependency chain moves
to a compatible patched upstream release. Version-only scanners may continue
to report 0.18.5; do not hide the advisory with a fabricated version or an audit
ignore. Review the pinned-source checks above when evaluating such reports.
