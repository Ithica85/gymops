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
  status      TEXT NOT NULL DEFAULT 'active'
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

**IMPORTANT:** Schema changes must use a full table migration (create new, copy, drop old, rename) — never just DROP/CREATE which would lose data. See `_migrate()` in `js/db.js` for the established pattern. Existing user data in localStorage must always be preserved.

## Design Language

- Background: `#0d0d0d`, surfaces: `#181818` / `#222222`, accent: `#c8ff57` (lime), danger: `#ff4040`.
- Border radius: 14px. Font: system stack (-apple-system, etc).
- Modals use bottom-sheet pattern with backdrop overlay (see exercise picker for reference).
- Buttons follow `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-text` patterns.

## After Any Change

1. Test at 375px width in Chrome DevTools mobile view.
2. Verify existing session/sets data is not corrupted (load app with pre-existing localStorage data).
3. Update the service worker cache version in `sw.js` if any cached files changed.
4. Verify CSV export still works and includes any new columns.

---

# Phase 1.1 Patch Spec

Implement these patches in the order listed below. Each patch has specific acceptance criteria. Do not deviate from the acceptance criteria without confirming with the user.

---

## ✅ P1.1-04: Split input into two numeric fields — COMPLETED

**Priority:** High
**Files:** index.html, css/style.css, js/app.js

**Context:** Currently a single text input (`#set-input`) accepts "weight reps" separated by a space. The full keyboard appears and the space delimiter is unintuitive.

**Acceptance Criteria:**

1. Replace the single `#set-input` field with two separate fields: `#input-weight` (placeholder: "Weight") and `#input-reps` (placeholder: "Reps").
2. Both fields: `type="text"`, `inputmode="numeric"`, `pattern="[0-9]*"`, `autocomplete="off"`.
3. Remove the `parseInput()` function that splits on whitespace. Replace with direct reads from each field.
4. Pressing Enter in the reps field submits the set. Pressing Enter in the weight field moves focus to the reps field.
5. After submitting a set, both fields clear and focus returns to the weight field.
6. Update the `input-hint` text to remove the "weight reps (e.g. 50 8)" instruction. Replace with no hint or a minimal "Weight | Reps" label above the fields.
7. Update the error message to "Enter weight and reps" if either field is empty or non-numeric.
8. The two fields should be side by side on the same row, each taking roughly 50% width, with a consistent style matching the current `.set-input` class.
9. For timed exercises (see P1.1-01), the two fields become Duration and Calories instead.

---

## ✅ P1.1-01: Support time-based exercises — COMPLETED

**Priority:** High
**Files:** js/app.js, js/db.js, index.html

**Context:** Currently all exercises log weight + reps. Time-based exercises (Elliptical, Stairmaster) need duration and optionally calories instead.

**Acceptance Criteria:**

1. Add an `exercise_type` property to each exercise definition: `"reps"` (default) or `"timed"`.
2. Elliptical and Stairmaster are type `"timed"`. All other existing exercises are type `"reps"`.
3. When a `"timed"` exercise is selected, replace the two numeric input fields (from P1.1-04) with: Duration (minutes, numeric input) and Calories (numeric input, optional).
4. The `sets` table schema must accommodate both types. Add nullable columns: `duration_mins` (REAL) and `calories` (INTEGER). The existing `weight` and `reps` columns become nullable.
5. A set row must have EITHER (weight + reps) OR (duration_mins), never both, never neither.
6. CSV export must include all columns. Unused columns for a given row export as empty strings.
7. The "Last set" reference display (see P1.1-06) shows "25 min · 180 cal" format for timed exercises.
8. The Recent Sets log shows the same format distinction.
9. Add "Stairmaster" to the EXERCISES array as type `"timed"`. This brings the list to 17 exercises (cap is no longer fixed at 15).

---

## ✅ P1.1-02: Clarify current set vs last set display — COMPLETED

**Priority:** High
**Files:** index.html, css/style.css, js/app.js

**Context:** The `set-info-row` currently shows "Set" (current number) and "Last set" (previous set weight × reps) side by side. Users confuse what they're looking at vs what they're entering.

**Acceptance Criteria:**

1. Rename the "Last set" label to "PREV" or "PREVIOUS SET".
2. Add a visual separator between the current set number and the previous set reference — either a vertical divider line or distinct background shading on each stat-block.
3. The previous set display format changes from "45 × 8" to "Set N: 45 × 8" so the user knows which set number it refers to.
4. If there is no previous set for this exercise in this session, display "—" as before.

---

## ✅ P1.1-06: Show last session performance for selected exercise — COMPLETED

**Priority:** Medium
**Files:** js/app.js, js/db.js

