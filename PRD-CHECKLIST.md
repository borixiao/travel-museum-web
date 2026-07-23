# PRD Checklist — travel-museum-web vs. `travel-museum-PRD.pdf` (MVP v1.0, June 2026)

Status legend: ✅ done · ⚠️ partial / substituted · ❌ missing

Source of truth: `Travel Memory Museum App — PRD v1.0 — June 2026`
(`~/Desktop/Summer Project/travel-museum-PRD.pdf`)

Note: the PRD's screen split assumes a native app (LoginScreen → HomeScreen →
AddItemScreen → Generate3DScreen → ItemDetailScreen → CollectionScreen →
MoodboardScreen → ProfileScreen). This web project intentionally merges some
of these (e.g. Add Item + Generate 3D into one `UploadPage`; Home + Collection
into one `HomePage`) — that merge itself isn't flagged as a gap below, only
the individual requirements that are actually missing.

---

## 4.1 Login / Register Screen
- ✅ Email + password login / register
- ✅ Confirm password field on register — new field in `LoginPage.tsx`, only rendered in register mode; checked against `password` client-side before the Firebase Auth call so a typo surfaces instantly as "Passwords do not match" rather than a confusing post-request error; cleared whenever the user toggles between login/register mode
- ✅ **Forgot password** — new "Forgot password?" link in `LoginPage.tsx` (login mode only), calling Firebase Auth's `sendPasswordResetEmail` with whatever's in the email field; message is deliberately non-committal about whether an account exists ("If an account exists for that email...") since Firebase's default email-enumeration protection means the call succeeds either way — so the copy shouldn't imply otherwise; errors (e.g. malformed email) surface via the same `error` state the login/register submit already uses

## 4.2 Home Screen
PRD treats this as a distinct dashboard/entry screen, separate from
Collection (4.6). Currently merged into `HomePage.tsx`, which is really the
Collection grid — none of Home's own dashboard content exists.
- ✅ Welcome message with user name (`users/{uid}` doc created on registration, lazily backfilled for pre-existing accounts via `getOrCreateUserProfile`; rendered as a banner above the Collection grid in `HomePage.tsx`)
- ✅ **Recent items rail (latest 4, horizontal scroll)** — new strip in `HomePage.tsx`, above the search/filter/sort controls, showing `items.slice(0, 4)` (Firestore already returns newest-first, so no re-sorting needed); deliberately independent of the search/filter/sort state below — always the true latest 4 regardless of what's currently filtered in the main grid; tapping a card opens the same item detail view as the main grid
- ❌ "My Collections" list (PRD implies multiple named collections; current data model only has one flat `items` list per user)
- ⚠️ Add New Item CTA — exists as a bottom tab, not a Home-screen button (reasonable substitute)

## 4.3 Add Item Screen
- ✅ Photo capture (web file inputs for front/left/back/right, substituting native camera)
- ✅ Photo count indicator + validation (front required, 2+ minimum)
- ✅ Item info fields: name (required), type, location (with autocomplete — beyond PRD), date, story, emotion tags
- ✅ **Retake a single photo in place** — `UploadPage.tsx` now shows a live thumbnail (object URL) per slot once a file is chosen, with a "Tap to retake" overlay (clicking the thumbnail re-opens the same file picker) and a separate "×" clear button. The "×" is a *sibling* of the `<label>` wrapping the hidden `<input>`, not nested inside it — nesting it would risk the browser's native label→input click-forwarding still opening the file picker even with `stopPropagation()` on the button. Object URLs are created/revoked at the single `handlePhotoChange` mutation point (old URL revoked before a new one is made, or on clear), plus a final revoke-all on unmount to avoid leaking blob URLs

