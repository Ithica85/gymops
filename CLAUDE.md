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
- **Single page** with three screens: idle, active, completed, plus an exercise picker modal.

## File Map

- `index.html` — Single-page structure with all three screens and the exercise picker modal.
- `js/app.js` — All UI logic, state management, exercise list (`EXERCISES` array of `{ name, type }` objects where `type` is `"reps"` or `"timed"`), screen routing, exercise picker, CSV export, toast notifications. Helper `getExerciseType(name)` looks up type by name.
- `js/gdrive.js` — Google Drive integration. Uploads per-session data as a Google Sheet (auto-converted from CSV) to a `GymOps` folder in the user's Drive. `GOOGLE_CLIENT_ID` is configured. Files named `gym_YYYY_MM_DD` with numeric suffix for same-day duplicates.
- `js/db.js` — SQLite schema, CRUD operations, CSV export query. Two tables: `sessions` and `sets`.
- `css/style.css` — Full styling. Dark theme tokens in `:root`. Mobile-first responsive.
- `sw.js` — Service worker for PWA caching.
- `manifest.json` — PWA manifest.
- `lib/` — Vendored sql.js (sql-wasm.js + sql-wasm.wasm).

## Database Schema

```sql
sessions (
  session_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time  TEXT NOT NULL,
  end_time    TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  notes       TEXT               -- added via ALTER TABLE migration
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
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
)
```

A set row must have EITHER (weight + reps) OR (duration_mins), never both, never neither.

**IMPORTANT:** Schema changes must use a full table migration (create new, copy, drop old, rename) — never just DROP/CREATE which would lose data. See `_migrate()` in `js/db.js` for the established pattern. Nullable column additions may use `ALTER TABLE ... ADD COLUMN` (see `notes` column). Existing user data in localStorage must always be preserved.

## Design Language

- Background: `#0d0d0d`, surfaces: `#181818` / `#222222`, accent: `#c8ff57` (lime), danger: `#ff4040`.
- Border radius: 14px. Font: system stack (-apple-system, etc).
- Modals use bottom-sheet pattern with backdrop overlay (see exercise picker for reference).
- Buttons follow `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-text` patterns.

## After Any Change

1. Test at 375px width in Chrome DevTools mobile view.
2. Verify existing session/sets data is not corrupted (load app with pre-existing localStorage data).
3. Update the service worker cache version in `sw.js` if any cached files changed. Current version: `gymops-v30`.
4. Verify CSV export still works and includes any new columns.

---

# Current Phase

**Phase 2 — In Development** (started May 10, 2026)

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
- **US-003** — App version displayed at bottom of Settings screen; hardcoded `APP_VERSION` constant in `app.js`, set on boot
- **US-004** — Delete a set from the active session log; trash button per row, inline confirmation, set re-sequences after deletion, `state.setNumber` kept in sync; `dbDeleteSetById` + `dbResequenceSets` in `db.js`
- **US-005** — Rest timer between sets (90s countdown); appears after first set logged, beep + vibrate on complete, Skip to dismiss early; lives entirely in UI state
- **Bug fix** — Inactivity timeout now fires correctly when tab is backgrounded; `visibilitychange` listener checks real wall-clock elapsed time against `_lastActivityTime` to bypass browser timer throttling
- **US-006** — Visible "Log Set" button (full-width, lime, above action row); Enter key behaviour preserved
- **US-007** — Timed exercise input labels: "Duration (mins)" / "Calories" for timed, "Weight (unit)" / "Reps" for reps; placeholders updated to match
- **US-008** — Weight unit preference (kg/lbs) in Settings; stored in localStorage (`gymops_weight_unit`); updates label and placeholder immediately; no conversion applied
- **US-002** — Cardio keyword auto-detection for "Other" exercises (treadmill, bike, rower, elliptical, stairmaster → timed); unknown names prompt "Strength or Cardio?"; Cancel and ← Back navigation at both steps
- **US-003b** — Undo opens exercise picker when no sets logged for current exercise; existing delete-last-set behaviour preserved when sets exist

---

# Phase 2 Features (In Development)

**Phase Goal:** Increase session start rate and completion rate.

**Status:** Foundation track in progress.

## Foundation Track (Ship First)

- [ ] **F-01: Rest Timer Bug Fix** — Verify timer continues running when app is backgrounded. Fix if using setInterval; switch to timestamp-based elapsed time calculation.
  - AC: Timer accurate after background/foreground, device lock/unlock (iOS + Android)
  
- [ ] **F-02: lbs/kg Data Layer Fix** — CRITICAL PATH. Add unit storage at database level.
  - Schema: Add `unit` column (TEXT, NOT NULL, DEFAULT 'lbs') to `sets` table
  - Schema: Add `default_unit` column (TEXT) to `sessions` table
  - Migration: Stamp all existing rows with 'lbs'
  - AC: Each set stores logged unit; mid-session unit switch preserves prior set units; CSV export includes unit; PREV displays converted units correctly
  - **Blocks:** F-03, F-04, F-05, F-06

