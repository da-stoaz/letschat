# UI review implementation

Started 2026-10-09. Tracks [APPLE_DESIGN_UI_REVIEW.md](APPLE_DESIGN_UI_REVIEW.md), in finding order.

| Findings | Status | Checks |
| --- | --- | --- |
| 1 | Implemented | TypeScript; Chrome desktop accessibility tree: named rail actions, full space/contact names |
| 2 | Implemented | TypeScript; Chrome accessibility tree: all ten notification switches have distinct names |
| 3 | Implemented | TypeScript; Chrome 320px/24px text: labels do not overlap and arrow-key focus scrolls Notifications fully into view |
| 4 | Implemented | TypeScript; return-path and invite acceptance unit checks; isolated backend check resolves the exact destination before consuming a single-use invite, with several existing spaces, and rejects unknown/restricted tokens. The page waits for that membership before navigating; Open spaces remains available while syncing. Full browser sign-in/join still needs manual verification. |
| 5–9 | Implemented | TypeScript and targeted ESLint; 147 existing unit checks + 2 download failure/cancellation checks passed; all 8 Astro pages built. Backend save/reset failure paths need live verification. |
| 10–14 | Implemented | TypeScript, targeted ESLint, 150 frontend unit checks plus history failure/retry check; 5 isolated backend history/pin tests; 212 API tests; Chrome: 74 sample layout checks passed. Pointer cancellation/unmount and native save behavior still need device checks. |
| 15–19 | Implemented | TypeScript, targeted ESLint, 152 frontend tests, 8-page site build; Chrome organization controls/group creation and friend confirmation/Cancel/Escape with focus return. Preference CSS and interrupted pointer gestures still need device preference checks. |
| 20–24 | Implemented | TypeScript, targeted ESLint, 3 release/platform checks, 212 API tests, 8-page site build; Chrome: profile draft/unsaved state survives Account → Connection → Account, 74 layout checks, public downloads, compact menu Escape/focus return at 175% browser zoom. Chrome also caught and prompted a fix for x64 MSI selecting an ARM asset; covered by the release check. Profile retention is scoped to Settings tabs; leaving Settings still ends the draft. Admin narrow-layout/contrast checks remain manual. |
| 25 | Implemented | 8-page site build; Chrome normal desktop and 400% zoom (~378 CSS px): separate headline lines, readable wrapping conversation preview, compact header. Preview is explicitly labeled example content, not a screenshot or interactive app. |

Browser checks use Chrome and the isolated sample fixture unless explicitly stated otherwise. Live backend and native Tauri checks are recorded separately when available.

## Delivery and remaining verification

All 25 findings have been implemented across ten commits. Each P1 received checks before its initial commit; subsequent implementation blocks contain at most five findings, with checks between blocks. Finding 4 received an additional checked follow-up to navigate directly to the resolved space.

The app and site production builds, TypeScript, and full ESLint pass. Latest suites: **156 frontend checks**, **108 backend security checks**, and **212 API tests** passed. Chrome sample layout matrix: **74 passed**. The additive pinned-content and invite-destination procedures compiled, and bindings were generated with the matching 2.10.1 CLI.

Ship the SpacetimeDB module with the client because pin previews and invite acceptance call the new procedures. Only isolated disposable review databases were published/reset; no existing development or production database was touched. Binding generation and backend tests used the raw compiled WASM because the local optimizer emitted invalid WASM. The storage-fence test now honors the same optional `STDB_MODULE_BIN` override as suite setup; the default source-build path remains unchanged.

Still verify authenticated invite/sign-in, service failure interactions, live uploads/downloads, native Tauri behavior, device gesture interruption, independently changed system accessibility preferences, VoiceOver, measured contrast, and narrow admin pages. Existing production bundle size warnings remain.