## 4.4 Generate 3D Screen
- ✅ Uploading / Generating / Preview / Error states
- ✅ Save
- ✅ **Regenerate** from the Preview state — new button next to "Save to Firebase" in `UploadPage.tsx`'s Preview section, re-invoking the same `handleGenerate()` (same photos, full retry logic included) without resetting the rest of the form. The old model stays visible until the new one finishes (`modelBlobUrl` isn't cleared upfront), with the old blob URL revoked only once the replacement is ready to avoid a flash of "no model"; Save and Regenerate are both disabled while a (re)generation is in flight
- ✅ **Cancel** — new "Cancel" button shown under the progress bar during Uploading/Generating. A real cancellation (not just hiding the UI): an `AbortController` created at the start of `handleGenerate` is threaded through `generate3DModelWithRetry` → `generate3DModel`/`pollTaskUntilDone` → the underlying `fetch` calls in `tripoClient.ts`, plus a new cancelable `sleep()` helper so Cancel takes effect immediately instead of waiting out the current poll interval. A new `isAbortError()` helper distinguishes the resulting `DOMException('AbortError')` from a genuine failure, so canceling (a) resets to the idle state instead of showing an error, and (b) doesn't burn one of the automatic retry attempts in `generate3DModelWithRetry`'s catch block

## 4.5 Item Detail Screen
- ✅ 3D viewer, name, type badge, location, date, story, emotion tags
- ✅ **Original photos, swipeable** — new `PhotoGallery` component (CSS scroll-snap carousel, one photo per "page", native touch/trackpad swipe with a "N / total" indicator + dots), rendered above the 3D viewer in `HomePage.tsx`'s detail view
- ✅ Edit / Delete (with confirmation)
- ✅ **"Add to Moodboard" action** from Item Detail — new button next to Edit/Delete in `HomePage.tsx`'s detail view, calling a new shared `addItemToMoodboard(userId, item)` in `src/services/moodboard.ts`. That function (and the grid-placement math it uses, `nextMoodboardCardPosition`) is now the single source of truth for building a card snapshot, used by both this entry point and `MoodboardPage.tsx`'s own "tap thumbnail to add" strip, so they can't drift apart

## 4.6 Collection Screen
- ⚠️ Grid view — present, but auto-fill layout rather than a strict 2-column grid
- ✅ **Search bar** — client-side, matches name/location/type substring (all items already fetched in one shot, no pagination to work around)
- ⚠️ **Filter tabs** — implemented as dynamic tabs derived from whatever `type` values actually exist in the user's collection ("All" + each distinct type), not PRD's hardcoded All/Tickets/Magnets/Postcards/Other — the app's Type field is free text (ITEM_TYPE_PRESETS are only suggestions), so a fixed 4-tab set would either miss real values or bucket everything into "Other"
- ✅ **Sort options** (Date newest/oldest, Location A–Z, Type A–Z) — `<select>` control above the grid; "oldest" is just `.reverse()` on the already-`createdAt desc`-ordered array from Firestore, no extra Timestamp parsing needed

