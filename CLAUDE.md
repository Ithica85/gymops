# GymOps

## Project Overview

GymOps is a mobile-first gym workout logger deployed as a PWA on Vercel (gymops-two.vercel.app). It is a personal tool in active real-use testing.

## Tech Stack & Constraints

- **Vanilla HTML/CSS/JS only.** No frameworks (React, Vue), no build tools (webpack, vite), no bundlers. JS files are native ES modules (`<script type="module">`, real import/export) — `lib/sql-wasm.js` stays a classic script providing the `initSqlJs` global.
- **SQLite via sql.js** persisted to IndexedDB as raw bytes (since 5.4; js/storage.js), with transparent fallback to the legacy base64-in-localStorage path when IDB is unavailable (old browsers, some private modes, the Node test environment). The sql.js library is vendored in `/lib`.
- **No runtime npm dependencies** beyond sql.js (vendored in `/lib`). Test-only devDependencies are allowed (Vitest) — nothing in `node_modules` ships to the browser. `npm test` runs the suite in `tests/`.
- **PWA** with service worker (`sw.js`) and `manifest.json`.
- **Dark theme** using CSS custom properties defined in `:root` in `css/style.css`.
- **Mobile-first** — design target is 375px width. All content on the active workout screen must remain above the fold.
- **Single page** with five screens: idle, active, completed, settings, plans, plan-editor, plus modals.
- **Vercel serverless function** at `api/ai-summary.js` proxies Anthropic API calls (avoids CORS). No other backend.

## File Map

- `index.html` — Single-page structure with all screens (idle, active, completed, settings, plans, plan-editor, history, exercise-history), exercise picker modal, session-signal modal, AI summary modal, plan expiry banner, and up-next hint.
- `js/app.js` — Entry point ONLY: `boot()` (initDB + all event-listener wiring) and the Layer 1 / Layer 2 decision comment. All feature logic lives in the modules below (split July 2026; app.js imports them, index.html loads only app.js).
- `js/state.js` — Shared `state` object, `APP_VERSION`, `EXERCISES` catalogue (114 entries, `{ name, type, muscleGroup }`; `type` is `"reps"`/`"timed"`, groups per `MUSCLE_GROUPS`), `getExerciseType()` / `getExerciseGroup()`, `getWeightUnit()` / `convertWeight()`, shared constants. Legacy exercise names must never change (history references them); `EXERCISES[0]` is the boot placeholder + last-resort fallback (no longer the plan-less default since 5.3); both rules are test-guarded.
- `js/ui.js` — `showScreen()` + `onScreenShow(name, fn)` hook registry (screens register their own render-on-show), `showToast()` (currently no callers), `downloadCSV()`.
- `js/workout.js` — **Layer 1**: session lifecycle (`startSession`/`_doStartSession`/`resumeSession`/`finishWorkout`/`resumeLastWorkout`), `setActiveExercise()` (the ONLY exercise/setNumber mutation point), `logSet`/`_afterSetLogged`, quick-log, `undoSet`, rest + session + inactivity timers (`initInactivityWatchdog()`), notes autosave, Drive upload status chain, PR celebration, active-screen renders, `computeUpNext`, `triggerExport`.
- `js/picker.js` — Exercise picker bottom sheet: session + plan-editor modes (`openPicker`/`openPickerForPlan`), search (`setPickerQuery`, never autofocused), muscle-group chips (`setPickerGroup`, generated from `MUSCLE_GROUPS`), sectioned catalogue below the Recent block, MRU/A–Z sort (`setPickerSort`), custom "Other" exercise flow.
- `js/signals.js` — Deterministic rule engines: `computeProgressionSignal` (F-03), `computeSessionSignal` (F-06), and their renderers.
- `js/idle.js` — Idle dashboard (week strip, hook line, plan line), `IDLE_BANNERS` mediator + `checkIdleBanners()`, smart session reminder (F-04) incl. `computeTrainingWindow`.
- `js/plans.js` — Plan banners (`computePlanExpiryBanner`/`computePlanNudge`/`computePlanNudgeBanner`), plans screen, plan editor, `renderPlanAdherence`.
- `js/history.js` — History list + per-exercise detail screens, inline SVG progression chart with crosshair tooltip.
- `js/settings.js` — `setWeightUnit`, Anthropic API key storage, `openExportRangeModal`.
- `js/ai.js` — `_buildSessionContext()` / `generateAISummary()` (calls `/api/ai-summary`).
- `js/gdrive.js` — Google Drive integration. Uploads per-session data as a Google Sheet (auto-converted from CSV) to `GymOps/Gym Session Data/YYYY-MM/` in the user's Drive. `GOOGLE_CLIENT_ID` is configured. Files named `gym_YYYY_MM_DD` with numeric suffix for same-day duplicates. One-time migration moves legacy root-level files to the correct month folders (guarded by `gymops_gdrive_migrated` localStorage flag).
- `js/storage.js` — IndexedDB blob store (5.4): one object store, promise API (`storageInit`/`blobGet`/`blobPut`/`blobDelete`/`blobKeys`), dependency-free (no app imports). db.js is the only consumer. `storageInit()` returning false switches db.js to the legacy localStorage path.
- `js/db.js` — SQLite schema, CRUD operations, CSV export query. Phase 2 additions: `dbCreateSession(defaultUnit)`; `dbInsertSet(..., unit)`; queries for F-03/F-04/F-05/F-06. Phase 2.1 additions: `dbDeleteSession(sessionId)`; `dbExportCSVByRange(from, to)`; `dbGetExerciseRecency()`. Phase 3 additions: `dbCreatePlan()` / `dbUpdatePlan()` / `dbUpdatePlanStatus()` / `dbGetActivePlan()` / `dbGetPlan()` / `dbGetAllPlans()` / `dbGetPlanExercises()` / `dbSavePlanExercises()` / `dbLinkSessionToPlan()` / `dbGetSessionPlan()`; `dbGetExercisesWithHistory()` / `dbGetExerciseSessionHistory()` (exercise history).
- `api/ai-summary.js` — Vercel serverless function. Proxies POST requests to the Anthropic API (`claude-fable-5`, fallback `claude-opus-4-8`). Accepts `{ context, apiKey }` in the body; API key falls back to `ANTHROPIC_API_KEY` env var. Returns `{ text }` or `{ error }`.
- `css/style.css` — Full styling. Dark theme tokens in `:root`. Mobile-first responsive.
- `sw.js` — Service worker for PWA caching.
- `manifest.json` — PWA manifest.
- `lib/` — Vendored sql.js (sql-wasm.js + sql-wasm.wasm).
- `docs/` — Planning documents (not app assets, not SW-cached): `PHASE4_CONSUMER_PLAN.md` (phase structure + success criteria for the consumer-product turn), `REVIEW_RESPONSE.md` (verdict + disposition for every external-review finding, IDs C1–P11).

