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
| 15 | Dialog removed at user request | Removed the Organize spaces dialog and its rail trigger. Existing pointer sorting/grouping remains; a replacement keyboard organization flow has not been added. |
| 16–19 | Implemented | TypeScript, targeted ESLint, 152 frontend tests, 8-page site build; Chrome friend confirmation/Cancel/Escape with focus return. Preference CSS and interrupted pointer gestures still need device preference checks. |
| 20–24 | Implemented | TypeScript, targeted ESLint, 3 release/platform checks, 212 API tests, 8-page site build; Chrome: profile draft/unsaved state survives Account → Connection → Account, 74 layout checks, public downloads, compact menu Escape/focus return at 175% browser zoom. Chrome also caught and prompted a fix for x64 MSI selecting an ARM asset; covered by the release check. Profile retention is scoped to Settings tabs; leaving Settings still ends the draft. Admin narrow-layout/contrast checks remain manual. |
| 25 | Implemented | 8-page site build; Chrome normal desktop and 400% zoom (~378 CSS px): separate headline lines, readable wrapping conversation preview, compact header. Preview is explicitly labeled example content, not a screenshot or interactive app. |

Browser checks use Chrome and the isolated sample fixture unless explicitly stated otherwise. Live backend and native Tauri checks are recorded separately when available.

## Delivery and remaining verification

The initial implementation covered all 25 findings across ten commits. Each P1 received checks before its initial commit; subsequent implementation blocks contain at most five findings, with checks between blocks. Finding 4 received an additional checked follow-up to navigate directly to the resolved space. Later user-requested corrections are recorded below and in the status table.

The app and site production builds, TypeScript, and full ESLint pass. Latest suites: **156 frontend checks**, **108 backend security checks**, and **212 API tests** passed. Chrome sample layout matrix: **74 passed**. The additive pinned-content and invite-destination procedures compiled, and bindings were generated with the matching 2.10.1 CLI.

Ship the SpacetimeDB module with the client because pin previews and invite acceptance call the new procedures. Only isolated disposable review databases were published/reset; no existing development or production database was touched. Binding generation and backend tests used the raw compiled WASM because the local optimizer emitted invalid WASM. The storage-fence test now honors the same optional `STDB_MODULE_BIN` override as suite setup; the default source-build path remains unchanged.

Still verify authenticated invite/sign-in, service failure interactions, live uploads/downloads, native Tauri behavior, device gesture interruption, independently changed system accessibility preferences, VoiceOver, measured contrast, and narrow admin pages. Existing production bundle size warnings remain.

## Follow-up corrections — 2026-10-09

The compact list routes were not limited to compact widths. They could leave a desktop window showing the Spaces/Messages list alongside the rail, without its normal channel sidebar. `NavigationPage` now replaces those routes at desktop widths: Spaces opens the preferred space, Messages opens Friends, and a channel list opens that exact space. This also handles widening a window while on a compact list. The sample router now includes the real space-index route, and the layout matrix explicitly rejects compact lists on desktop. Checks: TypeScript, targeted ESLint, 157 frontend tests, Chrome route/resize checks, and all 74 sample layout checks passed.

Removed the separate Organize spaces dialog and its rail button at the user's request. The component was deleted rather than left as unused code. Checks: TypeScript, full ESLint, production build, and Chrome desktop rail inspection passed; source search confirms no remaining dialog references. These follow-up browser checks used Chrome sample data, not the native Tauri binary.

### Rail dragging correction

Reproduced an icon drag that crossed another icon's center and then dropped at its edge: the old grouping lock created a folder instead of reordering. Drop intent now follows the current pointer and the committed operation uses the displayed target. The insertion bar occupies no layout space, grouping targets show a dot, and target icons no longer scale or animate their positions during the gesture. Reordering within a folder uses sorting rather than removing/recreating that folder. New folders retain the target's original position.

Space images disable native image dragging, sortable controls disable competing touch panning, and cancellation clears the overlay and indicators. Added a focused fixture at `tests/ui/rail-drag.html`, with isolated sample rail storage and a **Check rail drag gestures** action. It checks ten complete pointer sequences, visible bar/dot previews, stable target geometry, both reorder directions, folder creation/addition/reordering/extraction/movement, collapsed folders, cancellation, and touch. Chrome: all ten passed; both indicators were visually inspected. TypeScript, full ESLint, production build, and all 159 frontend tests passed.

The same ten checks passed in an isolated macOS Tauri WebView with sample data, and the grouping dot was visually inspected there. The fixture generates multi-step PointerEvents through the real rendered rail; physical mouse/trackpad/touch hardware remains a manual check. The standard native release build (`tauri build --no-bundle`) also passed and restored the normal app configuration after the isolated fixture build. Native executable: `src-tauri/target/release/letschat_tauri`. No normal app installation or account data was changed.

### Join call button sizing

Removed the Join call button's hardcoded 48px height. It now uses the shared 32px desktop button height; the existing mobile/coarse-pointer rule retains a 44px touch target. Added an idle voice channel to the sample fixture so the layout matrix checks the real Join call button's height and bounds at every viewport. Chrome: all 81 sample layout checks passed, with desktop and mobile appearance visually inspected. TypeScript, full ESLint, production build, and the native release build (`tauri build --no-bundle`) passed. The native executable was rebuilt; the installed app was not replaced.