## 4.7 Moodboard Editor Screen
- ✅ Free-form drag-to-reposition canvas, Add Item, Add Text, Generate Link (Publish)
- ✅ **Rotate handle** — new blue ⟳ corner handle (top-left) on each card, drag to rotate around the card's own center; wires up `MoodboardCard.rotation`, a field that existed in the type since day one but was never actually applied as a CSS transform anywhere until now
- ✅ **Bring-to-front layering** — dragging, rotating, or resizing a card (but not a plain tap-to-expand) reorders it to render on top, matching how re-pinning something on a physical corkboard works; implemented as a z-index derived from the card's position in the `cards` array (see note below on why it's z-index and not DOM order)
- ✅ **Resize handle** (substitute for PRD's pinch-to-resize, which has no mouse/trackpad equivalent) — new green ⇲ corner handle (bottom-right), drag to resize width (6%–70% of canvas), height follows automatically via the card's own fixed aspect ratio / auto-reflowing text
- ✅ **Sticker/3D display-mode toggle** (beyond PRD — came out of a reference-image discussion about matching a physical shadow-box display's mix of flat stickers and real objects) — new purple 🧊/🖼 corner handle (bottom-left, the last free corner) on item cards that have a 3D model, switching `MoodboardCard.displayMode` between a flat sticker/photo thumbnail and a passive, non-interactive auto-rotating 3D preview (full interactive orbiting stays reserved for the existing tap-to-expand detail modal, to avoid its drag-to-orbit control fighting the card's own move/rotate/resize pointer-capture gestures)
- ✅ **Background color picker** — new native `<input type="color">` next to Publish/Add text, backed by a new `Moodboard.backgroundColor` field (`setMoodboardBackgroundColor` in `services/moodboard.ts`); write to Firestore is debounced 400ms (the native picker fires many onChange events while being dragged) while the canvas itself updates optimistically/instantly; new boards are seeded with the same default (`DEFAULT_MOODBOARD_BACKGROUND`) the canvas already fell back to, so old boards without the field render identically; public `/m/:id` viewer (`MoodboardViewPage.tsx`) also reads and renders it
- ❌ **Scrollable/zoomable canvas** — fixed-aspect-ratio box, no pan/zoom
- ❌ **Add Photo** as a standalone element type (camera-roll photo not tied to a saved item) — `MoodboardCard.type` only supports `'item' | 'text'`, no `'photo'`; discussed and deliberately deferred (not a technical blocker, just not prioritized this pass) — would need a new upload path straight to Storage (bypassing the Collection/3D-generation flow entirely) plus a decision on whether removing such a card should also delete its now-orphaned Storage file, since (unlike an item card) nothing else references that image
- ⚠️ Delete via long-press — substituted with a click-to-remove (×) button (reasonable for web)
- ⚠️ Save Draft — no separate "save without publishing" action, but every edit autosaves regardless of publish state, so no work is ever lost (functionally superior, just not a literal match)

Implementation note on the four ✅ items above: with four simultaneous
gestures now sharing one card (move/rotate/resize/toggle), z-order needed a
mechanism that doesn't physically move the card's DOM node on
bring-to-front — the 3D display mode renders a live WebGL `<canvas>`
(`ModelViewer`, non-interactive variant), and browsers don't reliably
preserve a WebGL context across a node being detached/reattached elsewhere
in the DOM. `MoodboardCanvas.tsx` now keeps each card's DOM position fixed
(first-seen order) and expresses the actual bring-to-front stacking purely
as a CSS `zIndex` read off the card's live position in the `cards` array.

## 4.8 Public Moodboard View (Web)
- ✅ Read-only render, no login required
- ✅ Item cards expand to full detail + 3D viewer on tap (tap-vs-drag distance threshold in `MoodboardCanvas`, detail rendered from the card's own snapshot via `MoodboardCardDetailModal` — public view never reads the live `items` collection)
- ⚠️ "Download app" prompt — not shown (may not apply to a web-only test project; needs a scope decision)

## 4.9 Profile Screen
The PRD gives this screen no dedicated numbered section (unlike 4.1–4.8) —
the only mention anywhere in the document is one line in §5's file-structure
listing: `ProfileScreen.jsx  User profile and settings`. In the absence of a
concrete spec, the following was scoped out and confirmed with the user as a
reasonable "user profile and settings" set for `ProfilePage.tsx`:
- ✅ **Avatar upload** — click the avatar circle to pick a photo, uploaded to a fixed Storage path (`users/{uid}/avatar`, so re-uploading overwrites rather than accumulating orphaned files) via new `updateUserAvatar()` in `src/services/users.ts`; writes `photoURL` to the `users/{uid}` Firestore doc (the actual source of truth this app reads from) and best-effort mirrors it onto the Firebase Auth profile too. Client-side 5MB size guard. Falls back to an initials placeholder (from display name, or first letter of email) when no avatar is set. Also now shown next to the §4.2 welcome banner in `HomePage.tsx`
- ✅ **Edit display name** — inline edit (pencil → text input + Save/Cancel) via new `updateUserDisplayName()`, same Firestore-is-source-of-truth + best-effort Auth mirror pattern as avatar. Previously display name could only ever be set once, at registration, with no way to change it after
- ✅ **Account stats** — three small read-only cards: item count (`getItems(uid).length`), moodboard card count (`getOrCreateMoodboard(uid).cards.length` — there's only one moodboard per user in this data model), and "member since" (formatted from the profile doc's `createdAt`). Each fetched independently so one failing doesn't block the others or the rest of the page
- ✅ **Change password** — collapsible form (current password + new password + confirm), using `reauthenticateWithCredential` before `updatePassword` since Firebase Auth requires a *recent* sign-in for this and otherwise throws a cryptic `auth/requires-recent-login`
- ✅ Sign out (pre-existing)
- ✅ **Firestore/Storage security rules verified** — the live rules aren't checked into this repo (no `firebase.json`/`*.rules` files exist; they're managed only in the Firebase Console for project `idm2526-summer-project`), so they were audited by hand against every actual read/write call in the codebase rather than by reading a tracked rules file:
  - Firestore: `items/{itemId}` (owner-only read/update/delete via `resource.data.userId`, owner-only create via `request.resource.data.userId` — matches `items.ts`'s `getItems`/`updateItemMetadata`/`deleteItem`/`saveItem`), `moodboards/{moodboardId}` (read allowed if `published == true` **or** owner — correctly enforces the public `/m/:id` link server-side rather than relying on `getPublishedMoodboard`'s client-side `published` check alone; create/update/delete owner-only — matches `moodboard.ts`), `users/{uid}` (owner-only read/write — matches `users.ts`'s `setDoc`/`updateDoc` calls). No other Firestore collections exist in the codebase.
  - Storage: `items/{userId}/{allPaths=**}` (owner-only, covers every path `items.ts` writes: `photo-{i}-{name}`, `model.glb`, `sticker.png`) plus `users/{uid}/avatar` (owner-only — matches `users.ts`'s `updateUserAvatar`, which was initially missing from the rules and caused avatar uploads to fail under Storage's default-deny until added)
  - Optional hardening noted but not required for MVP: the Firestore `update` rules only check the *existing* `userId` matches the requester, not that the update itself preserves it — a user could in theory reassign one of their own docs' `userId` away from themselves. Not fixed this pass.

## 6. Data Model (Firestore)
- ✅ **`users` collection** (`uid`, `email`, `displayName`, `photoURL`, `createdAt`) — created in `src/services/users.ts`, keyed by `uid` (not `addDoc`); eagerly on registration (`LoginPage.tsx`) and lazily backfilled for accounts that predate this feature; `photoURL` optional, added for the new Profile Screen avatar feature (§4.9)
- ⚠️ Moodboard field naming diverges from PRD: `cards`/`published`/no persisted share URL vs. PRD's `elements`/`isPublished`/`shareUrl` — functionally equivalent, but `shareUrl` isn't stored server-side (computed client-side from `window.location.origin`)
- ❌ No `photo`-type Moodboard element (mirrors the §4.7 gap above)

## 7. API Integration
- ✅ **Automatic retry (up to 2x) on Tripo3D generation failure** — `generate3DModelWithRetry()` in `tripoClient.ts` (1 initial attempt + 2 automatic retries); each retry resubmits the same photos as a brand-new Tripo task and re-runs the full upload→poll cycle (there's no "retry this task" API). Skips retrying a `banned` result (content-policy rejection would just recur), but retries `failed`/`expired` results and thrown/network errors. UI shows "(retry 1/2)" etc. in `UploadPage.tsx` so the upload/progress bar restarting doesn't look like it silently glitched. The manual "Try again" button still exists for after all automatic retries are exhausted.

## 8. Phase 2 Roadmap (confirmed correctly out of scope)
Google/Apple Sign-In, Travel Map view, AR viewing, video/audio attachments,
advanced Moodboard editor (fonts/textures/rotation), push notifications,
Collection sharing, AI auto-tagging — none implemented, none should be yet.
No scope creep here. ✅