## Database Schema

```sql
exercises (                          -- added Phase 5.1: stable exercise identity
  exercise_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE, -- display name (denormalised copies on sets/plan_exercises stay in sync)
  type         TEXT NOT NULL DEFAULT 'reps',  -- 'reps' | 'timed'
  muscle_group TEXT,                 -- per MUSCLE_GROUPS; null for custom
  is_custom    INTEGER NOT NULL DEFAULT 0     -- 1 = created via the "Other" flow
)

sessions (
  session_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time    TEXT NOT NULL,
  end_time      TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  notes         TEXT,              -- added via ALTER TABLE migration (Phase 1)
  default_unit  TEXT,              -- 'kg' or 'lbs' at session start (added Phase 2 F-02)
  plan_id       INTEGER            -- FK to plans (added Phase 3, nullable)
)

sets (
  set_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL,
  timestamp     TEXT NOT NULL,
  exercise      TEXT NOT NULL,
  set_number    INTEGER NOT NULL,
  weight        REAL,              -- null for timed exercises
  reps          INTEGER,           -- null for timed exercises
  duration_mins REAL,              -- null for reps exercises
  calories      INTEGER,           -- null for reps exercises, optional for timed
  unit          TEXT NOT NULL DEFAULT 'lbs',  -- unit at log time (added Phase 2 F-02)
  exercise_id   INTEGER,           -- FK to exercises (added Phase 5.1, backfilled by _syncExercises)
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
)

plans (
  plan_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  start_date     TEXT NOT NULL,    -- ISO date (YYYY-MM-DD)
  duration_weeks INTEGER,          -- null = ongoing
  objectives_json TEXT,            -- JSON array of objective strings, or null
  status         TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'archived'
  target_sessions_per_week INTEGER -- null = no weekly target (added Phase 3 v3.5, nudges)
)

plan_exercises (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id     INTEGER NOT NULL,
  exercise    TEXT NOT NULL,
  target_sets INTEGER,
  target_reps INTEGER,
  sort_order  INTEGER NOT NULL,
  exercise_id INTEGER,             -- FK to exercises (added Phase 5.1)
  FOREIGN KEY (plan_id) REFERENCES plans(plan_id)
)
```

A set row must have EITHER (weight + reps) OR (duration_mins), never both, never neither.
Only one plan should have `status = 'active'` at a time — `savePlan()` archives any existing active plan before creating a new one.

All weight comparisons across sessions (progression signal, session signal) normalise to kg internally via SQL `CASE` expressions to handle mixed-unit history correctly.

**IMPORTANT:** Schema changes must use a full table migration (create new, copy, drop old, rename) — never just DROP/CREATE which would lose data. See `_migrate()` in `js/db.js` for the established pattern. Nullable column additions may use `ALTER TABLE ... ADD COLUMN` (see `notes` column). Existing user data in localStorage must always be preserved.

**IMPORTANT:** Every schema change must be made in BOTH `_createSchema()` (fresh installs) and `_migrate()` (existing databases). The Phase 3 `plan_id` column was added only to `_migrate()`, which broke fresh installs until fixed in v3.2.

## Design Language

- Background: `#0d0d0d`, surfaces: `#181818` / `#222222`, accent: `#c8ff57` (lime), danger: `#ff4040`.
- Border radius: 14px. Font: system stack (-apple-system, etc).
- Modals use bottom-sheet pattern with backdrop overlay (see exercise picker for reference).
- Buttons follow `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-text` patterns.

## After Any Change

0. Run `npm test` (Vitest — db.js write paths and pure-logic tests).
1. Test at 375px width in Chrome DevTools mobile view.
2. Verify existing session/sets data is not corrupted (load app with pre-existing localStorage data).
3. Update the service worker cache version in `sw.js` if any cached files changed. Current version: `gymops-v85`. New JS files must be added to the `ASSETS` list in `sw.js` or offline mode breaks.
5. User-entered text (plan names, objectives, custom exercise names) must go through `escapeHTML()` (js/ui.js) when interpolated into `innerHTML` — or better, use `textContent`/DOM APIs like history.js. `dbClearAll()` wipes ALL `gymops_*` localStorage keys (credentials included) AND the whole IDB blob store, not just the DB. Since 5.4 the DB lives in IndexedDB as raw bytes; a pre-5.4 install's base64 localStorage blob (or pre-v62 JSON-array blob) is adopted into IDB on first boot and the localStorage copy stays FROZEN in place as a rollback snapshot (`gymops_idb_migrated` marker prevents it from ever being re-adopted — deleting that marker on a device with data in IDB would fork history).
4. Verify CSV export still works and includes any new columns.

---

# Current Phase

**Phase 5 — Identity & Program Model** (started July 16, 2026)

Theme: make the data model able to survive years and fit real training. Items: 5.1 stable exercise IDs · 5.2 multi-day program model · 5.2.x user-feedback batch · 5.3 session start chooser · 5.4 storage backend migration (IndexedDB/OPFS) · 5.5 plan adherence rework · 5.6 quick-log prominence design pass. Success criteria in `docs/PHASE4_CONSUMER_PLAN.md`.

