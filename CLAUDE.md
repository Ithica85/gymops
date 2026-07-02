# GymOps

## Project Overview

GymOps is a mobile-first gym workout logger deployed as a PWA on Vercel (gymops-two.vercel.app). It is a personal tool in active real-use testing.

## Tech Stack & Constraints

- **Vanilla HTML/CSS/JS only.** No frameworks (React, Vue), no build tools (webpack, vite), no bundlers.
- **SQLite via sql.js** persisted to localStorage. The sql.js library is vendored in `/lib`.
- **No npm dependencies** beyond sql.js.
- **PWA** with service worker (`sw.js`) and `manifest.json`.
- **Dark theme** using CSS custom properties defined in `:root` in `css/style.css`.
- **Mobile-first** — design target is 375px width. All content on the active workout screen must remain above the fold.
- **Single page** with five screens: idle, active, completed, settings, plans, plan-editor, plus modals.
- **Vercel serverless function** at `api/ai-summary.js` proxies Anthropic API calls (avoids CORS). No other backend.

## File Map

- `index.html` — Single-page structure with all screens (idle, active, completed, settings, plans, plan-editor), exercise picker modal, session-signal modal, AI summary modal, plan expiry banner, and up-next hint.
- `js/app.js` — All UI logic, state management, exercise list (`EXERCISES` array of `{ name, type }` objects where `type` is `"reps"` or `"timed"`), screen routing, exercise picker, CSV export, toast notifications. Helper `getExerciseType(name)` looks up type by name. Phase 2 additions: `convertWeight()` for lbs↔kg conversion; `switchExercise()` extracted helper; `computeProgressionSignal()` / `renderProgressionSignal()` (F-03); `computeSessionSignal()` / `renderSessionSignal()` (F-06); `checkSessionReminder()` / `showReminderBanner()` / `dismissReminderBanner()` (F-04); `computeUpNext()` / `renderUpNext()` (F-05). Phase 2.1 additions: `startSession()` (guard + discard modal); `_doStartSession()` (US-01); `downloadCSV(csv, filename)` shared helper; `openExportRangeModal()` (US-03); `_pickerSort` / `_recencyRanks` / `_sortedExercises()` / `_renderExerciseList()` / `_refreshRecencyRanks()` (US-04). Phase 3 additions: `ANTHROPIC_KEY` / `getAnthropicKey()` / `setAnthropicKey()`; `_buildSessionContext()` / `generateAISummary()` / `hideAISummaryModal()` (AI summary); `renderPlanAdherence()` / `checkPlanExpiry()` / `renderPlansScreen()` / `openNewPlan()` / `openEditPlan()` / `renderPlanEditorExercises()` / `addExerciseToPlan()` / `savePlan()` / `archiveCurrentPlan()` (plans); `_pickerContext` for dual-mode picker (session vs plan).
- `js/gdrive.js` — Google Drive integration. Uploads per-session data as a Google Sheet (auto-converted from CSV) to `GymOps/Gym Session Data/YYYY-MM/` in the user's Drive. `GOOGLE_CLIENT_ID` is configured. Files named `gym_YYYY_MM_DD` with numeric suffix for same-day duplicates. One-time migration moves legacy root-level files to the correct month folders (guarded by `gymops_gdrive_migrated` localStorage flag).
- `js/db.js` — SQLite schema, CRUD operations, CSV export query. Phase 2 additions: `dbCreateSession(defaultUnit)`; `dbInsertSet(..., unit)`; queries for F-03/F-04/F-05/F-06. Phase 2.1 additions: `dbDeleteSession(sessionId)`; `dbExportCSVByRange(from, to)`; `dbGetExerciseRecency()`. Phase 3 additions: `dbCreatePlan()` / `dbUpdatePlan()` / `dbUpdatePlanStatus()` / `dbGetActivePlan()` / `dbGetPlan()` / `dbGetAllPlans()` / `dbGetPlanExercises()` / `dbSavePlanExercises()` / `dbLinkSessionToPlan()` / `dbGetSessionPlan()`.
- `api/ai-summary.js` — Vercel serverless function. Proxies POST requests to the Anthropic API (`claude-fable-5`, fallback `claude-opus-4-8`). Accepts `{ context, apiKey }` in the body; API key falls back to `ANTHROPIC_API_KEY` env var. Returns `{ text }` or `{ error }`.
- `css/style.css` — Full styling. Dark theme tokens in `:root`. Mobile-first responsive.
- `sw.js` — Service worker for PWA caching.
- `manifest.json` — PWA manifest.
- `lib/` — Vendored sql.js (sql-wasm.js + sql-wasm.wasm).

