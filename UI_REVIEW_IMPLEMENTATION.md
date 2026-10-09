# UI review implementation

Started 2026-10-09. Tracks [APPLE_DESIGN_UI_REVIEW.md](APPLE_DESIGN_UI_REVIEW.md), in finding order.

| Findings | Status | Checks |
| --- | --- | --- |
| 1 | Implemented | TypeScript; Chrome desktop accessibility tree: named rail actions, full space/contact names |
| 2 | Implemented | TypeScript; Chrome accessibility tree: all ten notification switches have distinct names |
| 3 | Implemented | TypeScript; Chrome 320px/24px text: labels do not overlap and arrow-key focus scrolls Notifications fully into view |
| 4 | Implemented | TypeScript; return-path unit check (retains invite, rejects unsafe destinations). Join now shows Open spaces instead of guessing a server from array order; live sign-in/join still requires backend verification. |
| 5–9 | Implemented | TypeScript and targeted ESLint; 147 existing unit checks + 2 download failure/cancellation checks passed; all 8 Astro pages built. Backend save/reset failure paths need live verification. |
| 10–14 | Implemented | TypeScript, targeted ESLint, 150 frontend unit checks plus history failure/retry check; 5 isolated backend history/pin tests; 212 API tests; Chrome: 74 sample layout checks passed. Pointer cancellation/unmount and native save behavior still need device checks. |
| 15–25 | Pending | |

Browser checks use Chrome and the isolated sample fixture unless explicitly stated otherwise. Live backend and native Tauri checks are recorded separately when available.