## Phase 5 Status
🚧 **IN PROGRESS**
- [x] **5.5 Plan adherence rework** — BUILT July 22, 2026 (SW cache: `gymops-v87`, app: `v5.10`; pending commit/deploy). Adherence measured against the day trained, at two zoom levels. **Completed screen** (`computeSessionAdherence` in plans.js — pure compute exported for tests + `renderPlanAdherence` formatting): 3 lines via `white-space: pre-line` — "{plan} · {day} — Week N of M" (day label only for multi-day plans; single-day "Day 1" suppressed as an implementation detail) / "{done}/{total} exercises · {setsDone}/{setsPlanned} planned sets" (set counts capped per exercise so overshooting Bench can't mask skipping Dips; sets clause omitted when no exercise has a target) / "Skipped: …". **Plans screen** (`_renderWeekRow`): "This week" day chips (multi-day only, `.plan-week-chip--done` accent for days with a completed session this week, via new read-only `dbGetCompletedDayIdsSince(planId, sinceISO)`) + "N of {target} sessions this week" (target-less plans show a plain count; sessions count = ALL completed sessions, matching nudge/week-strip semantics). 6 new tests in tests/adherence.test.js (146 total); 7-check CDP click-through (plan seeded via the 5.4 LS→IDB adoption path — doubles as an adoption regression test).
- [x] **5.4 Storage backend migration → IndexedDB** — SHIPPED July 22, 2026 (SW cache: `gymops-v86`, app: `v5.9`, commit `9fb4662`; 9-check CDP e2e re-run against the LIVE deploy, all green). New `js/storage.js` (IDB blob store, raw Uint8Array — no base64 inflation; `navigator.storage.persist()` requested). db.js: `_useIDB` mode set per boot by `storageInit()`; **false → the entire pre-5.4 localStorage path runs unchanged (also the default test path — Node has no IDB)**. One-time adoption on first IDB boot: LS blob decoded → IDB; LS copy stays frozen as rollback snapshot; `gymops_idb_migrated` marker prevents re-adoption (without it, recovery-screen Start Fresh would resurrect the stale snapshot). `_persistIDB()`: async, coalescing (in-flight put + dirty flag), drives the same 4.4 failure/recovery listener; `_idbSettle()` awaited by initDB/discard/restore/clearAll so a trailing persist can't race a wipe (settle must run BEFORE dbClearAll's key sweep — the persist success callback re-sets the marker). If the IDB read itself fails at boot, db.js falls back to LS mode rather than risk blind-writing over an unreadable store. Quarantine/prerestore live in IDB in IDB mode (recovery download re-encoded base64 so dbValidateBackup round-trips); backup file format unchanged. `dbDiscardCorrupt`/`dbRestoreBackup`/`dbClearAll` now async — call sites await before `location.reload()`. 9 new tests in tests/idb.test.js (fake-indexeddb devDep, incl. real LS→IDB adoption + marker + persist-failure recovery; 140 total). 9-check CDP e2e in real Chrome: legacy adoption, frozen snapshot, IDB-only writes, reload persistence, LS-copy deletion survival, fresh install, Clear All.
- [x] **5.2.x User-feedback batch** — COMPLETE (July 21, 2026, shipped as four releases v5.2–v5.5 / gymops-v79–v82). Five small fixes from real-use feedback (July 15 + 18, 2026; quick-log feedback reported twice):
  1. ✅ **Quick-log tap feedback** — SHIPPED (July 21, 2026, SW cache: `gymops-v79`, app: `v5.2`). `quickLogSet()`: 600ms tap guard (`QUICK_LOG_GUARD_MS` — absorbs "did that work?" re-taps, the duplicate-set killer), haptic (`navigator.vibrate(30)`), inline "✓ Logged — {value}" for 1200ms (`_showQuickLogConfirm`; `renderQuickLog` skips repaints while the window is live so `renderActive` can't stomp it; guard state reset on session start/resume). CSS `.quick-log-confirm` (accent ring + background flash keyframe, reduced-motion safe) + stronger `:active`. 3 new tests (118 total); CDP-verified at 375px (triple-tap → exactly one set). **CDP harness note: screens toggle via `.active` class, NOT `.hidden` — `#screen-X:not(.hidden)` waits are vacuously true.**
  2. ✅ **Kill Save-password prompt** — SHIPPED (July 21, 2026, SW cache: `gymops-v80`, app: `v5.3`). `#input-anthropic-key` switched `type="password"` → `type="text"` (password managers ignore text inputs entirely — more reliable than `autocomplete="new-password"`); masking via `-webkit-text-security: disc` on `.ai-key-input` (Chrome + Safari, the deploy targets); `autocapitalize="off"` added. Blur-save + reload round-trip CDP-verified.
  3. ✅ **Rest bar vs session log** — SHIPPED with #4 (July 21, 2026, SW cache: `gymops-v81`, app: `v5.4`). Bar compacted to one 40px row (padding 10px→5px, countdown 1.4rem→1.1rem). Sticky was moot: `.sets-log` is the internal scroller (`flex:1; overflow-y:auto` inside the 100dvh screen column) — the bar never scrolls away, it just ate log height.
  4. ✅ **In-session rest duration adjust** — SHIPPED with #3. `−30`/`+30` chips (`.rest-adjust`) on the bar; `adjustRestTimer(deltaSecs)` in workout.js is a one-off nudge to the RUNNING countdown only (stored preference untouched — Settings owns the default); below-zero completes via the normal `_tickRest` done path (beep); no-op while not running or during the 2s "Done!" linger. 3 tests (121 total); CDP-verified.
  5. ✅ **lbs↔kg inline converter** — SHIPPED (July 21, 2026, SW cache: `gymops-v82`, app: `v5.5`). `#weight-convert` helper under the input row ("60 kg = 132.3 lbs"); `renderWeightConversion()` in workout.js — re-run on input event (app.js), `clearInputs`, and `updateInputFields` (exercise change); hidden for timed exercises, empty/non-numeric/≤0 values; comma decimals normalised like logSet. Display-only — data layer untouched. 3 tests (124 total); CDP-verified both directions.
- [x] **5.3 Session start chooser** — SHIPPED (July 21, 2026, SW cache: `gymops-v83`, app: `v5.6`). The choice happens BEFORE the session exists — no null-exercise state, cancel creates nothing. `beginSessionFlow(dayId?)` in workout.js is the entry decision (startSession + discard-confirm both route through it): active plan with exercises → `_doStartSession({ dayId })` immediately; otherwise `openPickerForStart()` (new `'start'` picker context, titled "First Exercise"; selection/Other-flow call `_doStartSession({ exercise, type })` — picker↔workout import cycle already existed). `_doStartSession` now takes `{ exercise, type, dayId }`; `EXERCISES[0]` demoted to last-resort fallback (empty plan day) — catalogue guard test + state.js RULES comment updated. Multi-day idle: Start button reads "Start — {day}" (`renderStartControls` in idle.js, hidden while a resumable session exists) + "Train a different day…" link → `openDaySwitchForStart()` (reuses `#day-switch-modal`, rotated day highlighted, defers to the discard guard). Zero-set resume prefers the session's plan-day first exercise. 4 tests (128 total); 11-check CDP click-through incl. plan built through the editor UI.
- [x] **5.6 Quick-log prominence design pass** — SHIPPED July 22, 2026 (SW cache: `gymops-v84`, app: `v5.7`, commit `4d6045e`, verified live). Design chosen: **full flip — hierarchy follows intent.** With a quick-log reference, the quick-log button is the lime hero ABOVE the inputs and Log Set demotes to secondary (`.btn-primary.btn-demoted`); manual intent (either input focused or non-empty) re-promotes Log Set and drops quick-log to `.quick-log-quiet`; no reference → exactly the old screen. `updateLogEmphasis()` in workout.js (called from renderQuickLog incl. the confirm-window early-return, `_showQuickLogConfirm`, and input focus/blur/input events wired in app.js); `_manualIntent()` reads focus + values. Emphasis swaps are COLOR-ONLY (identical padding both states) so buttons never move under a mid-tap finger. **Key consequence: `setActiveExercise`/`undoSet` now use `focusInputUnlessHero()`** — auto-focusing the weight input on exercise entry would count as manual intent and instantly demote the hero (and pop the keyboard quick-log exists to avoid); logSet's own validation/refocus paths still focus unconditionally. Confirm flash reworked white→lime for the filled button. 3 new tests (131 total); 10-check CDP click-through at 375×667 incl. both-state screenshots. **CDP harness gotchas: re-runs after code edits MUST unregister the SW + clear CacheStorage (first run caches the pre-edit files under the current cache name); focus assertions need `Emulation.setFocusEmulationEnabled`.**
- [x] **5.2 Multi-day program model** — SHIPPED (July 18, 2026, SW cache: `gymops-v78`, app: `v5.1`, commit `d20158f`, verified live). New `plan_days` table (day_id, plan_id, name, sort_order); nullable `day_id` on `plan_exercises` and `sessions`. **Uniform model: every plan has ≥1 day** — migration creates one "Day 1" per existing plan and stamps its exercises; historical sessions keep `day_id NULL` (whole-plan fallback). `dbGetSessionPlan` is the single day-scoping point (`{ ...plan, day, exercises }` — day-scoped when the session has a live day): picker "Today's Plan — {day}", `computeUpNext`, completed-screen adherence, and AI context all became day-aware through it. Session start rotates via `dbGetNextPlanDay` (day after the last completed session's day, cyclic; first day otherwise); idle plan line shows "Next: {day}". Escape hatch: `#active-day-chip` (multi-day plans only) → `#day-switch-modal` → `dbUpdateSessionDay` — seed of the 5.3 chooser. Editor: stacked `.plan-day-section` cards (`_editingDays` in plans.js); per-day "+ Add Exercise" delegated from app.js (`#plan-days-list` listener) to keep picker↔plans acyclic; duplicate check per-day; `dbSavePlanExercises(planId, days)` **upserts days by dayId** (sessions reference day rows — a plan edit must not re-mint surviving day IDs; dropped days delete, sessions pointing at them fall back to whole-plan). 12 new tests (tests/plan-days.test.js + 2 workout integration); 21-check CDP click-through incl. in-browser pre-5.2 migration.
- [x] **5.1 Stable exercise IDs** — SHIPPED (July 16, 2026, SW cache: `gymops-v77`, app: `v5.0`). New `exercises` table (see schema); nullable `exercise_id` on `sets` and `plan_exercises`. `_syncExercises()` runs every boot (idempotent, no-writes-when-clean): seeds catalogue rows (new EXERCISES entries auto-adopt), adopts historical custom names as `is_custom` rows (type inferred from data — a row with duration is timed; plan-only names use `getExerciseType`), backfills missing IDs. **Ordering matters: catalogue seeding must precede orphan adoption or historical catalogue names duplicate (UNIQUE violation → quarantine).** Write paths stamp IDs: `dbInsertSet` (via `_exerciseId(name, type)`, creates is_custom rows on first sight), `dbSavePlanExercises`. `dbRenameExercise(id, name)` updates the identity row + denormalised name copies on sets/plan_exercises atomically — history can't orphan; ID never changes. Queries stay name-based (names stay consistent) — deliberate: identity is additive, not a big-bang rewrite. No rename UI yet (later in Phase 5). `dbGetExercise`/`dbGetAllExercises` exported. 10 tests in tests/exercises.test.js incl. real pre-5.1-blob migration; CDP-verified against a legacy DB in the browser (history, plan, ghost text, logging all intact). db.js now imports from state.js (EXERCISES, getExerciseType) — state.js must stay import-free to avoid cycles.

---

**Phase 4 — Trust & Correctness** (started July 14, 2026)

The consumer-product turn. Full phase structure (Phases 4–7) and per-phase success criteria: `docs/PHASE4_CONSUMER_PLAN.md`. Itemized disposition of every external-review finding: `docs/REVIEW_RESPONSE.md`. Standing frame: consumer-grade quality bar on a personal-first product; north star is **"the fastest logger that never loses your history"**; no monetization planned (option preserved via architecture — stable exercise IDs, real backup/restore, no deeper BYOK coupling); staying PWA + vanilla.

## Phase 4 Status
✅ **COMPLETE** (July 16, 2026, SW cache: `gymops-v76`, app: `v4.7`) — all 9 items shipped, all 6 success criteria met (see `docs/PHASE4_CONSUMER_PLAN.md`). Next: Phase 5 — Identity & Program Model.
- [x] **4.1 Corrupt-DB quarantine + recovery UI** — SHIPPED (July 15, 2026, SW cache: `gymops-v68`, app: `v4.0`). `initDB()` never silently wipes: on decode/migrate failure the original blob is quarantined to `gymops_db_corrupt_<ts>` (deduped across reloads, quota-tolerant), `gymops_db` is left in place so every reload returns to `#screen-recovery` (download backup file / Start Fresh with confirm modal). `dbDiscardCorrupt()` drops only the unreadable blob; quarantine copies survive Start Fresh and are removed only by Clear All Data. `downloadFile()` extracted in ui.js (downloadCSV delegates). 6 regression tests in tests/db.test.js.
- [x] **4.2 `undoSet` scope fix** — SHIPPED (July 15, 2026, SW cache: `gymops-v69`, app: `v4.1`). `dbDeleteLastSet(sessionId, exercise)` is now scoped to one exercise; `undoSet()` passes `state.exercise`, so Undo can never delete a set belonging to an exercise logged later in the session (review #C5). setNumber always resynced after undo. Regression tests in tests/db.test.js; no-sets → open-picker behaviour unchanged.
- [x] **4.3 Full DB backup & restore** — SHIPPED (July 15, 2026, SW cache: `gymops-v70`, app: `v4.2`). Settings → Backup section: "Back Up All Data" downloads a format-1 JSON envelope (`{app, format, exported_at, db}` — base64 DB via `dbExportBackup()`); "Restore from Backup…" validates the file in a throwaway sql.js instance (`dbValidateBackup()` — accepts the envelope OR a bare blob from the 4.1 recovery screen, never touches the live DB), shows a confirm bottom sheet with session/set counts + last-workout date, then `dbRestoreBackup()` stashes the current DB to `gymops_db_prerestore` (one slot, quota-tolerant) before swapping the blob and reloading (initDB migrates old-schema backups). Backup deliberately excludes other `gymops_*` keys (no credentials in shareable files). 6 tests in tests/db.test.js incl. full export→wipe→restore round-trip.
- [x] **4.4 `_persist()` failure handling** — SHIPPED (July 16, 2026, SW cache: `gymops-v71`, app: `v4.3`). `_persist()` no longer throws on a localStorage quota failure: the write has already applied to the in-memory DB, so the session keeps working and every subsequent write retries the persist. `dbOnPersistStateChange(fn)` notifies the UI on state *changes* only (failed → recovered); app.js toggles `#persist-error-banner` — a fixed top banner (z-index 150, below modals) with a "Back Up Now" button that reuses 4.3's `downloadBackup()` (exports the in-memory DB, works while storage is full). Banner clears automatically when a later persist succeeds. 5 tests in tests/db.test.js (tests/setup.js localStorage stub methods now writable so tests can simulate quota failure).
- [x] **4.5 Decimal-friendly weight input** — SHIPPED (July 16, 2026, SW cache: `gymops-v72`, app: `v4.4`). `#input-weight` (also the duration field for timed exercises) is now `inputmode="decimal"`; the legacy `pattern="[0-9]*"` dropped from both inputs (`#input-reps` stays `inputmode="numeric"` — reps/calories are integers). 62.5 kg is typeable on iOS. `logSet()` normalises comma decimals (`62,5` → `62.5`) since comma-locale iOS keypads emit the locale separator and `parseFloat` would silently truncate. Parsing was already `parseFloat` — data layer unchanged.
- [x] **4.6 Auto-start rest timer on log** — SHIPPED (July 16, 2026, SW cache: `gymops-v74`, app: `v4.5`). `_afterSetLogged()` calls `startRestTimer()` after every logged set (logSet AND quickLogSet) for reps exercises only — timed/cardio never auto-starts. Skip dismisses; manual Rest button unchanged; logging the next set restarts the countdown (startRestTimer resets any running timer). A running rest deliberately survives an exercise switch. Configurable duration deferred to 4.9/Phase 5.
- [x] **4.7 Pinch-zoom enabled** — SHIPPED (July 16, 2026, SW cache: `gymops-v75`, app: `v4.6`). `maximum-scale=1.0, user-scalable=no` removed from the viewport meta (accessibility baseline). Sub-16px inputs bumped to 1rem so unlocking zoom doesn't trigger iOS focus auto-zoom: `.export-date-input`, `.notes-input`, `.ai-key-input`, `.plan-target-input`.
- [x] **4.8 Layer 1 integration tests** — SHIPPED (July 16, 2026, tests-only). `tests/workout.test.js`: 16 integration tests driving js/workout.js against a real in-memory sql.js DB through the stub DOM — start/log/finish, startSession discard guard, validation (incl. zero weight + comma decimals), timed-exercise columns, undo scope + undo→picker, finish→resume (exercise-at-finish restore, 60-min window via fake timers), quick-log, PR-never-blocks-logging, beforeSessionId guard, rest-timer auto-start, notes flush. Fake timers installed AFTER initDB (sql.js needs real timers); stub DOM gained `style.setProperty` + `click` (tests/setup.js).
- [x] **4.9 Debt batch** — SHIPPED (July 16, 2026, SW cache: `gymops-v76`, app: `v4.7`). (1) One shared lazy `AudioContext` (`_getAudioCtx()` in workout.js, resumes if suspended) — beepAlert and _prFanfare no longer leak a context per sound. (2) Weight-display dedup: `setDisplayWeight(set, unit)` (the `unit || 'lbs'` legacy-row fallback) + `fmtTimedSet(set)` helpers in workout.js. (3) `showToast` wired: backup download + ranged CSV export confirmations. (4) `localDateStr()` in state.js replaces every `toISOString().slice(0,10)` — filenames (session CSV, ranged CSV, backup, recovery blob), export-modal date defaults, and `plans.start_date` now use the LOCAL calendar day. (5) Configurable rest duration: Settings → Rest Timer (1:00/1:30/2:00/3:00, `gymops_rest_secs`, default 90); `startRestTimer()` reads `getRestSecs()` per start. 3 new tests (95 total).

## Phase 3 Status
✅ **COMPLETE** (July 13, 2026, SW cache: `gymops-v67`, app: `v3.7`) — AI summary, plans, exercise history, quick-log, idle dashboard, PR celebration, plan nudges (v3.0–v3.5); 114-exercise muscle-grouped catalogue + picker search/chips/sections (v3.6); weekly muscle-coverage chips (v3.7). Unshipped Phase 3 backlog items re-queued behind Phases 4–6.

## Phase 2.1 Status
✅ **COMPLETE** (May 19, 2026, SW cache: `gymops-v45`, app: `v2.1`)

## Phase 2 Status
✅ **COMPLETE** (May 17, 2026, SW cache: `gymops-v36`, app: `v2.0`)

## Phase 1 Status
✅ **COMPLETE & LOCKED** (May 10, 2026, tag: `v1.0-phase1-complete`)

All Phase 1 features are stable in production. No new Phase 1 features will ship. Bug fixes only if critical.

---

# Shipped Features (Phase 1.1 + 1.2 + post-1.2 + Phase 1.3)

All Phase 1 work complete as of commit `104f752`. See git tag `v1.0-phase1-complete` for the exact Phase 1 release state.

## Phase 1.1 (all complete)
- **P1.1-04** — Split weight/reps into two side-by-side numeric inputs
- **P1.1-01** — Timed exercises (Elliptical, Stairmaster) with duration_mins/calories columns
- **P1.1-02** — PREV display clarified; "Set N: 45×8" format
- **P1.1-06** — Last session performance shown below PREV (ghost-text in placeholders)
- **P1.1-05** — "Other" exercise with free-text name prompt
- **P1.1-03** — Finish confirmation modal + 60-min resume from completed screen
- **P1.1-07** — 30-min inactivity timeout with "Still working out?" modal
- **P1.1-08** — Auto-upload to Google Drive on session finish (js/gdrive.js)

## Phase 1.2 / post-1.1 stories (all complete)
- **P1.2-01** — Settings screen with "Clear All Data" (destructive, confirmation required)
- **Session notes** — Free-text notes field on the completed screen; stored in `sessions.notes`; included in CSV export
- **Ghost-text PREV** — Previous set's weight/reps pre-fill as placeholder text in the input fields (matched by set_number via `dbGetLastSessionSetsForExercise`)
- **Full session log** — Sets log on the active screen shows ALL sets for the session (via `dbGetAllSets`), not just the last 5
- **US-02** — Finish modal dismiss restores previously selected exercise; Resume Last Workout also restores the exercise active at Finish time (not just the last logged set)
- **US-01** — Elapsed session timer (MM:SS / H:MM:SS) displayed in the stat row on the active screen; starts from session `start_time` so resume shows full elapsed time
- **Tech task** — Inline code comments added across `js/app.js`, `js/db.js`, `js/gdrive.js` covering non-obvious logic, gotchas, and design decisions

## Post-1.2 stories (all complete)
- **US-001** — Zero weight accepted as valid for bodyweight/mobility exercises; validation rejects blank/null but allows 0 (`app.js:434`: `weight <= 0` → `weight < 0`)

## Phase 1.3 (all complete)
- **US-003** — App version displayed at bottom of Settings screen; hardcoded `APP_VERSION` constant in `app.js`, set on boot. Current value: `v3.5`
- **US-004** — Delete a set from the active session log; trash button per row, inline confirmation, set re-sequences after deletion, `state.setNumber` kept in sync; `dbDeleteSetById` + `dbResequenceSets` in `db.js`
- **US-005** — Rest timer between sets (90s countdown); appears after first set logged, beep + vibrate on complete, Skip to dismiss early; lives entirely in UI state
- **Bug fix** — Inactivity timeout now fires correctly when tab is backgrounded; `visibilitychange` listener checks real wall-clock elapsed time against `_lastActivityTime` to bypass browser timer throttling
- **US-006** — Visible "Log Set" button (full-width, lime, above action row); Enter key behaviour preserved
- **US-007** — Timed exercise input labels: "Duration (mins)" / "Calories" for timed, "Weight (unit)" / "Reps" for reps; placeholders updated to match
- **US-008** — Weight unit preference (kg/lbs) in Settings; stored in localStorage (`gymops_weight_unit`); updates label and placeholder immediately; no conversion applied
- **US-002** — Cardio keyword auto-detection for "Other" exercises (treadmill, bike, rower, elliptical, stairmaster → timed); unknown names prompt "Strength or Cardio?"; Cancel and ← Back navigation at both steps
- **US-003b** — Undo opens exercise picker when no sets logged for current exercise; existing delete-last-set behaviour preserved when sets exist

---

# Shipped Features — Phase 2

**Phase Goal:** Increase session start rate and completion rate. All features shipped May 14–17, 2026.

## Foundation Track

- [x] **F-01: Rest Timer Bug Fix** — SHIPPED & STABLE (May 14, 2026)
  - Timestamp-based elapsed time (`_restEndTime`) replaces setInterval counter
  - `visibilitychange` listener resyncs display on foreground; accurate after background/lock
  - SW cache: gymops-v31

- [x] **F-02: lbs/kg Data Layer Fix** — SHIPPED & STABLE (May 14, 2026)
  - `sets.unit` (TEXT NOT NULL DEFAULT 'lbs') — unit stored at log time per set
  - `sessions.default_unit` (TEXT) — unit preference recorded at session start
  - Migration: ALTER TABLE for both columns; existing rows stamped 'lbs' via DEFAULT
  - `convertWeight()` in app.js for lbs↔kg conversion (1 decimal rounding)
  - Caveat: Settings (unit toggle) is idle-only — mid-session unit switch is future enhancement
  - SW cache: gymops-v32

## Habit Reinforcement Track

- [x] **F-03: In-Session Progression Signal** — SHIPPED & STABLE (May 14, 2026)
  - Deterministic 4-priority rule engine in `computeProgressionSignal()` (app.js)
  - P1: long-term context (3+ sessions improving, best in 2 weeks)
  - P2: session best (new session high)
  - P3: last-session comparison (back on track, matched previous best)
  - P4: negative signal (slight drop — softened language)
  - No signal for timed exercises or first-ever exercise session
  - Weights normalised to kg for comparison; delta displayed in user's current unit
  - Signal cleared on input focus; stale signal cleared on exercise change / undo
  - SW cache: gymops-v33

- [x] **F-04: Smart Session Reminder** — SHIPPED (May 17, 2026), real-world verification ongoing
  - In-app banner at predicted training time (Option A — see tech debt note)
  - Requires ≥4 sessions for pattern detection (mean + std dev of start times)
  - Banner shown within ±90min of predicted time or up to 3h past; 24h cooldown after dismissal
  - Adaptive offset: 3 dismissals → +30min shift; On/Off toggle in Settings
  - **Tech debt:** True OS-level push (fire when app is closed) requires backend push server (FCM/APNS). Out of scope — Phase 3 candidate if session start rate data justifies investment.
  - SW cache: gymops-v35

- [x] **F-05: In-Session Exercise Navigation** — SHIPPED & STABLE (May 17, 2026)
  - "Up Next: [Exercise] →" hint below action buttons; tappable to switch immediately
  - Order derived from first-logged sequence of most recent completed session
  - No hint if no prior session, exercise not in prior session, or last in sequence
  - Completed exercises de-emphasised in picker (muted + ✓ suffix via `.exercise-done`)
  - `switchExercise(name, type=null)` helper — type param prevents `getExerciseType` fallback from overriding explicit Strength/Cardio choice for custom exercises
  - SW cache: gymops-v36

- [x] **F-06: Session Completion Signal** — SHIPPED & STABLE (May 17, 2026)
  - Bottom sheet modal on session finish; single-tap dismiss (Done or backdrop)
  - Lines: exercises completed, volume delta vs prior session, best improvement, interpretation
  - Deterministic interpretation rules: "Strong session", "Building momentum", "Solid progression today", "Good return after a few days off", "Consistent work this week", "Consistent with last session", "Keep building", "Great start — baseline set"
  - `beforeSessionId` guard in `dbGetRecentSessionsBestForExercise` prevents just-finished session appearing as its own prior history
  - SW cache: gymops-v34

---

# Phase 2 Tech Debt & Notes

## Known Tech Debt

- **F-04 Push Notifications (Phase 3 candidate):** F-04 ships as an in-app banner (Option A). True OS-level push notifications that fire when the app is closed require a backend push server (FCM/APNS registration + server infrastructure). Meaningful Phase 3 upgrade if session start rate data justifies investment.
- **Mid-session unit switch:** Settings unit toggle is accessible only from the idle screen. A mid-session unit change requires ending the session. Tracked as future enhancement.
- **F-03 & F-06 signal tuning:** Signal rules are deterministic. May feel flat or over-trigger with sparse data. Monitor real-world feedback and tune thresholds (e.g. `WEIGHT_EPSILON_KG`, `SIGNAL_GAP_DAYS`) as usage grows.
- **Query performance:** Progression and completion signal queries scan recent session history. As session count grows, consider adding indexes on `sets.exercise` and `sets.session_id`.

## Architecture Notes (Phase 2)

- Weight normalisation: all cross-session comparisons use `CASE WHEN unit='lbs' THEN weight/2.2046 ELSE weight END` in SQL to produce kg values. `convertWeight()` in app.js handles display conversion.
- `beforeSessionId` guard: `dbGetRecentSessionsBestForExercise` accepts an optional `beforeSessionId` to exclude the current session from its own prior-history lookup (used by F-06).
- `setActiveExercise(name, type=null, { render })`: THE single mutation point for `state.exercise`/`state.exerciseType`/`state.setNumber` (renamed from `switchExercise` in the 2026-07 hardening pass). `type` param lets `applyOtherExercise` pass an explicit 'reps'/'timed' choice without `getExerciseType` overriding it; `render: false` is for bookkeeping resyncs (set logged/deleted) that manage their own re-render. `setNumber` is always recomputed from the DB. Never mutate these state fields directly.
- Rolling baseline (`dbGetRecentSessionsBestForExercise` with `limit=6`): prerequisite data shape for Phase 3 AI summary work — already in place.

---

# Phase 2 Exit Criteria

- [x] All six features (F-01–F-06) shipped and stable in production
- [x] No open High priority bugs
- [ ] Session start rate and completion rate measurably tracked (baseline vs post-Phase 2) — ongoing
- [ ] Smart Session Reminder: ≥4 weeks live with dismissal rate data — ongoing
- [ ] Progression signal: ≥4 weeks live with no data accuracy issues — ongoing
- [x] lbs/kg data layer verified with no unit corruption (ACs passed; real-world usage ongoing)
- [x] Full Phase 1 regression test passed (no regressions observed during Phase 2 development)

---

# Shipped Features — Phase 2.1

## Phase 2.1 (in progress)

- [x] **US-01: Start New Session from Resume Prompt** — SHIPPED (May 19, 2026, SW cache: `gymops-v40`)
  - "Start Workout" on idle screen now shows a confirmation modal when an incomplete session exists
  - Modal: "Discard session?" with body text, "Discard & Start New" (danger) and "Keep Resuming" (secondary) buttons; backdrop tap also cancels
  - `dbDeleteSession()` in db.js hard-deletes the session and all its sets
  - `startSession()` split into entry-point (guard + modal) and `_doStartSession()` (actual creation)

- [x] **US-02: Reduce Visual Prominence of Clear All Data** — SHIPPED (May 19, 2026, SW cache: `gymops-v41`)
  - "Clear All Data" demoted from `btn-danger btn-large` to `.settings-danger-link` (small, muted grey text, no background)
  - Moved to the very bottom of Settings screen, below the version string
  - Confirmation dialog and functionality unchanged

- [x] **US-04: Sort Exercise List by Most Recently Used** — SHIPPED (May 19, 2026, SW cache: `gymops-v43`)
  - Exercise picker defaults to MRU sort; "Recent / A–Z" toggle in picker header persisted to localStorage (`gymops_picker_sort`)
  - `dbGetExerciseRecency()` in db.js ranks exercises by `MAX(session.start_time) DESC`
  - `_recencyRanks` map rebuilt on every picker open; `_sortedExercises()` sorts EXERCISES array — "Other" always last, never-used exercises below used ones (A–Z among themselves)
  - `_renderExerciseList()` extracted from `openPicker()` so sort-toggle re-renders without reopening

- [x] **US-03: Export Session History by Date Range** — SHIPPED (May 19, 2026, SW cache: `gymops-v42`)
  - "Export History (CSV)" button added to Settings screen (no Drive auth required)
  - Opens `#export-range` bottom-sheet modal with From/To date inputs (defaults: 30 days ago → today)
  - `dbExportCSVByRange(from, to)` in db.js filters by `date(s.start_time)`; either bound may be omitted
  - CSV format identical to existing export; filename encodes the selected range
  - `downloadCSV(csv, filename)` helper extracted in app.js; existing completed-screen Export CSV unchanged
  - `color-scheme: dark` on date inputs for native dark-mode picker on mobile

- [x] **US-05: View Release Notes in Settings** — SHIPPED (May 19, 2026, SW cache: `gymops-v45`)
  - "What's New" button in Settings (About section) opens a scrollable bottom-sheet modal
  - Three entries: Phase 2.1, Phase 2, Phase 1 — most recent first; content hardcoded in HTML
  - No JS rendering logic; backdrop tap and "Done" button both close the modal

---

# Shipped Features — Phase 3

**Phase Goal:** AI-powered insights and structured training plans.

- [x] **AI Session Summary** — SHIPPED (July 1, 2026, SW cache: `gymops-v47`)
  - "AI Summary" button on completed screen (visible only when API key is set)
  - Vercel serverless function `api/ai-summary.js` proxies to `claude-fable-5` (server-side fallback to `claude-opus-4-8`)
  - `_buildSessionContext()` builds prompt from `dbGetAllSets` + `dbGetRecentSessionsBestForExercise` per exercise
  - When a plan is linked, context includes plan name, week number, objectives, completed vs skipped exercises
  - Anthropic API key stored in `gymops_anthropic_key` localStorage; entered in Settings → AI
  - Fable 5 returns thinking blocks before text — parse with `content.find(b => b.type === 'text')`

- [x] **Workout Plans** — SHIPPED (July 1, 2026, SW cache: `gymops-v49`)
  - Plans screen accessible from idle screen; plan editor screen for create/edit
  - Plan = name + optional duration (weeks) + up to 3 text objectives + ordered exercises with target sets×reps
  - Only one plan active at a time; creating a new plan archives the existing one
  - New session auto-links to active plan (`dbLinkSessionToPlan`); first plan exercise used as starting exercise
  - Exercise picker shows "Today's Plan" section at top with target hints (e.g. `4×8`); `_pickerContext = 'plan'` for plan editing mode
  - `computeUpNext()` uses plan order when a plan is linked; falls back to history order otherwise
  - Completed screen shows adherence: `Plan name: N/M exercises · skipped X, Y`
  - Expiry banner on idle screen when plan duration has elapsed
  - `dbGetSessionPlan(sessionId)` returns plan + exercises for a session

- [x] **Exercise History View** — SHIPPED (July 2, 2026, SW cache: `gymops-v50`, app: `v3.1`)
  - "History" link on idle screen → exercise list (completed sessions only, most recently used first) → per-exercise detail screen
  - Detail: Best / Last / Change stat tiles, SVG progression line chart, per-session breakdown list (newest first)
  - Chart plots best set per session — kg-normalised then converted to display unit; timed exercises plot total duration instead (data presence decides, so custom cardio names work)
  - Inline SVG, no chart library: 2px accent line, 10%-opacity area wash, surface-ringed dots, hairline gridlines at clean-number ticks, endpoint direct label, first/last date x-labels
  - Crosshair + tooltip snaps to nearest session on pointer move; `touch-action: pan-y` keeps vertical scroll working
  - `reps_at_best` uses SQLite bare-column-with-MAX semantics to get the rep count of the heaviest set
  - New DB queries are read-only — no schema change

- [x] **Quick-Log Button** — SHIPPED (July 2, 2026, SW cache: `gymops-v51`, app: `v3.2`)
  - One-tap set logging on the active screen, between inputs and Log Set
  - "Same as last time · 65 kg × 8 →" — logs last completed session's set matching the current set number (same reference as ghost-text placeholders, unit-converted)
  - Fallback "Repeat last set" when past last session's set count (repeats the last set logged this session); hidden when no reference exists
  - Timed exercises repeat duration · calories
  - No keyboard refocus after quick-log (`_afterSetLogged(focus = false)`) — avoiding typing is the point
  - `computeQuickLogRef()` / `renderQuickLog()` / `quickLogSet()` in app.js; `_afterSetLogged()` extracted from `logSet()`

- [x] **Bug fix: fresh-install schema missing `plan_id`** — SHIPPED (July 2, 2026, with v3.2)
  - `_createSchema()` created `sessions` without `plan_id` (only `_migrate()` added it), so brand-new databases — new installs or after "Clear All Data" — crashed with "no such column: plan_id" on session start
  - Fix: `plan_id INTEGER` added to the `sessions` CREATE. Existing DBs unaffected (migration path already handled them)
  - Lesson: every new column must be added to BOTH `_createSchema()` and `_migrate()`

- [x] **Idle Screen Dashboard** — SHIPPED (July 2, 2026, SW cache: `gymops-v52`, app: `v3.3`)
  - Week strip card: Mon–Sun dots, trained days filled accent, today ringed; consecutive-week streak shown from 2 weeks up (untrained current week doesn't break the streak until fully missed)
  - Hook line replaces "Ready to train" when history exists: "Chest Press hit 65 kg yesterday — beat it?" when the last session set a new best (largest kg-normalised improvement), else "Last workout {when} — N sets across M exercises"
  - Active plan line: "{name} · Week N of M"
  - History/Plans/Settings links consolidated into one horizontal row (`.idle-links`); `.settings-link` CSS removed
  - Fresh installs still see plain "Ready to train" — dashboard elements hidden with no data
  - `renderIdleDashboard()` (→ `renderIdleHook()` / `renderWeekStrip()` / `renderIdlePlanLine()`), helpers `_weekStart()` / `_relativeDay()`; DB: `dbGetLastCompletedSession()` / `dbGetCompletedSessionsSince()`

- [x] **PR Celebration Moment** — SHIPPED (July 2, 2026, SW cache: `gymops-v53`, app: `v3.4`)
  - Fires only on an **all-time PR**: logged weight (kg-normalised) beats the best of every completed session AND anything earlier this session; epsilon-guarded; requires prior completed-session history (no PR on a first-ever exercise)
  - Full-screen dimmed overlay: 🏆 "All-Time Best — 67.5 kg · Chest Press" card with pop animation, 24-piece confetti burst (lime/white/dim-green), haptic pattern, rising three-note Web Audio fanfare
  - Auto-dismisses after 2.6 s; tap dismisses instantly; never blocks logging. `prefers-reduced-motion` disables pop + confetti
  - Progression signal line overridden to "All-time PR — {weight} {unit}" so the moment persists after the overlay
  - Detection runs in `logSet()` BEFORE the insert (so the new set isn't its own baseline); quick-log can't PR by definition (logs ≤ last session's values) so it skips the check
  - `isAllTimePR()` / `celebratePR()` / `dismissPRCelebration()` / `_prFanfare()` in app.js; `dbGetAllTimeBestForExercise()` in db.js
  - Headless testing note: virtual-time screenshots render CSS animations at final state — confetti (ending at opacity 0) is invisible; verify with animation overrides in the harness

- [x] **Smarter Plan Nudges** — SHIPPED (July 2, 2026, SW cache: `gymops-v54`, app: `v3.5`)
  - `plans.target_sessions_per_week` (INTEGER, nullable) — added to BOTH `_createSchema()` and `_migrate()`; "Sessions per week (optional)" field in plan editor; shown as "3×/week" on the plan card
  - Accent-bordered nudge banner on the idle screen, deterministic rules in priority order:
    - Week pace (needs target): fires when remaining sessions ≥ days left in week (incl. today) − 1 → "0 of 3 sessions this week — 4 days left"
    - Gap (any active plan): ≥ SIGNAL_GAP_DAYS since last session → "No training in 4 days — {plan} is waiting"
  - Never fires if a session was completed today or the plan has expired
  - Banner hierarchy on idle: plan expiry > plan nudge > generic F-04 reminder — never stacked
  - Dismiss ✕ with 24h cooldown (`gymops_plan_nudge_dismissed_at`)
  - `computePlanNudge()` / `checkPlanNudge()` / `dismissPlanNudge()` in app.js

- [x] **Expanded Exercise Catalogue + Picker Upgrades** — SHIPPED (July 12, 2026, SW cache: `gymops-v66`, app: `v3.6`)
  - EXERCISES expanded to 114 entries with `muscleGroup` tags (`MUSCLE_GROUPS` in state.js); legacy names preserved (test-guarded)
  - Picker: search field (never autofocused), muscle-group chips, sectioned full catalogue below the Recent block

- [x] **Weekly Muscle-Coverage Chips** — SHIPPED (July 13, 2026, SW cache: `gymops-v67`, app: `v3.7`)
  - Muscle-group coverage chips on the idle week card, computed from the current week's logged sets

---

# Next / Backlog

**Re-queued behind Phases 4–6** — see `docs/PHASE4_CONSUMER_PLAN.md` for the active roadmap (trust & correctness → identity & program model → consumer readiness). These flavour features resume when the trust work is done:

- **Weekly AI summary** — On-demand summary of the week's sessions (reuses existing serverless function; muscleGroup tags now available for richer context)
- **Shareable AI summary post** (user feedback, July 18 2026) — turn the post-session AI summary into a share-ready post (X etc.) via `navigator.share`; fits Phase 6 distribution theme, pairs with weekly AI summary
- **Plan iterations** — Auto-detect objective completion (e.g. "hit 100kg bench"); plan-to-plan progression suggestions (partially superseded by Phase 5 multi-day program model)
- **Push notifications** — True OS-level smart reminder (requires backend; gated in Phase 7)
- **Watch quick-log** (user feedback, July 18 2026) — "Same as last time" from Fitbit/Apple Watch. Not possible from a PWA; needs a native watch companion. Parked with push notifications as "requires leaving PWA-only". Signal: two separate asks about reducing quick-log friction
- **Mid-session unit switch** — Allow unit toggle during an active session (the lbs↔kg inline converter in the 5.2.x batch covers the common case; this is the full version)