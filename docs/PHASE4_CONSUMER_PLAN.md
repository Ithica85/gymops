# GymOps — Consumer Product Plan (Phase 4 and beyond)

*Written 2026-07-14. Companion document: [REVIEW_RESPONSE.md](REVIEW_RESPONSE.md) — the itemized triage of the external (Grok) deep review that prompted this plan.*

---

## 1. Where we are

GymOps is a mobile-first PWA workout logger (vanilla HTML/CSS/JS, SQLite via sql.js in localStorage, deployed on Vercel at gymops-two.vercel.app). It has been in real daily use since May 2026.

**Shipped:** Phases 1–3 complete or near-complete. v3.7 in production (SW cache gymops-v67). Core logging loop (quick-log, ghost PREV, Up Next), deterministic progression/session signals, workout plans, exercise history with charts, AI session summary (BYOK), idle dashboard, PR celebration, 114-exercise muscle-grouped catalogue, Google Drive per-session export. Technical hardening backlog complete (ES modules, feature-module split, single mutation point, insert wrapper, base64 persistence). 58 passing Vitest tests.

**The honest gap:** the app is optimised for logging elegance, but the category's churn drivers — confirmed by our own competitor review analysis (`competitor_intel_report.md`) and independently by an external deep review — are **data fear** and **program structure**. Today the entire dataset lives in one browser's localStorage with no restore path, a corrupt blob is silently wiped, and the plan model is a single flat exercise list that doesn't fit a real multi-day split.