**Context:** Users can't remember what they lifted last time. Currently "Last set" only shows the previous set from the current session.

**Acceptance Criteria:**

1. Add a new DB function: `dbGetLastSessionSetsForExercise(exercise)` that queries the most recent COMPLETED session (not the current active one) and returns all sets for that exercise, ordered by set_number.
2. When an exercise is selected (either at session start, via the picker, or after submitting a set for a new exercise), display a "Last session" reference below the previous set info.
3. Format: "Last session: 45×8, 50×8, 50×6" (compact, all sets on one line). For timed exercises: "Last session: 25 min · 180 cal".
4. If no previous session data exists for this exercise, display "Last session: No history".
5. This is read-only reference data. Style it as muted/secondary text (`var(--muted)`), clearly distinct from the current session input area.
6. Add a new stat-label "LAST SESSION" in the `set-info-row` or directly below it.

---

## ✅ P1.1-05: Add 'Other' exercise with free-text name — COMPLETED

**Priority:** Medium
**Files:** js/app.js, index.html

**Context:** The exercise list is fixed. "Other" already exists in the EXERCISES array but selecting it just sets exercise name to "Other" with no way to specify what it actually is.

**Acceptance Criteria:**

1. When "Other" is selected from the exercise picker, show a text input field (inside the picker modal) prompting "Exercise name".
2. The user types a name and taps "Done" or presses Enter. The picker closes and the exercise name displays as whatever they typed.
3. The custom name is stored in the `sets` table `exercise` column as-is (e.g. "Cable Flyes").
4. If the user selects "Other" but leaves the name blank and taps Done, show an inline error: "Enter an exercise name". Do not close the picker.
5. Custom exercise names appear correctly in Recent Sets log and CSV export.

---

## ✅ P1.1-03: Finish button confirmation + session resume — COMPLETED

**Priority:** High
**Files:** js/app.js

**Context:** Pressing Finish immediately ends the session with no confirmation. Accidental taps lose the session.

**Acceptance Criteria:**

1. Tapping Finish shows a confirmation dialog: "End workout?" with two options: "End Workout" (confirms) and "Cancel" (returns to active screen). Use a modal overlay consistent with the existing exercise picker styling, NOT a native browser `confirm()`.
2. Add a "Resume Last Workout" button to the completed screen, visible only if the session was finished less than 60 minutes ago.
3. Resume reopens the session by setting status back to "active" in the sessions table and calling `resumeSession()`.
4. After 60 minutes, the resume option disappears and the session is final.

---

## ✅ P1.1-07: Inactivity timeout with auto-close prompt — COMPLETED

**Priority:** Medium
**Files:** js/app.js

**Context:** Users forget to close sessions. Need an inactivity timeout.

**Acceptance Criteria:**

1. Start a 30-minute inactivity timer when a session is active. Reset the timer on any set submission, exercise change, or undo action.
2. When 30 minutes of inactivity is reached, show a modal overlay: "Still working out?" with two buttons: "Yes, continue" (resets timer) and "End workout" (calls `finishWorkout`).
3. If the prompt receives no response for an additional 5 minutes, auto-close the session by calling `finishWorkout()`.
4. The timer should use `setInterval` or `setTimeout`, not `requestAnimationFrame`. Clear the timer on session finish.
5. The modal should use the same styling pattern as the exercise picker backdrop/sheet.

---

## ✅ P1.1-08: Auto-save CSV to Google Drive with date-stamped filename — COMPLETED

**Priority:** Medium
**Files:** js/app.js (new: js/gdrive.js)

**Context:** Currently CSV export is manual via a download button. Users want auto-save to Google Drive with filenames like gym_2026_03_14.

**Acceptance Criteria:**

1. On session finish (after `finishWorkout` completes), automatically export the session data as CSV and upload to Google Drive.
2. Filename format: `gym_YYYY_MM_DD.csv` using the session start date. If multiple sessions occur on the same day, append a suffix: `gym_YYYY_MM_DD_2.csv`.
3. Use the Google Drive API (via Google Identity Services for auth). On first use, prompt the user to authorize Google Drive access. Store the auth token for subsequent sessions.
4. Upload to a specific folder called "GymOps" in the user's Drive root. Create the folder if it doesn't exist.
5. Show a brief toast/notification on success: "Saved to Google Drive" or on failure: "Drive save failed — tap Export to save manually".
6. Keep the manual Export CSV button on the completed screen as a fallback.
7. **SETUP NOTE:** This requires adding the Google Identity Services script and a Google Cloud project with Drive API enabled. Create a placeholder constant `GOOGLE_CLIENT_ID` at the top of `js/gdrive.js` with a comment explaining the setup steps.
