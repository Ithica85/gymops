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

**Shipped (July 16–23, 2026):** 5.1–5.8 plus opportunistic **5.2.x** (user-feedback batch) and **5.6** (quick-log hero). Schema/identity layer, multi-day programs, IDB storage, day-scoped adherence, start-chooser, rename UI, and the last catalogue-default hatches are all live. **Phase 5 is fully closed against the success criteria below** as of 5.9 (this update) — 5.10/5.11/5.12 remain as optional/should-do polish in the backlog table but do not block phase completion (see "Phase 5 fully complete when" below).

**Success criteria for Phase 5:** ✅ ALL MET (July 23, 2026 — Phase 5 complete, v5.0–v6.2)
- [x] A real PPL or upper/lower split is representable and the app lands on the right day without thought. *(5.2 / 5.3 / 5.5)*
- [x] An exercise can be renamed without orphaning history. *(data path `dbRenameExercise` shipped in 5.1; **5.7 rename UI SHIPPED** July 23, 2026, v6.2/gymops-v90, commit `6fcaf16` — History → exercise detail "Rename" button)*
- [x] The database no longer lives in localStorage; migration preserved all existing data. *(5.4 — IDB primary; LS fallback + frozen adoption snapshot)*
- [x] No session ever starts on an arbitrary catalogue default. *(5.3 plan-less start picker + **5.8**: zero-set plan-less resume opens picker; empty plan day opens start picker before create; bare `_doStartSession` never invents `EXERCISES[0]`)*

#### Phase 5 closeout backlog (fully complete the phase)

*Added 2026-07-22 after Phase 5 retrospective. Core closeout was **5.7 + 5.8 + 5.9** — **all three shipped** (5.8 July 22 v6.1/gymops-v89; 5.7 + this 5.9 docs update July 23 v6.2/gymops-v90). Remaining backlog: 5.10 (should), 5.12 (should, near-zero-risk verification), 5.11 (optional) — non-blocking polish, unsequenced vs Phase 6.*

*Codebase audit 2026-07-22 (confirms the items against `js/db.js` / `js/workout.js` / `js/picker.js`):*
- *`dbRenameExercise(id, name)` (db.js:597) works as described — updates `exercises` + denormalised `sets`/`plan_exercises` names atomically, `_persist()`, returns true/false. Clash and empty-name are `throw`s, not return values. **5.7 shipped July 23, 2026**: History → exercise detail "Rename" button, inline `try/catch` → error text in the modal (not a toast — user is mid-edit).*
- *~~Both `EXERCISES[0]` fallthroughs~~ **closed in 5.8** — resume + empty-day + bare start all open a picker; plan zero-set resume still uses plan-day first exercise.*
- *`_recencyRanks` (picker.js:31) rebuilds from the DB on every picker open; history/plans/charts re-query from the DB. **No persistent name cache survives a rename** — so 5.12 is near-zero risk (see revised note).*

| # | Item | Priority | Size | Notes / done when |
|---|------|----------|------|-------------------|
| **5.7** | Exercise rename UI | **Must** | S–M | ✅ **SHIPPED** July 23, 2026 (app `v6.2`, SW `gymops-v90`, commit `6fcaf16`). Surface: **History → exercise detail** "Rename" button. Bottom-sheet modal, old name prefilled; clash/empty errors caught inline (not a toast). **Catalogue-rename rule chosen: (b)** — a real rename sets `is_custom=1` on the identity row (no-op save-to-self leaves it untouched); the vacated catalogue name reseeds fresh/historyless via `_syncExercises` on the next boot. 2 tests added; 13-step CDP click-through incl. a post-rename reload confirming no ghost duplicate. |
| **5.8** | No catalogue-default start (close last hatches) | **Must** | S | ✅ **SHIPPED** July 22, 2026 (app `v6.1`, SW `gymops-v89`). `resumeSession`: last set → plan-day first → open First Exercise picker (never `EXERCISES[0]`). `beginSessionFlow`: empty resolved day → `openPickerForStart(dayId)` before create. `_doStartSession` with no resolvable exercise → session picker. 5 regression tests in `tests/workout.test.js`. |
| **5.9** | Docs closeout | **Must** | XS | ✅ **SHIPPED** July 23, 2026. All four Phase 5 success criteria ticked `[x]`; Phase 5 marked fully complete in this doc + `CLAUDE.md`; **5.7 catalogue-rename rule (b) recorded above**; aliases confirmed deferred to **6.2** (not a Phase 5 reopen). |
| **5.10** | Empty-day guard in plan editor | Should | XS | **Reframe (current behavior confirmed):** `savePlan` *already* silently drops empty days (`.filter(d => d.exercises.length)`), so saving an empty day is already prevented — but silently, which can surprise a user who added a day and finds it gone. 5.10 = **surface the rule** instead of silently dropping: muted “Add at least one exercise” on an empty day section and/or block Save with a message while any day is empty (pick one). Makes item-(1) source-prevention explicit. |
| **5.11** | Rename from active-session exercise (second entry) | Optional | S | Only if history-only rename (5.7) feels buried. Long-press / ⋯ on active exercise → same confirm + `dbRenameExercise`. **Must also update `state.exercise` in place** (the active-session name is held in memory) or the active screen shows the stale name until the next `setActiveExercise` — this is the one genuine post-rename cache (see 5.12). Skip if 5.7 alone is enough. |
| **5.12** | Post-rename UI refresh sanity | Should | XS | **De-risked by audit:** `_recencyRanks` rebuilds on every picker open and history/plans/charts re-query the DB, so a History-triggered rename (5.7) is already correct on the next screen visit with no reboot — verify, don't pre-engineer. The **only** stale-name cache is `state.exercise` during an active session, which is reachable **only via 5.11**; fold that fix into 5.11. If 5.11 is skipped, 5.12 is a no-op verification. |

**Explicitly not Phase 5 closeout** (do not pull into this backlog):

| Item | Belongs |
|------|---------|
| Exercise **aliases** / Strong·Hevy name map | **6.2** design (depends on 5.1; not required for Phase 5 criteria) |
| Parallel plan templates / multi-active programs | Later / refuse for now |
| Rewrite queries to always join on `exercise_id` | Not needed while denormalised names stay in sync via rename |
| OPFS instead of IDB | Closed by 5.4 |

**Phase 5 fully complete when:** (1) user can rename any exercise with history and nothing orphans (and the catalogue-rename rule from 5.7 is chosen + implemented); (2) no start/resume path lands on `EXERCISES[0]` under normal or empty-plan-day data — specifically the plan-less zero-set resume papercut is fixed; (3) multi-day + IDB still green (no rework expected); (4) success criteria above all `[x]`; aliases noted under 6.2.

✅ **All four conditions met as of July 23, 2026** (5.7 + 5.8 shipped, 153/153 tests green). **Phase 5 is fully complete.** 5.10/5.11/5.12 remain open as should-do/optional polish — they were never part of this completion bar — and stay unsequenced against the Phase 6 queue.

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
