# LetsChat UI review — apple-design

Reviewed 2026-10-08 using the installed [apple-design skill](.agents/skills/apple-design/SKILL.md). Recommendations favor small changes to the existing components, following [ponytail](.agents/skills/ponytail/SKILL.md).

## Assessment

The app has a solid responsive foundation: compact navigation, bounded conversation panes, useful call controls, and careful handling of long message content. Its largest gaps are accessible control names, enlarged-text layouts, and feedback that accurately reflects whether an action succeeded. Those deserve attention before additional visual effects.

Apple-style craft here means predictable behavior, readable hierarchy, immediate response, and recovery from mistakes. It does not require replacing every transition with a spring or adding translucent surfaces everywhere.

## Method and coverage

All browser inspection used **Google Chrome**. The app was reviewed through the existing local responsive fixture with sample data; the public Astro homepage was also inspected in Chrome. Source review covered the UI areas below, including shared components and failure paths.

| Area | Coverage |
| --- | --- |
| App shell | Rail, space/channel navigation, member panel, compact navigation, resizers, dialogs and sheets; source review and selected Chrome inspection |
| Conversations | Channels, DMs, composer, message actions, pins, loaded-message search, typing, scrolling, attachments; source review and selected Chrome inspection |
| People and spaces | Friends, discovery, invitations, creation/editing, space management, moderation and ownership dialogs; source review; Friends included in fixture layout checks |
| Calls | Call panel, media stage, participant tiles, mobile strip, microphone/camera/device controls; source review and Chrome call preview |
| Account and settings | Account, connection, notifications, credentials, registration, email confirmation, password recovery, setup and web connection states; source review and Chrome Settings inspection |
| Public site | Shared header/footer, homepage, download, roadmap, breaking changes, architecture, self-hosting and deployment guides; source review and Chrome homepage inspection |
| Instance/control-plane pages | Public instance landing page, admin layout/login/dashboard/users/pending/configuration/audit/detail/create-user, browser password reset and confirmation pages; source review |

The fixture reported **74 sample layout checks passed**. Its matrix covers ten routes at 320, 390, 430, 768, 844 landscape, 1024 and 1440px widths, plus additional call checks. These checks establish bounds and overflow behavior; they do not establish accessible naming, readable tab labels, actual media behavior, or successful backend operations. The Settings defect below is an example of a visual problem that passes the existing bounds checks.

Evidence labels:

- **Chrome:** directly observed in the rendered UI or Chrome accessibility tree.
- **Source:** directly supported by the current implementation; the failure or interaction was not reproduced against a live backend.
- **Design judgment:** a refinement to validate through a visual comparison or user testing, rather than a demonstrated functional defect.

Priorities: **P1** blocks a core path or makes important controls unusable for an affected user; **P2** impairs feedback, recovery, input or accessibility; **P3** is a visual/interaction refinement.

## Findings

### 1. P1 — Give rail navigation meaningful accessible names

**Evidence: Chrome + Source.** At 1440px, Chrome exposes unnamed Create Space, DM Home and Settings buttons. Compose DM is named only “+”; a space and a contact are represented by initials. The Discover action is named “StealthChat” through its image alternative text. Hover tooltips do not provide dependable names in the observed accessibility tree.