## Habit Reinforcement Track (Ship After Foundation)

- [ ] **F-03: In-Session Progression Signal** — Display delta vs last session after each set logged. Deterministic rule-based signal pipeline (not hardcoded strings). Support extensibility for Phase 3.
  - Priority 1: Long-term context (3+ sessions improving, Best in 2 weeks)
  - Priority 2: Session best (+5 lbs — new session high)
  - Priority 3: Last session comparison (Matched previous best, Back on track)
  - Priority 4: Negative signal (Slight drop from last session — softened language)
  - No signal for first-ever exercise, time-based exercises, or <1 prior session
  - AC: Signal within 500ms; accurate delta; visually subordinate; non-blocking
  - **Depends on:** F-02

- [ ] **F-04: Smart Session Reminder** — Push notification at predicted training time based on session timestamp patterns. Deep link to active session. Adaptive timing (shift 30min after 3 dismissals). Graduated missed-session detection.
  - Minimum 4 sessions before feature activates
  - Pattern: mean session time, std dev threshold (>4h → fall back to fixed time)
  - Missed session: 1st silent, 2nd contextual notification, max 1 per 72h
  - Settings: On/Off toggle + notification window preference
  - AC: Fires ±30min of typical time; tap → session screen; dismiss → no side effects; respects window preference
  - **Depends on:** F-02

- [ ] **F-05: In-Session Exercise Navigation** — Surface next exercise contextually after set logged, based on last session order. "Up Next" label. User can override. No previous session = Phase 1 behaviour unchanged.
  - Completed exercises de-emphasized but accessible
  - Must not add steps to core logging flow (2 inputs + 1 confirm max)
  - AC: Next exercise visible without scroll; user can select any exercise; no regression if no prior session
  - **Open questions:** OQ-06 (collapse completed?), OQ-07 (new exercise positioning?)
  - **Depends on:** F-02

- [ ] **F-06: Session Completion Signal** — Minimal closure screen on session finish (3–4 data points only). Exercises completed, volume delta, strongest improvement, interpretation line. No gamification (no streaks/badges).
  - Interpretation: deterministic rules from completion %, volume delta, frequency context (e.g., "Strong session", "Building momentum", "Good return after a few days off")
  - AC: Signal appears immediately on finish; data accurate; single-tap dismiss; no reappearance; no gamification
  - **Depends on:** F-02

---

# Phase 2 Architecture / Data Layer

## Feature Flags (Development Only)

Disable Phase 2 features during development to prevent user-facing bugs:

```javascript
// Added at top of js/app.js
const FEATURES = {
  PHASE_1: {
    sessionLogging: true,
    undoButton: true,
    csvExport: true,
    googleDriveSync: true
  },
  PHASE_2: {
    restTimerFix: false,        // F-01
    unitDataLayer: false,       // F-02
    progressionSignal: false,   // F-03
    smartReminder: false,       // F-04
    exerciseNavigation: false,  // F-05
    completionSignal: false     // F-06
  }
};

```

Use: `if (FEATURES.PHASE_2.progressionSignal) { /* render feature */ }`

## Critical Dependencies

- **F-02 must ship before F-03, F-04, F-05, F-06** — All downstream features depend on accurate unit data.
- **Rolling baseline query** (prerequisite for Phase 3 AI summary): Query last 4–6 sessions per exercise. Design and validate before Phase 3.

## Known Issues / Tech Debt

- **F-02 Migration:** High-stakes data migration (existing user data). Test thoroughly on production backup before shipping.
- **F-04 Timing:** Notification timing sensitivity. Edge cases in time detection need robust testing.
- **F-03 & F-06 Rules:** Signal generation rules are deterministic but can feel flat if not carefully tuned. User feedback loop essential.
- **Query Performance:** As session history grows, queries for progression signal and completion signal may slow. Design with indexing.

---

# Phase 2 Exit Criteria

- [ ] All six features (F-01–F-06) shipped and stable in production
- [ ] No open High priority bugs
- [ ] Session start rate and completion rate measurably tracked (baseline vs post-Phase 2)
- [ ] Smart Session Reminder live for minimum 4 weeks with dismissal rate data
- [ ] Progression signal live for minimum 4 weeks with no data accuracy issues
- [ ] lbs/kg data layer verified with no unit corruption
- [ ] All open questions (OQ-01–OQ-07) resolved and documented
- [ ] Full Phase 1 regression test passed

---

# Next / Backlog

See Phase 2 features above. Roadmap: GymOps_Phase2_Roadmap.md | Sprint planning: GymOps_Phase2_SprintPlanning.md | Daily tracking: GymOps_Phase2_DailyChecklist.md