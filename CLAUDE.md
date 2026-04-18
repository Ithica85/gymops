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
3. Update the service worker cache version in `sw.js` if any cached files changed. Current version: `gymops-v20`.
4. Verify CSV export still works and includes any new columns.

---

# Shipped Features (Phase 1.1 + 1.2 + post-1.2)

All Phase 1.1 patches complete. P1.2-01 and three additional stories shipped as of commit `104f752`.

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

---

# Next / Backlog

Add new stories here when ready to plan next work.
