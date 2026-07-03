# GymOps

A friction-free training companion for lifters who already have a plan.

**Live:** [gymops-two.vercel.app](https://gymops-two.vercel.app)

---

## The Problem

Most gym apps are designed to *sell you* a training plan. GymOps assumes you already have one — and refuses to get in your way while you execute it.

**It logs.** Sessions, sets, weight, reps, time-based work (cardio), and notes. One tap to repeat last session's set.

**It doesn't** upsell, coach, or bury the log under features. Everything added since Phase 1 — progress charts, AI summaries, PR celebrations, plan nudges — exists to serve the log, not replace it. The intelligence is built from *your* data, on *your* device.

The friction-free philosophy: fewer screens, fewer fields, one tap to log a set. You're already tired; your app shouldn't be.

---

## Status: Phase 3 — AI & Plans (v3.5, live)

| Phase | Theme | Status |
|---|---|---|
| 1 | Core logging | ✅ Shipped April–May 2026 |
| 2 / 2.1 | Habit & progression signals, usability | ✅ Shipped May 2026 |
| 3 | AI, plans, and the training-companion turn | 🚧 In progress — seven features live (July 2026) |

---

## What's Happened in Phase 3

Phase 3 started July 1, 2026 with two foundation features, then shipped the full five-item product strategy ("most frictionless, attention-grabbing gym app") the next day — five releases in one day, v3.1 → v3.5.

### AI Session Summary (v3.0)
Tap "AI Summary" after finishing a workout and Claude gives you a natural-language breakdown of the session — bests, deltas vs. your history, and plan context (week number, objectives, what you completed vs. skipped). Runs through a Vercel serverless proxy; you bring your own Anthropic API key (stored locally, never uploaded).

### Workout Plans (v3.0)
Named training blocks with exercises, target sets×reps, optional duration and objectives. One plan active at a time. Your active plan guides the session: the exercise picker surfaces plan exercises first with their targets, "Up Next" follows plan order, and the completed screen shows adherence. An expiry banner nudges a review when the block runs out.

### Exercise History (v3.1)
Every exercise now has a progression view: an SVG line chart of your best set per session (hand-rolled, no chart library), Best / Last / Change stat tiles, a crosshair tooltip, and a per-session breakdown. The line going from 60 kg to 90 kg over three months — the most motivating thing in any gym app — finally visible.

### Quick-Log (v3.2)
The core loop, collapsed to one tap: **"Same as last time · 65 kg × 8 →"** logs last session's set for your current set number. Past last session's set count it offers "Repeat last set." No keyboard, no typing — covers the ~80% of sets that repeat. *(Also fixed in this release: fresh installs crashed on session start due to a schema column missing from the create path.)*

### Idle Screen Dashboard (v3.3)
The home screen stopped being a dead end. It now shows a Mon–Sun week strip of training days, a consecutive-week streak counter, your active plan's week number, and a hook from your last session — *"Chest Press hit 65 kg yesterday — beat it?"*

### PR Celebration (v3.4)
Beating your **all-time best** on any exercise gets a real moment: trophy card, confetti burst, haptics, and a rising fanfare. Strictly all-time PRs only, so it keeps meaning. Auto-dismisses in 2.6 s and never blocks the next set. Respects `prefers-reduced-motion`.

### Smarter Plan Nudges (v3.5)
Plans gain an optional sessions-per-week target. Fall behind the week's pace and the home screen tells you plainly: *"0 of 3 sessions this week — 4 days left."* Plans without a target still nudge after a few idle days. Nudges never fire on days you've already trained, and never stack with other banners.

---

## What Works (cumulative)

**Core logging (Phase 1)**
- Single-screen session logging; 16 predefined exercises + free-text "Other" with cardio auto-detection
- Weight + reps in separate fields; duration + calories for cardio
- Ghost-text placeholders show last session's values per set
- Session notes, full in-session log, undo, per-set delete, rest timer
- CSV export (per-session and date-range) + Google Drive auto-upload
- 30-minute inactivity check with auto-close

**Habit & progression (Phase 2)**
- In-session progression signal (deterministic rule engine — session highs, 2-week bests, recovery)
- Session completion summary (volume delta, best improvement)
- Smart session reminder at your usual training time
- Per-set unit storage (kg/lbs) — cross-session comparisons normalise to kg

**Training companion (Phase 3)** — everything above in "What's Happened in Phase 3"

---

## Roadmap

**Next up (backlog):**
- Muscle group tagging → weekly coverage view, richer AI context
- Weekly AI summary (on-demand, reuses the serverless function)
- Plan iterations — auto-detect objective completion, plan-to-plan progression
- True OS-level push notifications (needs a backend; FCM/APNS)
- Mid-session unit switch

**Further out:**
- Multi-device sync
- Landing page and positioning vs. Strong, JEFIT, Hevy
- Optional paid tier (advanced analytics, sync) — core logging stays free

---

## Data Strategy

**Core insight:** The data moat is the product.

GymOps exists to build a personal strength dataset — rep maxes, volume trends, exercise progression, recovery signals. Phase 3 is where that dataset started paying rent: the history charts, the idle-screen hooks, the PR detection, and the AI summaries are all computed from data you logged months ago.

CSV export and Google Drive sync aren't features; they're **data sovereignty guarantees**. You own it. You can port it.

---

## Development

### Install & Run

```bash
# Clone the repo
git clone https://github.com/Ithica85/gymops.git
cd gymops

# Local dev (any static server will work)
python3 -m http.server 8080
```

Then visit `http://localhost:8080` in your browser. Hard refresh (Cmd+Shift+R) after service-worker cache bumps.

### Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS (intentional — no framework, no bundler, no node_modules)
- **Data:** sql.js (SQLite compiled to WebAssembly), persisted to localStorage
- **Backup:** Google Drive API (per-session sheets, auto-uploaded on finish)
- **AI:** Anthropic API (claude-fable-5) via a single Vercel serverless function
- **Deploy:** Vercel (static + one function, zero-cost tier); PWA with offline service worker

### Key Files

```
gymops/
├── index.html          # Single-page markup: all screens + modals
├── css/style.css       # Full styling; dark theme tokens in :root
├── js/app.js           # UI logic, state, rule engines, charts
├── js/db.js            # SQLite schema, migrations, CRUD, queries
├── js/gdrive.js        # Google Drive upload + auth
├── api/ai-summary.js   # Vercel function: Anthropic API proxy
├── sw.js               # Service worker (cache version bumped every release)
└── CLAUDE.md           # Architecture decisions, schema, phase history
```

### Contributing

GymOps is intentionally minimal. PRs welcome for **bug fixes and performance**; feature requests will be evaluated against the friction-free philosophy.

Before opening a PR:
1. Test locally at 375px width (mobile-first)
2. Verify existing localStorage data survives your change (migrations, never drop/create)
3. Update CLAUDE.md (architecture decisions)

---

## The Data Bug Stories

**session_id=0 (April 2026):** All sessions were logging under `session_id=0` because `_persist()` was called *before* `last_insert_rowid()` — exporting the database resets the rowid. Fix: capture the id first. Every INSERT-returning-id in the codebase now follows this order.

**The missing column (July 2026):** Phase 3 added `plan_id` to sessions via migration — but only via migration. Fresh installs built the table without it and crashed on session start. The developer's own device, having migrated, never saw it; a fresh-database test run did. **Lesson:** every schema change lands in *both* the create path and the migrate path, and fresh-install testing catches the class of bug your own device can't.

---

## FAQ

**Q: Why no Apple Health / Fitbit integration?**
Sleep and recovery data are real signals, but they're not core to the UX of *logging reps*. Reserved for a future phase; the core loop comes first.

**Q: Why not use React / Svelte / Vue?**
Vanilla JS + sql.js was faster to ship and easier to reason about. Three phases in — including charts, plans, and AI — complexity still hasn't justified a framework. No bundler, no node_modules.

**Q: Can I sync across devices?**
Manual CSV export + Google Drive auto-upload today. True multi-device sync is on the roadmap (the Phase 2 unit-storage refactor cleared the data-layer path for it).

**Q: What about workout programs? Periodization? Autoregulation?**
GymOps trusts you have a plan — and now lets you *write it down*: training blocks with exercises, targets, duration, and objectives that guide each session. What it won't do is generate one for you. It logs what you *actually* did against what you planned.

**Q: Doesn't AI conflict with the friction-free philosophy?**
It's opt-in (bring your own API key), post-session only, and never interrupts logging. The AI reads your log; it doesn't run your workout.

**Q: Will this stay free?**
The core is free, open-source, and always will be. Optional paid tiers (advanced analytics, cross-device sync) may come later. Core logging stays free.

---

## Reading List

- **[Substack: GymOps Series](https://substack.com/@dan1608272)** — Technical deep-dives on friction-free design, the SQL rowid bug, and data strategy.
- **[sql.js Docs](https://sql.js.org/)** — SQLite for the browser.
- **[Vercel Deployment Docs](https://vercel.com/docs)** — Static site hosting.

---

## License

MIT. Use it, fork it, learn from it.

---

## Contact

Questions? Found a bug? Open an issue or reach out on Substack — https://substack.com/@dan1608272

---

**GymOps is built by lifters, for lifters. Log your reps. Own your data. Lift heavy.**
