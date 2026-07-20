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
- ❌ Confirm password field on register
- ❌ Forgot password (send reset email)

## 4.2 Home Screen
PRD treats this as a distinct dashboard/entry screen, separate from
Collection (4.6). Currently merged into `HomePage.tsx`, which is really the
Collection grid — none of Home's own dashboard content exists.
- ❌ Welcome message with user name (blocked on no `displayName`/`users` doc — see §6)
- ❌ Recent items rail (latest 4, horizontal scroll)
- ❌ "My Collections" list (PRD implies multiple named collections; current data model only has one flat `items` list per user)
- ⚠️ Add New Item CTA — exists as a bottom tab, not a Home-screen button (reasonable substitute)

## 4.3 Add Item Screen
- ✅ Photo capture (web file inputs for front/left/back/right, substituting native camera)
- ✅ Photo count indicator + validation (front required, 2+ minimum)
- ✅ Item info fields: name (required), type, location (with autocomplete — beyond PRD), date, story, emotion tags
- ❌ Retake a single photo in place (currently: re-choose file to overwrite)

## 4.4 Generate 3D Screen
- ✅ Uploading / Generating / Preview / Error states
- ✅ Save
- ❌ **Regenerate** from the Preview state (re-submit same photos without starting over) — only a "Try again" on failure exists, not on a successful-but-unsatisfying preview
- ⚠️ Cancel — no explicit cancel/back action from this flow

## 4.5 Item Detail Screen
- ✅ 3D viewer, name, type badge, location, date, story, emotion tags
- ❌ **Original photos, swipeable** — detail view doesn't render `item.photos` at all (only used for the list thumbnail)
- ✅ Edit / Delete (with confirmation)
- ❌ **"Add to Moodboard" action** from Item Detail — currently only addable the other way, from the Moodboard page's item picker strip

## 4.6 Collection Screen
- ⚠️ Grid view — present, but auto-fill layout rather than a strict 2-column grid
- ❌ **Search bar**
- ❌ **Filter tabs** (All / Tickets / Magnets / Postcards / Other)
- ❌ **Sort options** (by date / location / type) — hardcoded `createdAt desc`, no UI control

## 4.7 Moodboard Editor Screen
- ✅ Free-form drag-to-reposition canvas, Add Item, Add Text, Generate Link (Publish)
- ❌ **Scrollable/zoomable canvas** — fixed-aspect-ratio box, no pan/zoom
- ❌ **Background color picker**
- ❌ **Pinch/resize handles** on elements (explicitly deferred in code comments)
- ❌ **Add Photo** as a standalone element type (camera-roll photo not tied to a saved item) — `MoodboardCard.type` only supports `'item' | 'text'`, no `'photo'`
- ⚠️ Delete via long-press — substituted with a click-to-remove (×) button (reasonable for web)
- ⚠️ Save Draft — no separate "save without publishing" action, but every edit autosaves regardless of publish state, so no work is ever lost (functionally superior, just not a literal match)

## 4.8 Public Moodboard View (Web)
- ✅ Read-only render, no login required
- ✅ Item cards expand to full detail + 3D viewer on tap (tap-vs-drag distance threshold in `MoodboardCanvas`, detail rendered from the card's own snapshot via `MoodboardCardDetailModal` — public view never reads the live `items` collection)
- ⚠️ "Download app" prompt — not shown (may not apply to a web-only test project; needs a scope decision)

## 6. Data Model (Firestore)
- ❌ **`users` collection** (`uid`, `email`, `displayName`, `createdAt`) — not created anywhere; root cause of the missing "welcome, {name}" in §4.2
- ⚠️ Moodboard field naming diverges from PRD: `cards`/`published`/no persisted share URL vs. PRD's `elements`/`isPublished`/`shareUrl` — functionally equivalent, but `shareUrl` isn't stored server-side (computed client-side from `window.location.origin`)
- ❌ No `photo`-type Moodboard element (mirrors the §4.7 gap above)

## 7. API Integration
- ❌ **Automatic retry (up to 2x) on Tripo3D generation failure** — no retry logic in `server/index.js` or `tripoClient.ts`; only a manual "Try again" button

## 8. Phase 2 Roadmap (confirmed correctly out of scope)
Google/Apple Sign-In, Travel Map view, AR viewing, video/audio attachments,
advanced Moodboard editor (fonts/textures/rotation), push notifications,
Collection sharing, AI auto-tagging — none implemented, none should be yet.
No scope creep here. ✅