**Two verified bugs exist in production** (see REVIEW_RESPONSE.md #C1, #M11): a corrupt database is silently replaced with a fresh one, and Undo can delete a different exercise's set than the one on screen.

## 2. What we've decided

Decisions made 2026-07-14, recorded here as the standing frame for all future phases:

1. **Consumer-grade quality bar, personal-first product.** GymOps remains a personal app, but is now held to the standard of a great consumer app. Rationale: "works for me" is a finish line already crossed; a consumer bar keeps momentum and prevents drift into flavour features. Rule for prioritising: prefer work that also pays back the sole current user.
2. **No monetization planned; option kept open via architecture, not pricing.** The three optionality-preserving investments are stable exercise IDs, real backup/restore, and not deepening BYOK coupling for AI. Stripe/tiers/entitlements are deferrable indefinitely.
3. **Staying a PWA.** No revenue pressure means no App Store forcing function. Reopen this decision only if (a) iOS storage eviction causes a real data loss, or (b) a watch app becomes a goal. A proper backup/restore story defuses most of (a).
4. **The vanilla constraint stays.** No frameworks, no build tools. It remains coherent with the PWA decision and the Layer 1 discipline.
5. **North star / brand:** *the fastest logger that never loses your history.* Speed is the wedge; trust is the moat. Every phase below serves one or both.
6. **Standing refusals (unchanged):** no social feed, no exercise-catalogue arms race, no ML black-box coaching (deterministic signals only), no ads, no paywall on the act of logging — ever, even if monetization happens.

## 3. Phase structure

### Phase 4 — Trust & Correctness

*Theme: make the data impossible to lose by accident, fix every verified bug, and finish the logging loop.*

| # | Item | Notes |
|---|------|-------|
| 4.1 | Corrupt-DB quarantine + recovery UI | Never silently wipe. On decode/open failure: preserve blob as `gymops_db_corrupt_<ts>`, show a recovery screen offering blob download before any fresh start. |
| 4.2 | Fix `undoSet` scope | Undo deletes the last set of the *current exercise*, not the session-global last set. |
| 4.3 | Full DB backup & restore | Export/import the raw DB (base64 blob file). This is the "new phone" and "disaster recovery" path. CSV export stays for spreadsheets; this is for restoration. |
| 4.4 | `_persist()` failure handling | try/catch around `localStorage.setItem`; on failure show a persistent visible error (data still in memory — prompt an immediate backup via 4.3). |
| 4.5 | Decimal-friendly weight input | `inputmode="decimal"`, drop `pattern="[0-9]*"`. 62.5 kg must be typeable on iOS. |
| 4.6 | Auto-start rest timer on log | Starts after each logged set (reps exercises); Skip dismisses; manual button remains. Configurable duration deferred to 4.9/Phase 5. |
| 4.7 | Remove `user-scalable=no` / `maximum-scale=1.0` | Accessibility baseline; costs nothing. |
| 4.8 | Layer 1 integration tests | Vitest coverage of the money path: log → undo → resequence → resume → finish, against a real in-memory sql.js DB. The current suite protects pure functions more than the core loop. |
| 4.9 | Small debt batch | Reuse one `AudioContext`; extract duplicated weight-display formatting; remove or wire `showToast`. Opportunistic, alongside the above. |

**Explicitly experimental (build behind a judgment call, evaluate in personal use):** prefilling inputs with last-session values instead of ghost placeholders. Quick-log already covers the "same as last time" case in one tap; prefill changes validation semantics and may add friction to progression entries. Trial before committing.

**Success criteria for Phase 4:** ✅ ALL MET (July 16, 2026 — Phase 4 complete, v4.0–v4.7)
- [x] It is impossible to lose workout history without an explicit, confirmed, destructive action. (4.1 quarantine, 4.4 persist-failure banner)
- [x] A brand-new device can be restored to full history from a backup file in under a minute. (4.3)
- [x] Both verified bugs fixed with regression tests. (4.1 silent-wipe, 4.2 undo scope)
- [x] A decimal weight can be logged on iOS Safari without workarounds. (4.5)
- [x] Rest timer requires zero taps to start. (4.6)
- [x] `npm test` covers the full log/undo/finish/resume loop. (4.8 — 95 tests)

### Phase 5 — Identity & Program Model

*Theme: make the data model able to survive years and fit real training.*

| # | Item | Notes |
|---|------|-------|
| 5.1 | Stable exercise IDs | `exercises` table with `exercise_id`, display name, type, muscle group; sets/plans reference IDs. Migration maps existing string history. Unblocks renames, aliases, and future import. **Do before any public user exists** — the cost multiplies per user after. |
| 5.2 | Multi-day program model | Plans gain training days (e.g. Push / Pull / Legs), each with its own exercise list. Session start lands on the right day. |
| 5.3 | Session start chooser | When no plan day is unambiguous: "Continue last session's order" / "Pick plan day" / "Empty session". Kill the `EXERCISES[0]` catalogue default as the opening exercise. |
| 5.4 | Storage backend migration (IndexedDB or OPFS) | sql.js stays as the query engine; the persisted blob moves out of localStorage (quota headroom, async writes, eviction resilience). localStorage keeps only prefs. Sequenced *after* 4.3 so a restore path exists before touching the storage home. |
| 5.5 | Plan adherence rework | Adherence measured against the day trained, not the flat plan. |

**Shipped (July 16–22, 2026):** 5.1–5.5 plus opportunistic **5.2.x** (user-feedback batch) and **5.6** (quick-log hero). Schema/identity layer, multi-day programs, IDB storage, day-scoped adherence, and start-chooser are live. Phase 5 is **not fully closed** against the success criteria below until the closeout items land.

**Success criteria for Phase 5:**
- [x] A real PPL or upper/lower split is representable and the app lands on the right day without thought. *(5.2 / 5.3 / 5.5)*
- [ ] An exercise can be renamed without orphaning history. *(data path `dbRenameExercise` shipped in 5.1; **needs 5.7 rename UI** to be product-true)*
- [x] The database no longer lives in localStorage; migration preserved all existing data. *(5.4 — IDB primary; LS fallback + frozen adoption snapshot)*
- [ ] No session ever starts on an arbitrary catalogue default. *(plan-less path fixed in 5.3; **empty plan day / zero-set resume still fall through to `EXERCISES[0]` — needs 5.8**)*

#### Phase 5 closeout backlog (fully complete the phase)

*Added 2026-07-22 after Phase 5 retrospective. Core closeout = **5.7 + 5.8 + 5.9** (~1–1.5 days). Working order: 5.8 → 5.7 → 5.10 → 5.12 → 5.9 → optional 5.11.*

| # | Item | Priority | Size | Notes / done when |
|---|------|----------|------|-------------------|
| **5.7** | Exercise rename UI | **Must** | S–M | Success criterion incomplete without it. Surface: **History → exercise detail** (pencil or equivalent). Confirm sheet old → new name; clash errors via toast. Call existing `dbRenameExercise(id, name)` — do not reimplement. After rename: history list, plans, charts, signals, picker Recent still correct after reload. 2–3 tests on rename path. |
| **5.8** | No catalogue-default start (close last hatches) | **Must** | S | Kill remaining `EXERCISES[0]` fallthroughs in `js/workout.js`: (1) `_doStartSession` when plan day has no exercises; (2) zero-set `resumeSession` when no last set and no plan exercises. Empty / unresolvable start → same as plan-less 5.3: **picker before session create** (or picker before setting active exercise on resume). Regression tests for both paths. |
| **5.9** | Docs closeout | **Must** | XS | When 5.7 + 5.8 ship: tick remaining success criteria above; mark Phase 5 fully complete in this doc + `CLAUDE.md`; note **aliases deferred to 6.2** (not a Phase 5 reopen). |
| **5.10** | Empty-day guard in plan editor | Should | XS | Prevention at source for 5.8. Day section with 0 exercises: muted “Add at least one exercise” and/or block Save while any day is empty (pick one rule). |
| **5.11** | Rename from active-session exercise (second entry) | Optional | S | Only if history-only rename (5.7) feels buried. Long-press / ⋯ on active exercise → same confirm + `dbRenameExercise`. Skip if 5.7 alone is enough. |
| **5.12** | Post-rename UI refresh sanity | Should | XS | After rename, picker Recent / MRU, history list, and plan rows show the new name immediately (no full reboot). Audit any name caches; fix if stale. |

**Explicitly not Phase 5 closeout** (do not pull into this backlog):

| Item | Belongs |
|------|---------|
| Exercise **aliases** / Strong·Hevy name map | **6.2** design (depends on 5.1; not required for Phase 5 criteria) |
| Parallel plan templates / multi-active programs | Later / refuse for now |
| Rewrite queries to always join on `exercise_id` | Not needed while denormalised names stay in sync via rename |
| OPFS instead of IDB | Closed by 5.4 |

**Phase 5 fully complete when:** (1) user can rename any exercise with history and nothing orphans; (2) no start/resume path lands on `EXERCISES[0]` under normal or empty-plan-day data; (3) multi-day + IDB still green (no rework expected); (4) success criteria above all `[x]`; aliases noted under 6.2.

### Phase 6 — Consumer Readiness

*Theme: a stranger can discover, install, migrate to, and use GymOps with no guidance.*

| # | Item | Notes |
|---|------|-------|
| 6.1 | First-run experience | Empty states, a short orientation, guided A2HS install. The idle screen must make sense to someone who isn't the developer. |
| 6.2 | Import from Strong / Hevy CSV | The acquisition feature: switchers arrive with years of history. Depends on 5.1 (exercise aliases). |
| 6.3 | Accessibility pass | Focus traps + focus return on modals, ARIA labelling, contrast audit. (Zoom already fixed in 4.7.) |
| 6.4 | SW update strategy | Network-first for HTML (or version-check + update prompt) so stale clients can't strand. |
| 6.5 | PWA install polish | Proper raster icons, splash/screenshots in the manifest. |
| 6.6 | Drive connect moves to Settings | Finish is always local-first; cloud consent never interrupts session closure. |
| 6.7 | About / landing page | Already-parked docs backlog item; for a free PWA, the about page *is* distribution. |
| 6.8 | Reset options split | "Reset workout data" separate from "Clear everything incl. credentials". |
| 6.9 | Privacy-preserving usage counters | Local-only funnel counters (sessions started/completed, feature touches) — enough to reason about activation without telemetry infrastructure. |

**Success criteria for Phase 6:**
- [ ] A stranger can install the PWA, import their Strong/Hevy history, and complete a logged session with zero guidance.
- [ ] No flow ever presents an OAuth consent screen mid-workout or at finish.
- [ ] A screen-reader user can log a set.
- [ ] A deploy reaches every client within one app open, without manual hard-refresh.

### Phase 7 — Distribution & Optionality (unscheduled, gated)

Explicitly parked. Each item has a reopen trigger, not a date:

- **Monetization** — trigger: real sustained external users + server-side costs (sync/AI). Model if ever: free logging complete forever; paid Layer 2 (sync, AI). Never a Hevy-style evaluation ceiling.
- **Cloud sync / accounts** — trigger: multi-device becomes a personal need or user demand exists. Naive version acceptable: account + encrypted blob.
- **Store-wrapped native (Capacitor or similar)** — trigger: watch app desired, or iOS eviction bites despite backups.
- **Watch app** — trigger: native decision made. Standing rule from competitor data: none until it can be *correct* — a half-built watch app is Hevy's biggest 1-star generator.
- **Server-side AI (non-BYOK)** — trigger: monetization. Requires auth + rate limiting on `/api/ai-summary` first (see REVIEW_RESPONSE.md #H1).
- **Push notifications** — trigger: backend exists for other reasons.

## 4. What success looks like overall

Three tests, in order of importance:

1. **The trust test** — you (or anyone) could drop your phone in a lake today and have full training history on a new device tomorrow. No sober user of a logger should fear their own app.
2. **The stranger test** — a lifter who has never heard of GymOps installs it, imports their Strong history, and logs a full session without asking a question.
3. **The momentum test** — the developer is still shipping because the backlog has a spine (this document), not because of novelty. If a proposed feature serves neither speed nor trust nor program fit, it gets refused, exactly as social/catalogue/ML coaching already are.

The old Next/Backlog list in CLAUDE.md (weekly AI summary, plan iterations, etc.) is not deleted — it re-queues *behind* Phases 4–6. Flavour features resume when the trust work is done.

## 5. Process notes

- Every phase item lands with tests where testable, an SW cache bump when cached files change, and verification at 375px + against pre-existing localStorage data (per CLAUDE.md checklist).
- Schema changes continue to require BOTH `_createSchema()` and `_migrate()` paths.
- CLAUDE.md's "Current Phase" section gets updated when Phase 4 begins.
- REVIEW_RESPONSE.md is the authoritative disposition of every external-review finding; nothing from that review is tracked anywhere else.