**Where:** [AppRail.tsx](src/layouts/app-layout/AppRail.tsx#L193), especially the navigation actions around lines 665–824.

**Change:** Add explicit names such as “Discover spaces”, “Create space”, “Direct messages”, “New message”, “Settings”, and the full space/contact name. Make decorative images empty-alt. Expose the current navigation destination with the appropriate current/selected semantics.

**Verify:** Inspect the Chrome accessibility tree and navigate by keyboard without relying on tooltips. Every action should identify its destination.

### 2. P1 — Associate notification switches with their labels

**Evidence: Chrome + Source.** The Notifications panel exposes ten switches as only “on” or “off”, with no setting name. Labels and descriptions are sibling paragraphs, so a screen-reader user cannot reliably distinguish the master switch, event controls, previews and quiet hours.

**Where:** [NotificationsTab.tsx](src/features/settings/NotificationsTab.tsx#L117).

**Change:** Give each switch an ID and associate its visible label; connect the description through `aria-describedby`. Make the label a useful click target as well.

**Verify:** Each switch announces a distinct name, state and relevant explanation. Quiet-hours Start/End fields already demonstrate explicit label association.

### 3. P1 — Let Settings tabs retain their text width

**Evidence: Chrome + Source.** At **320px with the fixture’s 24px root font**, Account, Connection and Notifications visibly overlap/clip. The page still reports no horizontal overflow. The list has overflow handling, but the shared trigger’s `flex-1` sizing allows the individual label boxes to become too narrow.

**Where:** [SettingsPanel.tsx](src/features/settings/SettingsPanel.tsx#L16), [tabs.tsx](src/components/ui/tabs.tsx#L24).

**Change:** For this list, use intrinsically sized triggers (`flex: 0 0 auto`) in a start-aligned horizontal scroller, or an equally readable compact navigation pattern. Avoid changing all tab lists without checking their intended layout.

**Verify:** At 320px/24px root size, every label remains distinct and every tab can be focused and brought into view. Also check long translations and the management/invite tab lists.

### 4. P1 — Preserve the invitation through sign-in and join the intended space

**Evidence: Source.** InvitePage sends unauthenticated users to `/auth?redirect=/invite/...`, but AuthPage redirects signed-in users to `/app`; the intended route is not consumed. After accepting, a separate 800ms timer selects the last space in the store, which is not a reliable identity for the space just joined.

**Where:** [InvitePage.tsx](src/pages/InvitePage.tsx#L20), [AuthPage.tsx](src/pages/AuthPage.tsx#L60), authentication routing in [App.tsx](src/App.tsx).

**Change:** Preserve a validated internal return destination across authentication. Resolve the accepted invite’s actual space and navigate when that membership is available, instead of using a delay and array order.

**Verify:** Open an invite while signed out, sign in, accept it, and land in that space. Repeat with several existing spaces and delayed synchronization.

### 5. P2 — Roll back failed discovery and tag changes

**Evidence: Source.** ServerTab immediately changes local discovery/tag state. The parent catches reducer failures and shows a toast, but does not return failure to the child or restore its local state. The setting can continue to look enabled or saved after the server rejected it.

**Where:** [ServerTab.tsx](src/features/server-manage/ServerTab.tsx#L59), [ServerManagePage.tsx](src/pages/ServerManagePage.tsx#L131).

**Change:** Keep immediate feedback, then reconcile with the authoritative value on failure. Preserve unsaved description text and show a nearby retryable error. Returning a result from the existing callback is sufficient; a new state framework is unnecessary.

**Verify:** Reject each save and confirm the displayed switch/tags match the persisted value, while editable text remains available for retry.

### 6. P2 — Do not report a password-reset request as sent after a network failure

**Evidence: Source.** ForgotPasswordForm catches every error and then unconditionally enters the “Check your inbox” state. A disconnected server therefore produces the same completion screen as a successful request.

**Where:** [ForgotPasswordForm.tsx](src/features/auth/ForgotPasswordForm.tsx#L49).

**Change:** Keep the generic, privacy-preserving response after a successful server response. Show a generic transport/service failure with Retry when the request itself cannot complete. This does not require revealing whether an account exists.

**Verify:** Successful requests remain indistinguishable for existing/nonexistent addresses; offline requests preserve the email and offer retry.

### 7. P2 — Add pending states to creation/editing forms

**Evidence: Source.** Create Space, Create Channel and Edit Channel await mutations without a submitting guard or pending button state. Repeated clicks or Enter presses can submit again while the first operation is outstanding.

**Where:** [CreateServerModal.tsx](src/modals/CreateServerModal.tsx#L19), [CreateChannelModal.tsx](src/modals/CreateChannelModal.tsx#L77), [EditChannelModal.tsx](src/modals/EditChannelModal.tsx#L108).

**Change:** Add a local pending flag, guard submission and change the existing action label to “Creating…”/“Saving…”. Retain the draft and show the error on failure. Existing moderation dialogs already use this pattern.

**Verify:** A slow request produces one mutation and clear continuous status; a rejected request leaves the form editable.

### 8. P2 — Make attachment download failures visible

**Evidence: Source.** AttachmentListItem explicitly discards download errors. The image lightbox resets its saving flag in `finally` without presenting a failure. A failed Save can appear to do nothing.

**Where:** [AttachmentListItem.tsx](src/features/chat/components/attachments/AttachmentListItem.tsx#L201), [AttachmentImageLightbox.tsx](src/features/chat/components/attachments/AttachmentImageLightbox.tsx#L217).

**Change:** Present a concise error naming the file, preserve the preview, and let the same action retry. Announce failure accessibly. Distinguish download failure from a user cancelling a save dialog where the platform exposes that distinction.

**Verify:** Reject a download and confirm the user gets an error and a working retry without losing the preview.

### 9. P2 — Only show “Copied” when copying succeeded

**Evidence: Source.** The app’s connection/invite copy buttons have no rejection handler. The website’s CodeBlock catches clipboard failure, ignores the fallback result, and then always shows “Copied”.

**Where:** [ConnectionTab.tsx](src/features/settings/ConnectionTab.tsx#L26), [InviteModal.tsx](src/modals/InviteModal.tsx#L91), [CodeBlock.astro](site/src/components/CodeBlock.astro#L48).

**Change:** Handle failure locally, retain selectable text, and show “Couldn’t copy — select and copy manually”. Keep the success feedback only for confirmed success.

**Verify:** Test with clipboard access denied as well as allowed. The visible state must match the actual result.

### 10. P2 — Distinguish unavailable pins/history from empty content

**Evidence: Source.** Pins are resolved only against messages already in memory; missing messages are skipped, so an existing older pin can yield “No pinned messages yet”. Jumping also returns silently when the target is not loaded. History paging is invoked with `void` and has no visible loading/error/retry state in the feed; the history functions propagate failures.

**Where:** [ChannelPinsPopover.tsx](src/features/channels/ChannelPinsPopover.tsx#L97), [ChatMessageFeed.tsx](src/features/chat/ChatMessageFeed.tsx#L211), [history.ts](src/lib/spacetimedb/history.ts#L36).

**Change:** Resolve pinned message content independently of the recent-message window, or visibly show unresolved rows while fetching. Load the target before jumping. Add a small top-of-feed history status with Retry and an accurate end-of-history state.

**Verify:** Pin a message outside the initial subscription window, reconnect, and open/jump to it. Interrupt a history request and recover without repeatedly nudging the scroll position.

### 11. P2 — Keep composition available during a send

**Evidence: Source.** ChatComposer disables the textarea and attachment controls for the whole submission, including uploads. A slow file upload prevents drafting the next message, even though the outgoing action already has progress feedback.

**Where:** [ChatComposer.tsx](src/features/chat/ChatComposer.tsx#L259), existing draft/submission logic in [submitComposer.ts](src/features/chat/submitComposer.ts).

**Change:** Snapshot the outgoing content and permit a new draft while it sends. Keep failed outgoing content recoverable without overwriting newer typing. This needs careful draft ownership; do not simply remove `disabled` and introduce data loss.

**Verify:** Type a second message during a slow upload, then fail the first send. Both drafts/content must remain recoverable and associated with the correct conversation.

### 12. P2 — Connect form errors and field labels consistently

**Evidence: Source.** CredentialsForm displays its general error as an unannounced paragraph, and confirmation mismatch is only reported on submit. Several channel/invite form labels are visually adjacent without explicit control association. The browser password-reset form also has labels without `for`/input IDs.

**Where:** [CredentialsForm.tsx](src/features/auth/CredentialsForm.tsx#L89), [CreateChannelModal.tsx](src/modals/CreateChannelModal.tsx), [InviteModal.tsx](src/modals/InviteModal.tsx#L530), [AuthEndpoints.cs](core-api/src/CoreApi/Endpoints/AuthEndpoints.cs#L829).

**Change:** Associate visible labels, hints and errors with their controls; use fieldsets/legends for groups. Announce submission errors. Validate confirmation once the user has meaningfully interacted, and set `aria-invalid` on the affected input. Add `autocomplete="new-password"` to the browser reset fields.

**Verify:** Keyboard and accessibility-tree inspection identifies every field and its error. Correcting one field should not leave a stale mismatch warning.

### 13. P2 — Remove the nested Retry button from image thumbnails

**Evidence: Source.** AttachmentImageGrid places a Retry `<button>` inside the outer preview `<button>`. Nested interactive controls have invalid semantics and can produce confusing focus/activation behavior.

**Where:** [AttachmentImageGrid.tsx](src/features/chat/components/attachments/AttachmentImageGrid.tsx#L36).

**Change:** Render the failed state as a noninteractive wrapper with its own Retry button, or make preview and retry sibling actions. Do not make the outer surface an action when there is nothing to preview.

**Verify:** A failed image has one unambiguous retry target, correct keyboard focus order, and no accidental preview activation.

### 14. P2 — Make panel resize gestures cancel safely

**Evidence: Source.** Both resize handlers clean up only on `pointerup`. There is no pointer capture, `pointercancel` handling or shared unmount cleanup for the active drag. An interrupted gesture can leave listeners or body cursor/selection overrides active. The visible/hit handle is also only 3px wide.

**Where:** [AppLayout.tsx](src/layouts/AppLayout.tsx#L541), handles around lines 664 and 724.

**Change:** Capture the pointer, use a shared cleanup path for up/cancel/lost capture/unmount, and restore prior body styles. Expand the invisible hit region while retaining the thin visual divider. Preserve the existing keyboard resizing and direct 1:1 movement.

**Verify:** Drag outside the pane, cancel the gesture and navigate away mid-drag. Cursor/selection must recover every time; keyboard resizing must still work.

### 15. P2 — Provide a keyboard alternative for rail organization

**Evidence: Source.** AppRail explicitly installs only PointerSensor. Sorting and creating groups depend on pointer movement/position, with no equivalent move/group actions in the reviewed rail controls.

**Where:** [AppRail.tsx](src/layouts/app-layout/AppRail.tsx#L431).

**Change:** Add straightforward “Move up/down” and “Move into/out of group” actions, or implement keyboard dragging including the grouping behavior. Adding KeyboardSensor alone will not reproduce the custom pointer-dependent group intent.

**Verify:** Organize and ungroup spaces entirely with a keyboard, with meaningful announcements and stable focus after each change.

### 16. P2 — Extend motion preferences to JavaScript and the public site

**Evidence: Source.** The app’s CSS reduces animation duration, and video docking explicitly checks reduced motion. Image zoom/fit still uses react-zoom-pan-pinch’s animated JavaScript defaults. The self-hosting pages have indefinite 12–15 second decorative drift animations without a site reduced-motion override. Neither UI stylesheet provides reduced-transparency/increased-contrast treatments for its translucent surfaces.

**Where:** [index.css](src/index.css#L176), [AttachmentImageLightbox.tsx](src/features/chat/components/attachments/AttachmentImageLightbox.tsx#L83), [self-hosting.astro](site/src/pages/self-hosting.astro#L196), its Caddy/Cloudflare guides, [SiteHeader.astro](site/src/components/SiteHeader.astro#L126).

**Change:** Feed reduced-motion into animated zoom/reset operations and disable decorative drift when requested. Add solid-surface and stronger-border alternatives for transparency/contrast preferences. Reuse the video dock’s preference handling as a local precedent.

**Verify:** Change each preference independently. Zoom and Fit should remain usable with immediate/static updates; status and press feedback should remain understandable.

### 17. P2 — Finish the touch-target treatment for switches and site navigation

**Evidence: Source.** The app applies a 44px minimum to many touch controls, but explicitly excludes switches. The default switch is 18.4px tall with 8px hit padding on each side: approximately 34.4px total height. Site header actions also use compact text/padding without a comparable touch minimum.

**Where:** [switch.tsx](src/components/ui/switch.tsx#L17), [index.css](src/index.css#L165), [SiteHeader.astro](site/src/components/SiteHeader.astro#L229).

**Change:** Keep the small visual switch but put it in a reliably sized hit area or make its associated row label clickable. Give mobile header actions a comfortable minimum height without inflating desktop navigation.

**Verify:** Check actual interactive bounds on coarse-pointer layouts, with space between adjacent actions; larger hit areas must not overlap other controls.

### 18. P2 — Repair invalid scrollbar color expressions

**Evidence: Source.** Theme tokens contain full `oklch(...)` colors, but app scrollbar tokens wrap them in `hsl(var(--background) / ...)` and `hsl(var(--border) / ...)`. Those resolve to invalid color expressions. The resize-handle shadow has the same mismatch.

**Where:** [index.css](src/index.css#L199), [AppLayout.tsx](src/layouts/AppLayout.tsx#L109).

**Change:** Use the color token directly or `color-mix` for transparency. Verify the resulting scrollbar contrast in each scrollable pane rather than increasing all borders.

**Verify:** Inspect computed styles and confirm the intended thumb/track/hover colors render, including on long Settings/member lists.

### 19. P2 — Give destructive message actions a recovery boundary

**Evidence: Source.** Delete Message is directly available in both the hover controls and menu, and the channel handler immediately calls the delete reducer. Remove Friend also commits immediately. The reviewed UI provides no undo/recovery step for these actions.

**Where:** [MessageBubble.tsx](src/features/channels/MessageBubble.tsx#L224), [TextChannelView.tsx](src/features/channels/TextChannelView.tsx#L148), [FriendsView.tsx](src/features/friends/FriendsView.tsx#L219), equivalent DM message actions.

**Change:** Prefer Undo where the existing data model supports safe recovery. For message deletion without recovery, use a lightweight confirmation rather than pretending an undo exists. Removing a friend can use a small confirmation with the person’s name; avoid adding dialogs to routine reversible toggles.

**Verify:** A mistaken activation has a clear escape/recovery path and an error does not silently remove the item.

### 20. P2 — Make unsaved profile edits apparent

**Evidence: Source.** AccountTab keeps profile edits in component state. Leaving the panel can discard them, while there is no dirty indicator. The avatar upload correctly says it is ready and still needs Save Profile; this useful distinction should also be clear for the form as a whole.

**Where:** [AccountTab.tsx](src/features/settings/AccountTab.tsx#L48), [SettingsPanel.tsx](src/features/settings/SettingsPanel.tsx).

**Change:** Show a compact unsaved state and preserve the draft across tab changes, or warn only when genuinely abandoning dirty edits. Reuse the admin configuration page’s explicit “Unsaved changes” vocabulary without adding a global dialog for every navigation.

**Verify:** Edit the display name, switch tabs and return. The draft should survive or the user should have had a clear chance to keep it.

### 21. P2 — Explain unavailable downloads and select platforms accurately

**Evidence: Source.** Website download anchors begin as `href="#"` with opacity and pointer-event suppression; they remain keyboard links while unavailable, and a missing individual release asset gets no specific explanation. The instance landing page maps iPhone/iPad/iPod to macOS and ordinary Android user agents to Linux, presenting desktop installers as the visitor’s detected platform.

**Where:** [download.astro](site/src/pages/download.astro#L43), asset resolution around line 207; [Index.cshtml](core-api/src/CoreApi/Pages/Index.cshtml#L65).

**Change:** Render an explicit loading/unavailable state until each asset is resolved, with correct disabled semantics and nearby text. For mobile or unknown platforms, show the supported desktop choices rather than claiming a matching installer. Keep the existing GitHub Releases recovery link.

**Verify:** Test before release data resolves, with one asset absent, with fetch failure, and with mobile user agents. Keyboard activation should never jump to `#` as a substitute for a download.

### 22. P2 — Strengthen public/admin wayfinding semantics

**Evidence: Source.** Public and admin navigation mark the current section visually through CSS, but do not expose `aria-current`. The public mobile menu closes on link activation/desktop resize, but has no Escape handling; closing through a resize can hide a focused menu link. Admin user search relies on a placeholder for its name.

**Where:** [SiteHeader.astro](site/src/components/SiteHeader.astro#L63), [admin _Layout.cshtml](core-api/src/CoreApi/Pages/Admin/_Layout.cshtml#L19), [Users.cshtml](core-api/src/CoreApi/Pages/Admin/Users.cshtml#L17).

**Change:** Add current-page semantics, a durable search label, Escape dismissal and focus return when closing would hide focus. Preserve normal tab navigation for the nonmodal menu; it does not need a modal focus trap.

**Verify:** Traverse the public mobile header and admin navigation by keyboard. Location and exit should be understandable without visual styling.

### 23. P3 — Reduce competing surface borders in the app

**Evidence: Chrome + Design judgment.** The desktop channel view and Settings use several nested rounded/bordered surfaces. Notifications adds a card around the master control and another bordered surface around the switch row. Similar nesting appears in space identity settings. The repeated enclosure gives structural decoration similar emphasis to content and primary actions.

**Where:** [AppLayout.tsx](src/layouts/AppLayout.tsx), [NotificationsTab.tsx](src/features/settings/NotificationsTab.tsx#L132), [ServerTab.tsx](src/features/server-manage/ServerTab.tsx#L108).

**Change:** Keep enclosure for major panes and true grouped tasks; replace some inner boxes with spacing, a modest background change or a section label. Reserve blur/depth for overlays that actually sit above content. Keep modal scrims for modal tasks and the member pane unobscured for parallel work.

**Verify:** Compare representative desktop/mobile screenshots. Conversation content and the active task should become easier to identify, with no loss of grouping.

### 24. P3 — Establish a more readable secondary type hierarchy

**Evidence: Source + Design judgment.** Several frequently consulted labels use 10–11px text, including rail initials, pin timestamps and call metadata. Settings descriptions and metadata often have similar muted treatment despite different importance. The app uses Geist Variable; the admin uses a system stack, with a separate fixed-pixel scale.

**Where:** [AppRail.tsx](src/layouts/app-layout/AppRail.tsx), [ChannelPinsPopover.tsx](src/features/channels/ChannelPinsPopover.tsx#L47), call tile/status components, [admin.css](core-api/src/CoreApi/wwwroot/css/admin.css).

**Change:** Define a small shared hierarchy for headings, body, supporting text and incidental metadata. Keep useful secondary text comfortably readable, emphasize labels with weight, and scale spacing with text. Review contrast using computed colors against actual surfaces; no contrast ratios were measured in this audit. A font replacement is not required.

**Verify:** Read realistic messages, timestamps and call status at normal and enlarged text sizes. Include the admin at narrow widths before declaring that scale complete.

### 25. P3 — Make the public homepage show and explain the product more directly

**Evidence: Chrome + Source + Design judgment.** The homepage visibly joins the two headline sentences as “chat.Keep”. The hero/product imagery emphasizes layered promotional illustrations, and nearby copy includes implementation language such as “LiveKit-based media path”, “composable service topology” and “reflected in the codebase”. This makes a prospective user work to understand the everyday experience.

**Where:** [index.astro](site/src/pages/index.astro#L43), feature/product sections below the hero.

**Change:** Make the headline separation explicit across line wrapping. Lead with recognizable real conversation/call UI at readable scale, and describe the user outcome in the main feature copy. Put operator details in the existing architecture/self-hosting destinations. Resolve the app rail’s stale StealthChat alternative text as part of finding 1.

**Verify:** At desktop and mobile widths the heading reads naturally, and a new visitor can identify what chatting/calling looks like and how to begin.

## What to preserve

- Immediate pressed feedback is already present through `:active` styling and button treatment. Keep it independent of network completion.
- Compact layouts, visual-viewport handling, safe areas, coarse-pointer adaptations and wrapping of long conversation content are valuable foundations.
- Dialog/sheet primitives provide consistent structure; the mobile call preview has clear, named controls and reachable actions. Button-driven sheets do not need gesture physics unless dragging is introduced.
- Popovers already use origin-aware positioning. Keep short transitions for these frequent interactions; extra bounce would compete with their purpose.
- Message edit failures retain the draft and provide an inline alert. Composer drafts are scoped by conversation, and the feed preserves reading position. Extend these existing patterns rather than replacing them.
- Video docking checks reduced motion, reuses the live media element and cleans up animation work. Preserve these properties.
- Loaded-message search accurately describes its scope. Preserve that honesty until full-history search exists.
- Destructive space/ownership workflows already have deliberate confirmation. Admin configuration has an explicit unsaved state; dashboard charts have textual accessibility summaries.

## Suggested order

1. Fix accessible names and enlarged-text tabs, then invitation continuity (1–4).
2. Fix truthful status and retry behavior (5–10), field/error semantics (12–13), and unavailable downloads (21).
3. Improve input continuity, gesture cancellation, keyboard organization and preferences (11, 14–18, 22).
4. Resolve recovery/draft behavior (19–20), then compare the visual refinements (23–25).

Start with existing components and local state. No broad design-system rewrite or new animation dependency is necessary for most findings.

## Remaining verification

This is a repository-wide review, with selective rendered verification rather than an exhaustive live walkthrough of every state. The local admin address refused connection, so control-plane pages were reviewed from source. Authenticated backend flows, real invitation acceptance, uploads/download failures, actual notification delivery, media permissions, live calls, multi-user synchronization and Tauri-native behavior were not exercised. The sample call’s loading screen-share content is a fixture state and was not treated as a product defect.

The 24px text check is a fixture text-scaling check, not full browser zoom or a device accessibility audit. VoiceOver output, real touch gestures, localization, measured contrast and animation frame timing still need targeted verification. Source findings should be reproduced while implementing their fixes; visual refinements should be validated with before/after screenshots and representative users.

Only this review document was added. No UI implementation was changed.