## Database Schema

```sql
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
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
)

plans (
  plan_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  start_date     TEXT NOT NULL,    -- ISO date (YYYY-MM-DD)
  duration_weeks INTEGER,          -- null = ongoing
  objectives_json TEXT,            -- JSON array of objective strings, or null
  status         TEXT NOT NULL DEFAULT 'active'  -- 'active' | 'archived'
)

plan_exercises (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id     INTEGER NOT NULL,
  exercise    TEXT NOT NULL,
  target_sets INTEGER,
  target_reps INTEGER,
  sort_order  INTEGER NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES plans(plan_id)
)
```

A set row must have EITHER (weight + reps) OR (duration_mins), never both, never neither.
Only one plan should have `status = 'active'` at a time — `savePlan()` archives any existing active plan before creating a new one.

All weight comparisons across sessions (progression signal, session signal) normalise to kg internally via SQL `CASE` expressions to handle mixed-unit history correctly.

**IMPORTANT:** Schema changes must use a full table migration (create new, copy, drop old, rename) — never just DROP/CREATE which would lose data. See `_migrate()` in `js/db.js` for the established pattern. Nullable column additions may use `ALTER TABLE ... ADD COLUMN` (see `notes` column). Existing user data in localStorage must always be preserved.

## Design Language

- Background: `#0d0d0d`, surfaces: `#181818` / `#222222`, accent: `#c8ff57` (lime), danger: `#ff4040`.
- Border radius: 14px. Font: system stack (-apple-system, etc).
- Modals use bottom-sheet pattern with backdrop overlay (see exercise picker for reference).
- Buttons follow `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-text` patterns.

## After Any Change

1. Test at 375px width in Chrome DevTools mobile view.
2. Verify existing session/sets data is not corrupted (load app with pre-existing localStorage data).
3. Update the service worker cache version in `sw.js` if any cached files changed. Current version: `gymops-v49`.
4. Verify CSV export still works and includes any new columns.

---

# Current Phase

**Phase 3 — AI & Plans** (started July 1, 2026)

## Phase 3 Status
🚧 **IN PROGRESS** — first two features shipped July 1, 2026 (SW cache: `gymops-v49`, app: `v3.0`)

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
- **US-003** — App version displayed at bottom of Settings screen; hardcoded `APP_VERSION` constant in `app.js`, set on boot. Current value: `v2.0`
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
- `switchExercise(name, type=null)`: single entry point for exercise changes. `type` param lets `applyOtherExercise` pass an explicit 'reps'/'timed' choice without `getExerciseType` overriding it.
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

---

# Next / Backlog

- **Exercise history view** — Browse per-exercise progression over time (data already in DB, just needs a display screen)
- **Muscle group tagging** — Add `muscleGroup` to EXERCISES; enables weekly coverage view and richer AI context
- **Weekly AI summary** — On-demand summary of the week's sessions (reuses existing serverless function)
- **Plan iterations** — Auto-detect objective completion (e.g. "hit 100kg bench"); plan-to-plan progression suggestions
- **Push notifications** — True OS-level smart reminder (requires backend; FCM/APNS)
- **Mid-session unit switch** — Allow unit toggle during an active session