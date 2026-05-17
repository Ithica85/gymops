# GymOps

A friction-free training log for lifters who already have a plan.

**Live:** [gymops-two.vercel.app](https://gymops-two.vercel.app)

---

## The Problem

Most gym apps are designed to *sell you* a training plan. GymOps assumes you already have one — and refuses to get in your way while you execute it.

**It logs.** Sessions, sets, weight, reps, time-based work (cardio), and notes. Nothing else.

**It doesn't** interrupt, gamify, coach, nag, or upsell. No RPE sliders. No AI summaries. No "you've earned this badge."

The friction-free philosophy: fewer screens, fewer fields, one tap to log a set. You're already tired; your app shouldn't be.

---

## Status: Phase 1 (Shipped)

**What Works:**
- Single-screen session logging
- 15 predefined exercises (compounds, accessories, cardio)
- Weight + reps in separate fields (faster on mobile)
- Session notes, full history, undo
- CSV export for data portability
- Google Drive auto-upload (keep backups synced)
- Settings screen (unit toggle, session/set view)
- Inactivity timer (auto-lock after 15 min of no input)

**Architecture:**
- Vanilla HTML/CSS/JS (no framework cruft)
- **sql.js** for SQLite in the browser
- Persistent local storage + cloud sync
- Service Worker (v12, cache-busting included)
- Deployed on **Vercel** (live, zero-cost tier)

**Notable Fixes (Phase 1 patches):**
- Fixed critical CSV export bug (session_id=0 issue on all records)
- Added zero-weight logging support (for rest days, skill work)
- Validated UI flows against real-world usage (Lee's first-user testing)

---

## Phase 2: Data Intelligence (Roadmap)

**Gating issues:**
1. **Unit storage debt** — Currently cosmetic/localStorage only. Must refactor data layer before scaling to multi-device sync.
2. **AI session summary** — Requires 4–6 weeks of baseline data. Structured output via Claude API; RPE-only user input.

**Planned:**
- Feature flags for gradual rollout
- AISessionSummary interface (mock + real implementations for testing)
- UI/logic separation (testability, iterability)
- Session continuity inference (detect deload patterns, recovery signals)

**Out of scope for Phase 1:**
- Fitbit/Apple Health integration (sleep + Active Zone Minutes, reserved for later)
- Haptic feedback
- Treadmill/cardio duration-based logging
- In-session unit toggle

---

## Phase 3: Monetization & GTM (Future)

**Distribution (Phase 1 → 2):**
- Reddit: r/fitness, r/weightroom, r/gainit
- Substack: weekly technical deep-dives ([see GymOps series](https://substack.com/notes))
- GitHub as persistent proof-of-work
- First testimonial from Lee (real user, real data)

**Phase 3 ideas:**
- Paid tier: advanced session summaries, multi-device sync
- Programmatic content (Reddit sentiment agent, trend analysis)
- Landing page with positioning vs. Apple Health, Strong, JEFIT, etc.

---

## Data Strategy

**Core insight:** The data moat is the product.

GymOps exists to build a personal strength dataset — rep maxes, volume trends, exercise progression, recovery signals. Over time, this dataset is *yours* and unlocks intelligence you can't get from generic fitness apps.

CSV export and Google Drive sync aren't features; they're **data sovereignty guarantees**. You own it. You can port it.

---

## Development

### Install & Run

```bash
# Clone the repo
git clone https://github.com/<your-org>/gymops.git
cd gymops

# Local dev (any static server will work)
npx http-server .
# or
python3 -m http.server 8000
```

Then visit `http://localhost:8000` in your browser.

### Tech Stack

- **Frontend:** Vanilla JS + CSS (intentional — no bundler, minimal deps)
- **Data:** sql.js (SQLite for WebAssembly)
- **Storage:** IndexedDB (persistence) + Google Drive API (cloud backup)
- **Deploy:** Vercel (static, auto-scaled)

### Key Files

```
gymops/
├── index.html          # Markup + inline CSS (single-page app)
├── app.js              # Session/set logic, event handlers
├── db.js               # SQLite wrapper, CRUD operations
├── sw.js               # Service Worker (cache + offline)
├── exercises.json      # Exercise metadata (name, default weight)
└── README.md           # This file
```

### Testing

Phase 1 validation: Real usage with Lee (first user). Phase 2 will add:
- Unit tests for db.js (CRUD, data integrity)
- Multi-state testing for AI summary interface (mock ↔ real)
- E2E tests for critical flows (log session → export → validate)

### Contributing

GymOps is intentionally minimal. PRs welcome for **bug fixes and performance**; feature requests will be evaluated against the friction-free philosophy.

Before opening a PR:
1. Test locally
2. Validate against Phase 1 PRD (no new screens, no AI coaching)
3. Update CLAUDE.md (architecture decisions)

---

## The Data Bug Story

**Critical issue found & fixed (April 2026):**

All sessions were logging under `session_id=0` because `_persist()` was called *before* `last_insert_rowid()`. The fix required coordination between `db.js` (capture rowid immediately) and `app.js` (call persist after). Service Worker bumped to v12 to force cache invalidation.

**Lesson:** Even "simple" SQLite operations in WebAssembly can hide pitfalls. This is logged in the [Substack series](https://substack.com/notes) as a technical deep-dive for other builders.

---

## FAQ

**Q: Why no Apple Health / Fitbit integration in Phase 1?**  
Sleep and recovery data are real signals, but they're not core to the UX of *logging reps*. Phase 2 reserves space for this; Phase 1 stays focused on the core loop.

**Q: Why not use React / Svelte / Vue?**  
Vanilla JS + sql.js was faster to ship and easier to reason about. No bundler, no node_modules. Phase 2 may introduce a component framework if UI complexity justifies it; no premature optimization.

**Q: Can I sync across devices?**  
Phase 1: manual CSV export + Google Drive auto-upload. Phase 2: proper multi-device sync (unit storage refactor unlocks this).

**Q: What about workout programs? Periodization? Autoregulation?**  
Not in scope. GymOps trusts you have a plan. If you want AI program generation, use ChatGPT; GymOps will log what you *actually* did.

**Q: Will this stay free?**  
Phase 1 is free, open-source, and always will be. Phase 2+ may include optional paid tiers (advanced analytics, cross-device sync). Core logging stays free.

---

## Reading List

- **[Substack: GymOps Series](https://substack.com/)** — Technical deep-dives on friction-free design, the SQL rowid bug, and data strategy.
- **[Vercel Deployment Docs](https://vercel.com/docs)** — Static site hosting.
- **[sql.js Docs](https://sql.js.org/)** — SQLite for the browser.

---

## License

MIT. Use it, fork it, learn from it.

---

## Contact

Questions? Found a bug? Open an issue or reach out on SubStack - @dan1608272

---

**GymOps is built by lifters, for lifters. Log your reps. Own your data. Lift heavy.**
