# GymOps

A friction-free training companion for lifters who already have a plan.

**Live:** [gymops-two.vercel.app](https://gymops-two.vercel.app) · **App version:** v6.1

---

## The Problem

Most gym apps are designed to *sell you* a training plan. GymOps assumes you already have one — and refuses to get in your way while you execute it.

**It logs.** Sessions, sets, weight, reps, time-based work (cardio), and notes. One tap to repeat last session's set.

**It doesn't** upsell, coach, or bury the log under features. Everything added since Phase 1 — progress charts, AI summaries, PR celebrations, multi-day programs — exists to serve the log, not replace it. The intelligence is built from *your* data, on *your* device.

The friction-free philosophy: fewer screens, fewer fields, one tap to log a set. You're already tired; your app shouldn't be.

---

## Status

| Phase | Theme | Status |
|---|---|---|
| 1 | Core logging | ✅ Shipped April–May 2026 |
| 2 / 2.1 | Habit & progression signals, usability | ✅ Shipped May 2026 |
| 3 | AI, plans, history, training-companion turn | ✅ Complete July 2026 (v3.0–v3.7) |
| 4 | Trust & correctness — consumer quality bar | ✅ Complete July 16, 2026 (v4.0–v4.7) |
| 5 | Identity & program model | ✅ Core complete July 22, 2026 (v5.0–v5.10); closeout open (rename UI) |
| 6 | Consumer readiness | 🚧 In progress — 6.4 SW updates + 5.8 start/resume hatches shipped (v6.0–v6.1) |
| 7 | Distribution & optionality | Parked (gated triggers, not dates) |

**North star:** *the fastest logger that never loses your history.*

Standing decisions, phase success criteria, and the full roadmap: [`docs/PHASE4_CONSUMER_PLAN.md`](docs/PHASE4_CONSUMER_PLAN.md). External review disposition: [`docs/REVIEW_RESPONSE.md`](docs/REVIEW_RESPONSE.md). Architecture & phase history: [`CLAUDE.md`](CLAUDE.md).

---

## What's Shipped

### Phase 1 — Core logging
- Single-screen session logging; weight×reps or duration/calories for cardio
- Ghost-text PREV, full in-session log, undo, per-set delete, rest timer
- Session notes, CSV export, Google Drive auto-upload on finish
- 30-minute inactivity check; kg/lbs preference

### Phase 2 / 2.1 — Habit & progression
- In-session progression signal (deterministic rules — session highs, 2-week bests, recovery)
- Session completion summary (volume delta, best improvement)
- Smart session reminder at your usual training time
- Per-set unit storage; cross-session comparisons normalise to kg
- MRU exercise sort, date-range CSV export, discard-and-start-new guard, What's New

### Phase 3 — Training companion (v3.0–v3.7)

**AI Session Summary** — Post-workout natural-language breakdown via Claude (BYOK Anthropic key; Vercel proxy). Plan context included when linked.

**Workout Plans** — Named blocks with exercises, targets, optional duration/objectives/weekly session target. One active plan; picker, Up Next, and adherence follow the plan.

**Exercise History** — Per-exercise Best / Last / Change, hand-rolled SVG progression chart, session breakdown.

**Quick-Log** — One tap: *"Same as last time · 65 kg × 8 →"* (or repeat last set). No keyboard for the ~80% of sets that don't change.

**Idle dashboard** — Week strip, streak, plan week, hook line from last session, weekly muscle-coverage chips.

**PR celebration** — All-time PR only: trophy, confetti, haptics, fanfare. Never blocks logging. Respects reduced motion.

**Plan nudges** — Pace vs weekly target, or gap after idle days. Never stacks with expiry / F-04 banners.

**Catalogue** — 114 muscle-grouped exercises; picker search, filter chips, sectioned catalogue under Recent.

### Phase 4 — Trust & correctness (v4.0–v4.7) ✅

The consumer turn starts here: make history hard to lose by accident.

- **Corrupt-DB quarantine + recovery screen** — never silently wipe unreadable data; download blob / start fresh with confirm
- **Undo scoped to the current exercise** (verified bug fix)
- **Full database backup & restore** — format-1 JSON envelope; the "new phone" path
- **Persist-failure banner** — storage full keeps the session alive and prompts an immediate backup
- **Decimal weight input** on iOS (`62.5`, comma locales)
- **Auto-start rest timer** after each reps set; configurable duration in Settings
- **Pinch-zoom enabled** (accessibility baseline)
- **Layer 1 integration tests** — log → undo → resume → finish against a real in-memory sql.js DB
- Debt batch: shared `AudioContext`, toasts, local calendar dates

### Phase 5 — Identity & program model (v5.0–v5.10 core) ✅

Make the data model survive years and fit real training.

- **Stable exercise IDs** — `exercises` table; renames can update identity without orphaning history (`dbRenameExercise`; UI still open as 5.7)
- **Multi-day programs** — Push / Pull / Legs (and any split); day rotation, day switch mid-session, day-scoped picker / Up Next / adherence / AI context
- **Session start chooser** — plan → right day immediately; plan-less → pick first exercise *before* the session exists (no inventing a catalogue default)
- **IndexedDB storage** — DB blob moves out of localStorage (raw bytes); one-time adoption of legacy LS data; LS fallback when IDB unavailable
- **Day-scoped adherence** — completed screen + plans-screen week chips / session counts
- **Quick-log as hero** when a reference exists (hierarchy follows intent; color-only emphasis so buttons don't jump mid-tap)
- **User-feedback batch** — quick-log confirm/haptic/tap guard, rest bar compact + ±30s adjust, lbs↔kg converter, no password-manager prompt on AI key

**Closeout (open):** exercise rename UI (5.7), docs tick when that ships (5.9). Empty-day editor surfacing and optional rename-from-active are should/optional.

### Phase 6 — Consumer readiness (in progress)

Theme: a stranger can discover, install, migrate to, and use GymOps with no guidance.

| Shipped | Next |
|---|---|
| **6.4** Network-first service worker — a deploy reaches every online client on next open (no double-load, no hard refresh); cache-first for vendored sql.js | **6.6** Drive connect moves to Settings |
| **5.8** (Phase 5 closeout, shipped under v6.1) Zero-set plan-less resume and empty plan-day start open the exercise picker — never land on a random catalogue default | **6.8** Reset options split · **6.1** first-run · **6.2** Strong/Hevy CSV import · a11y · PWA polish · about page · local usage counters |

---

## What Works (cumulative snapshot)

| Area | Highlights |
|---|---|
| Logging | Quick-log hero, ghost PREV, full session log, undo, rest auto-start + in-session adjust, PR celebration |
| Plans | Multi-day splits, rotation, day switch, adherence, nudges, expiry |
| History | Per-exercise charts, signals (in-session + session complete) |
| Trust | Backup/restore, corrupt quarantine, IDB persistence, storage-full banner |
| Companion | AI summary (BYOK), idle dashboard, muscle coverage, Drive sheet upload |
| Platform | PWA, offline shell, network-first updates, vanilla JS only |

---

## Roadmap

Active plan: [`docs/PHASE4_CONSUMER_PLAN.md`](docs/PHASE4_CONSUMER_PLAN.md).

**Next (Phase 6 working order):**  
6.6 Drive → Settings · 6.8 reset split · 6.1 first-run · 6.2 Strong/Hevy import · 6.3 a11y · 6.5 PWA polish · 6.7 about/landing · 6.9 local usage counters  

**Also open:** Phase 5.7 exercise rename UI (History → exercise detail).

**Re-queued behind consumer readiness:** weekly AI summary · shareable AI post · plan iterations · push notifications · mid-session unit switch · watch companion (needs native)

**Phase 7 (gated):** monetization, cloud sync/accounts, store-wrapped native, watch app, server-side AI, push — each with an explicit reopen trigger. Core logging stays free forever if paid tiers ever appear.

---

## Data Strategy

**Core insight:** The data moat is the product.

GymOps builds a personal strength dataset — rep maxes, volume trends, progression, recovery signals — and pays it back as charts, hooks, PR detection, plan adherence, and optional AI summaries.

**You own it:**
- Full DB **backup & restore** (Settings) — the new-phone and disaster-recovery path
- CSV export (session + date range)
- Google Drive per-session sheets (optional)
- Corrupt DB is **quarantined**, never silently replaced
- Primary store is **IndexedDB** (sql.js blob); localStorage holds prefs + legacy fallback

No accounts, no server-side history, no ads. Optional AI is BYOK only.

---

## Development

### Install & Run

```bash
git clone https://github.com/Ithica85/gymops.git
cd gymops

# Tests (Vitest — no browser required)
npm test

# Local static server
python3 -m http.server 8080
```

Open `http://localhost:8080`. Production clients pick up deploys on next open via the network-first service worker (6.4); cache bumps still keep the offline precache complete.

### Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS — no framework, no bundler, no runtime npm deps
- **Data:** sql.js (SQLite in WASM) → **IndexedDB** raw blob (localStorage fallback)
- **Backup:** Full DB export/import + Google Drive session sheets
- **AI:** Anthropic via one Vercel serverless function (`api/ai-summary.js`)
- **Deploy:** Vercel (static + one function); PWA with offline shell
- **Tests:** Vitest (db paths, Layer 1 integration, pure logic) — `npm test`

### Key Files

```
gymops/
├── index.html          # All screens + modals
├── css/style.css       # Dark theme tokens in :root
├── js/app.js           # Entry: boot + event wiring only
├── js/workout.js       # Layer 1 session lifecycle, log, rest, PR, quick-log
├── js/db.js            # Schema, migrations, CRUD, queries
├── js/storage.js       # IndexedDB blob store
├── js/                 # Feature modules: picker, signals, idle, plans,
│                       #   history, settings, ai, gdrive, state, ui
├── api/ai-summary.js   # Anthropic proxy
├── sw.js               # Service worker (network-first app files)
├── tests/              # Vitest suite
├── docs/               # Consumer plan + review response
└── CLAUDE.md           # Architecture, schema, phase history
```

### Contributing

GymOps is intentionally minimal. PRs welcome for **bug fixes and performance**; features are evaluated against the friction-free philosophy and the north star.

Before opening a PR:
1. `npm test`
2. Test at 375px width (mobile-first)
3. Verify existing data survives (schema changes: both `_createSchema()` and `_migrate()`)
4. Bump `sw.js` cache version when cached files change; update `APP_VERSION` in `js/state.js`
5. User-entered text: `escapeHTML` or DOM `textContent`

---

## Design Notes

- **Mobile-first** at 375px; active workout content stays above the fold where possible
- **Dark theme:** background `#0d0d0d`, surfaces `#181818` / `#222`, accent `#c8ff57` (lime)
- **Bottom sheets** for modals (picker, confirms, signals)
- **Single mutation point** for active exercise: `setActiveExercise()` in `workout.js`
- **Deterministic signals only** — no ML black-box coaching

---

## The Data Bug Stories

**session_id=0 (April 2026):** All sessions logged under `session_id=0` because `_persist()` ran *before* `last_insert_rowid()` — exporting the database resets the rowid. Fix: capture the id first. Every INSERT-returning-id path follows that order.

**The missing column (July 2026):** Phase 3 added `plan_id` via migration only. Fresh installs crashed on session start. **Lesson:** every schema change lands in *both* create and migrate paths; fresh-install testing catches what your own migrated device can't.

---

## FAQ

**Q: Why no Apple Health / Fitbit integration?**  
Real signals, not core to *logging reps*. Parked until the trust and consumer paths are done.

**Q: Why not React / Svelte / Vue?**  
Vanilla + sql.js shipped faster and stayed reason-able through charts, plans, IDB, and AI. No bundler, no runtime `node_modules`.

**Q: Can I sync across devices?**  
Full backup/restore + Drive session sheets today. True multi-device sync is Phase 7, gated on personal need or real demand.

**Q: Workout programs? Periodization?**  
You write the plan (including multi-day splits). GymOps guides the session and measures adherence. It won't invent a program for you.

**Q: Doesn't AI conflict with friction-free?**  
Opt-in BYOK, post-session only, never interrupts logging.

**Q: Will this stay free?**  
Core logging is free and open-source. If paid tiers ever exist, logging stays free.

**Q: Import from Strong / Hevy?**  
Planned as Phase 6.2 (depends on stable exercise IDs, already shipped).

---

## Reading List

- **[Substack: GymOps Series](https://substack.com/@dan1608272)** — Friction-free design, the SQL rowid bug, data strategy
- **[Consumer product plan](docs/PHASE4_CONSUMER_PLAN.md)** — Phases 4–7 decisions and success criteria
- **[sql.js Docs](https://sql.js.org/)** — SQLite for the browser
- **[Vercel Docs](https://vercel.com/docs)** — Static hosting + serverless

---

## License

MIT. Use it, fork it, learn from it.

---

## Contact

Questions? Found a bug? Open an issue or reach out on Substack — https://substack.com/@dan1608272

---

**GymOps is built by lifters, for lifters. Log your reps. Own your data. Lift heavy.**
