# GymOps — Agentic Product Vision

*Written 2026-07-26. Companions: [PHASE4_CONSUMER_PLAN.md](PHASE4_CONSUMER_PLAN.md) (standing product frame, Phases 4–7) and [AGENTIC_REVIEW_REQUEST.md](AGENTIC_REVIEW_REQUEST.md) (the external-review brief sent against this document). This document does not replace that plan; it proposes a post–Phase-6 optional track for agentic AI that must stay coherent with it.*

**Status:** Draft, revised 2026-07-26 after review. Not scheduled work. No implementation commitment until this document is accepted (or revised) and Phase 6 success criteria remain on track.

**Revision note (2026-07-26).** Two owner decisions landed after the first draft and are now load-bearing throughout:

1. **GymOps is being built as a consumer app, not a personal tool with strangers tolerated.** Anything that only works for the developer is out of scope.
2. **BYOK is being retired.** Asking a normal person to obtain and paste an Anthropic API key is unacceptable friction. BYOK is now a *transitional* state, not an architecture principle.

Together these invert the original ladder: capabilities are now sequenced by **cost per user and reach**, not by capability escalation. See §4.1 and §5.

---

## 1. One-line positioning

**GymOps remains the fastest logger that never loses your history.**  
The agentic layer is a **proposal-and-prep desk** on top of that history — not a coach that owns the workout, and not a chatbot that replaces the active log screen.

Evolved north star (additive, not a rewrite of brand):

> *The fastest logger that never loses your history — and an agent that only acts on that history with your say-so.*

**Consumer bar (new).** Every agentic capability must be usable by a stranger, on their first install, with no account setup, no key, and no configuration. A capability that fails that bar is either redesigned to pass it or refused — it does not ship as a developer-only feature.

---

## 2. What we are *not* building

These are standing refusals for the agentic track. They extend the consumer-plan refusals (no social feed, no catalogue arms race, no ML black-box coaching, no ads, no paywall on logging).

| Refusal | Why |
|---------|-----|
| **No LLM on the Layer 1 critical path** | Logging must stay offline-capable, instant, and free of network/model latency. A set is logged by existing Layer 1 functions only. |
| **No silent writes** | The agent may draft plans, map imports, prefill inputs, or suggest day switches. It never auto-commits sessions, sets, renames, plan activation, or merges without an explicit user confirm. |
| **No free-form SQL / raw DB access for the model** | Tools are a whitelist of existing app/DB functions (`dbGet*`, plan save paths, etc.). Identity and trust stay in application code. |
| **No autonomous programming** | The agent does not restructure the week, deload, or swap exercises by itself. At most it proposes; the plan editor (or a confirm sheet) is the commit surface. |
| **No replacing deterministic signals** | F-03 / F-06 (and related rule engines) remain ground truth for PR / progression / session interpretation. The agent may *explain* those signals; it must not invent a conflicting coaching verdict. |
| **No paywall on the act of logging** | Same as Phase 7 optionality: if AI is ever monetized, logging stays complete and free. |
| **No “AI coach” rebrand** | We are not competing as generic coaching chat. History integrity + log speed remain the wedge; the agent is how that history becomes useful between sessions. |
| **No feature that requires the user to obtain an API key** *(new)* | The BYOK retirement decision. A normal person will not create an Anthropic account to use a workout logger. Any capability whose only delivery model is a user-supplied key is redesigned or refused. |
| **No unbounded per-user model cost, ever** *(new)* | With a shared key, every call is spend. Each AI action has a bounded context and a bounded per-install budget, enforced server-side. Open-ended token consumption is a design defect, not a scaling problem to fix later. |
| **No unauthenticated model proxy** *(new)* | A shared key behind an open endpoint is a public ATM. Auth + rate limiting land *before* a shared key exists, not alongside it. |
| **No silent data egress** *(new)* | Nothing about a user's history leaves the device without an explicit, visible user action, and the user can see what was sent. Mirrors the 6.6 principle: the user decides what leaves the device. |
| **No agent failure that blocks the user** *(new)* | Every model or speech call has a timeout and an abort path. Failure is silent and non-modal — never a spinner the user must dismiss, never a modal on the active screen. |

**Explicitly out of Agent 0–3 (revisit only with a positioning change):** plateau/deload detection agents, guilt/nudge copy driven by an LLM, ambient auto-scheduling, watch-side autonomous logging.

---

## 3. Product shape: three surfaces, one brain

The two paths are **parallel and independent**, not a pipeline. Layer 1 reaches the database directly; the agent reaches it only through a whitelist, and only ever to *read* or to *stage a proposal*.

```
   LAYER 1 (logger)                    LAYER 2 (agent)
   active screen                       idle · completed · plans
        │                                     │
        │ direct calls                        │ tool whitelist (read)
        │ logSet / quickLogSet                │ dbGet* only
        │                                     │
        │                                     ▼
        │                              PROPOSAL (structured draft)
        │                                     │
        │                                     │ user confirms
        │                                     ▼
        │                              existing write APIs
        ▼                                     ▼
   ══════════════ local database (source of truth) ══════════════

   The agent is never in the left-hand path. Deleting the whole
   right-hand column must leave logging bit-for-bit unchanged.
```

| Surface | Role | Agent involvement |
|---------|------|-------------------|
| **Logger** (active screen) | Log set → rest → next. Quick-log, undo, PR, timers. | Best-effort pre-stage only. The agent may write to **input elements**; it may never call `logSet` / `quickLogSet`. Never blocks or replaces either. |
| **Desk** (idle + completed) | Briefs, debriefs, weekly review. | On-demand cards (not a chat thread — see §8 Q1). |
| **Architect** (plans + import) | Multi-day programs, CSV migrate-in. | Multi-step tool use: draft plan JSON, map import rows; human reviews before save. |

**Layer 1 / Layer 2 rule (unchanged):** Layer 1 never depends on Layer 2 or the agent. Layer 2 may read workout state; the agent may call tools that write only after confirm gates.

**Known interaction — prefill is not inert (added after review).** Since 5.6, `_manualIntent()` (`js/workout.js`) returns true whenever either input is non-empty, and `updateLogEmphasis()` then demotes the quick-log hero and re-promotes Log Set. So any programmatic prefill *silently changes the active screen's button hierarchy*. Voice prefill therefore requires an explicit "programmatic fill does not count as manual intent" carve-out, or an accompanying design pass. This must be resolved in the same change that ships prefill — not discovered afterwards.

---

## 4. Relationship to current AI and Phase 6

**Today:** one BYOK post-session prose summary (`js/ai.js` → `/api/ai-summary`). Non-blocking, Layer 2 only. Deterministic signals elsewhere. An AI routine importer was prototyped on `feature/ai-routine-import` and parked — positioning (importer vs generator vs “not a coaching app”) is resolved in spirit by this doc: **importer + plan draft = in; autonomous generator that activates programs = out.**

**Phase 6 first:** consumer readiness (import, first-run, a11y, install polish) still takes priority. Agentic work is most valuable *after* strangers can bring Strong/Hevy history (6.2). Agent 0 may be built in parallel (it ships no model UX); shipping later rungs must not displace Phase 6 success criteria — specifically **6.1 first-run and 6.2 import ship before any rung above Agent 1**.

**Dependency correction (was wrong in the first draft):** 5.1 shipped stable exercise *identity* (`exercises` table, `exercise_id`, `dbRenameExercise`). It did **not** ship **aliases** — the consumer plan explicitly defers those to **6.2**. Any import- or voice-mapping capability depends on the 6.2 alias layer, not on 5.1 alone. The parked importer branch already demonstrates the gap: `_mapExercise` does exact-normalised matching only, so a near-miss mints a custom exercise instead of resolving to the catalogue entry.

### 4.1 The BYOK sunset (owner decision, 2026-07-26)

**Decision:** BYOK is retired as a delivery model. It is too much friction for a normal person and is incompatible with the consumer bar in §1.

This is not a small swap — it pulls the **Phase 7 "server-side AI" trigger**, and the consumer plan already states what that requires: *auth + rate limiting on the model proxy before a shared key exists* (REVIEW_RESPONSE **#C4**). It has three unavoidable consequences:

1. **Every AI call becomes a cost you pay.** With a shared key, an open-ended chat feature is an open-ended invoice. Cost per action becomes a primary design constraint, which is why the ladder below is ordered by cost and why §8 Q1 resolves to bounded one-shot cards rather than a chat thread.
2. **The current proxy is not safe to point a shared key at.** `api/ai-summary.js` has no auth and already falls back to `process.env.ANTHROPIC_API_KEY`; setting that variable today would turn the public deployment into an open proxy. Hardening it is an **Agent 0 deliverable**, not a Phase 7 deferral.
3. **The monetization question stops being hypothetical.** Consumer plan §2.2 says no monetization is planned but the option is preserved, and Phase 7 pre-agreed the shape: *free logging complete forever; paid Layer 2 (sync, AI)*. Removing BYOK doesn't contradict that plan — it activates the case it anticipated.

**Recommended posture (not yet accepted):** do **not** monetize now. Instead:

- Make the keyless, zero-model-cost capabilities carry the consumer story (Agent 1). These reach every stranger and cost nothing per user.
- Ship model-backed features only in **bounded one-shot** form with a hard free monthly ceiling per install, enforced server-side.
- Treat paid Layer 2 as the release valve if real usage makes the bounded free tier expensive — a decision triggered by an actual bill, not by this document.

This keeps "no monetization planned; option kept open via architecture" true, while making the agentic track genuinely consumer-grade.

---

## 5. Agentic track: Agent 0–3

Not calendar phases of the consumer plan — a **gated capability ladder**. Each step has an exit bar before the next opens.

**Reordered after review.** The first draft climbed by capability (policy → read → write → session edge). Under a consumer bar and a shared key, the right axis is **cost per user × reach**, ascending:

| Rung | Model cost | Reaches a keyless stranger | Gate |
|---|---|---|---|
| **0** Foundation & policy | none | n/a (no UX) | — |
| **1** Keyless & free | **none** | **yes, all of them** | — |
| **2** Bounded one-shot | capped per action + per install | yes, within the free ceiling | Agent 0 exit + proxy hardened |
| **3** Open-ended | unbounded by nature | only under a cost model | Phase 7 decision |

The most north-star-aligned capability in this document — **voice prefill — needs no LLM at all.** Speech recognition produces a transcript; turning *"bench 100 for 8"* into `{exercise, weight, reps}` is name-resolution plus a small grammar. It is free at any scale, has no hallucination surface, and works offline once the speech layer does. It was the last rung in the first draft; it is now the flagship of the first user-visible one.

Conversely, history Q&A chat was the first user-visible rung and is now the last: it is the most expensive, the least bounded, and the closest to the coaching line §2 refuses.

### Agent 0 — Foundation, policy & proxy hardening

**Theme:** Make “what the agent is allowed to do” — and “what a shared key is allowed to cost” — explicit before any model UX ships. No user-visible surface; safe to build during Phase 6.

| Deliverable | Notes |
|-------------|--------|
| Tool allowlist | Named tools mapping 1:1 (or thin wrap) to existing read/write paths. Reads: history, plans, adherence, exercise identity. Writes: only behind confirm. |
| Confirm policy | Every write tool requires a user-visible confirm step (sheet or editor). `logSet` / `quickLogSet` are **never** agent-callable at any rung; the agent may write to input elements only. |
| **Proxy hardening** *(new — blocking)* | Auth + rate limiting on `/api/ai-summary` and any future endpoint, before a shared key exists anywhere. Removes the standing open-proxy exposure described in §4.1. |
| **Cost controls** *(new)* | Per-action context ceiling, per-install monthly budget, server-enforced. A call that would exceed budget fails closed with a plain-language message — never a silent overspend. |
| **Failure contract** *(new)* | Every model/speech call has a timeout and abort path; failure is silent and non-modal. (Lesson from 6.6: a token request with no timeout stalls a shared chain and strands the UI.) |
| Data boundaries | Prefer local tool execution over bulk DB upload. Context packs for server calls stay minimal, purpose-scoped, and disclosable to the user. |
| Auditability | Agent proposals are inspectable (structured draft the user can edit). No opaque “AI applied changes.” |
| Tests | Policy tests, binary (see exit). |

**Exit (binary — replaces the first draft's “test-guarded enough”):**

- [ ] A test asserts the tool registry exposes **zero** write-capable tools; adding one fails CI unless it declares a confirm surface.
- [ ] A test asserts `logSet` / `quickLogSet` are absent from the registry.
- [ ] The model proxy rejects unauthenticated requests, and a per-install budget ceiling is enforced and tested.
- [ ] Every outbound model call has a timeout; a hung call cannot leave UI in a loading state.

---

### Agent 1 — Keyless & free (first user-visible rung)

**Theme:** The capabilities that reach every stranger at zero marginal cost. **No model calls at all.** This rung carries the consumer story; everything above it is an enhancement.

| Capability | User-facing shape |
|------------|-------------------|
| **Voice prefill** | Push-to-talk → speech transcript → deterministic parse (grammar + name resolution) → weight/reps (or duration) fields filled → user confirms with Log Set / quick-log. No model, no network, no silent auto-log. |
| **Deterministic import** (with 6.2) | Hard-coded parsers for the known Strong / Hevy export formats. Covers the large majority of real migrations with zero AI involvement. |
| **Session brief** (idle) | Next plan day, last trained, thin coverage — all already computable deterministically from existing queries. **Must slot into the existing `IDLE_BANNERS` mediator** (first non-null wins, never stacked), not add a competing card. |
| Structured debrief | Deterministic bullets on the completed screen (volume vs last, PRs, skipped plan work) from F-03/F-06 and existing queries. Prose stays at Agent 2. |

**Feasibility gate before commitment:** Web Speech in an installed iOS PWA is the open question — support has historically been unreliable in standalone mode. A spike on a real iOS install decides whether voice prefill ships, degrades to a platform-conditional feature, or is dropped.

**Exit:**

- [ ] A stranger with no key and no account can use every capability on this rung.
- [ ] Voice prefill cannot log a set; it fills inputs and the user taps, with the same confirm affordance as manual entry.
- [ ] The `_manualIntent` interaction (§3) is resolved — prefill does not silently reorder the active screen's hierarchy.
- [ ] Session brief renders through `IDLE_BANNERS`, and the idle screen never stacks banners.
- [ ] Layer 1 unchanged in latency and offline behaviour; a full session is completable with the whole rung disabled.
- [ ] Zero model spend attributable to this rung.

---

### Agent 2 — Bounded one-shot (where model spend begins)

**Theme:** Multi-step agent work where humans already expect a review step — delivered as **capped single calls**, never as a conversation. Each capability has a fixed context budget and counts against the per-install free ceiling.

| Capability | User-facing shape |
|------------|-------------------|
| Import fallback mapper (with 6.2) | Only for formats the deterministic parsers don't recognise. Column + exercise name mapping; ambiguous rows flagged for confirm; resolution goes through the **6.2 alias layer**, not ad-hoc custom minting. |
| Routine importer / plan draft | A routine the user already follows (pasted or named) → structured draft → **existing plan editor** for edit/save. Importer, not generator: it transcribes the user's intent, it does not invent a program. |
| Prose debrief | Optional short prose on top of Agent 1's deterministic bullets. One call, on demand, never automatic. |
| Alias / merge advisor | Suggest consolidating fragmented custom names; **never** auto-merge. |
| Share-ready debrief | `navigator.share` path (no social feed). **Owner note:** this duplicates “Shareable AI summary post” in the CLAUDE.md backlog — on acceptance, that entry is deleted in favour of this one. |

**Destructive-path requirement (added after review).** Accepting a plan draft archives the current active plan under existing rules. That is the only irreversible thing on the entire ladder, and the first draft had no guard for it. The confirm must **name the plan being archived**, and the action must be reversible (un-archive) — consistent with the project's quarantine / backup / prerestore posture.

**Exit:**

- [ ] A plan goes from draft to **saved** only after explicit Save in the editor.
- [ ] The archive confirm names the affected plan, and un-archive exists and is tested.
- [ ] Import never silently invents exercise identity; clashes and unknowns surface.
- [ ] Every capability is one bounded call; per-install budget is enforced, and exceeding it fails closed with a plain-language message.
- [ ] Agent copy is checked against the deterministic signal for the same session and cannot assert a conflicting verdict (enforces §2's refusal and §7 test 4 — the first draft stated this but never gated on it).
- [ ] Agent 0 write policy still holds (no direct DB writes from the model).

---

### Agent 3 — Open-ended (gated on a cost model)

**Theme:** Capabilities whose token consumption is unbounded by nature. **Do not build these until a cost model exists** — under a shared key they are the only rung that can produce an unpredictable bill.

| Capability | User-facing shape |
|------------|-------------------|
| History Q&A | “How many times did I bench ≥100 kg this month?” → whitelisted `dbGet*` tools, multi-step. Genuinely useful; genuinely the most expensive thing here. |
| Weekly review | Coverage, adherence, PRs, skipped volume + optional draft plan tweak → Agent 2 confirm path. |
| Signal explanation | Plain-language gloss of F-03/F-06 — never a second score that contradicts them. |

**Gate:** Phase 7 decision made (bounded free tier proven affordable, or paid Layer 2 live). Until then this rung stays on paper. Re-examine whether Agent 1+2 already delivered the value — if the deterministic bullets and one-shot debrief satisfy users, open-ended chat may never be worth its cost.

**Exit:**

- [ ] Per-conversation and per-install cost ceilings enforced; a session cannot exceed budget.
- [ ] Answers are grounded — correct against real sessions, or an explicit “not enough data.” Verified against a fixture set of known questions with expected answers on a seeded database.
- [ ] Agent copy never contradicts a just-earned PR or a deterministic signal.
- [ ] Full session completable with the entire rung disabled or offline.

---

### After Agent 3 (not in scope of this vision)

Parked until Agent 0–3 exit bars are met and Phase 7 triggers are real:

- Persistent agent memory (preferences, accepted proposals) as a first-class store — **note:** a memory store is a new persistent store and inherits the existing rules: both `_createSchema()` and `_migrate()`, and coverage by **both** `dbClearAll()` and the new `dbResetWorkoutData()` (6.8). Memory that survives “Reset Workout Data” would be a surprise.
- Cloud sync so the desk follows the user across devices
- Watch / ambient agents (native decision required; correctness bar from consumer plan)

---

## 6. Architecture principles (implementation constraints)

1. **Local-first history remains the source of truth.** IndexedDB/sql.js, backup/restore, quarantine paths are non-negotiable; the agent does not become the system of record.
2. **Prefer local tool execution** for Q&A over uploading the full DB. Server proxies exist for model tokens (as today), not for owning user data.
3. **Vanilla / PWA / no runtime npm deps** remain the default for the logger. Agent UI may grow as modules under the same constraints until a Phase 7 trigger forces otherwise; the logger must not wait on a framework rewrite.
4. **BYOK is transitional, not architectural** *(revised)*. It remains the only delivery model until Agent 0's proxy hardening and cost controls land, then it is retired — a shared key behind auth + budgets replaces it. No new capability may be designed *around* the user having a key.
5. **Every schema or identity change** still follows existing rules: `_createSchema` + `_migrate`, no silent wipes, exercise IDs stable.
6. **Deterministic first, model as fallback** *(new)*. Where a capability can be delivered by rules, grammar, or a parser, it is — the model handles the residue. This is both the cost strategy and the reliability strategy, and it is why Agent 1 exists as a rung at all.
7. **One name-resolution layer serves everything** *(new)*. Aliases (6.2), import mapping, voice exercise matching, and merge suggestions are the same problem: messy human string → stable `exercise_id`. Build it once, in 6.2, and three capabilities in this document become small. **This is the compounding investment of the agentic track — more than any model work.**
8. **Numbers, not adjectives** *(new)*. Every agent surface declares a latency ceiling, a context ceiling, and a budget. The project specifies trust behaviour numerically elsewhere (3.5s SW network timeout, 15s token timeout, 60-min resume window); the agent track does the same.

Conceptual module home (illustrative, not a file commitment):

```
js/agent/     tools + policy + session/brief UX
api/          existing ai-summary; optional later agent proxy with auth
```

---

## 7. Success tests (agentic track)

In addition to the consumer plan’s trust / stranger / momentum tests:

1. **Logger test** — Sweaty hands, flaky gym Wi‑Fi: a set still logs in one tap; agent never sits on that path.
2. **Trust test** — Agent never invents sets; every write is via existing APIs and a human confirm.
3. **Grounding test** — History answers are correct against real sessions (or clearly “not enough data”), not generic coaching filler.
4. **Philosophy test** — F-03/F-06 remain deterministic; agent copy does not contradict a just-earned PR or signal.
5. **Stranger+agent test** *(kept and strengthened)* — A stranger with **no key and no account** installs, imports their Strong/Hevy history, and logs a first session with agent help and no tutorial. The first draft could not pass this under BYOK; §4.1 is what makes it reachable.
6. **Cost test** *(new)* — A hostile or hyperactive user cannot produce an unbounded bill. Budgets are enforced server-side and fail closed with a plain-language message.
7. **Recoverability test** *(new)* — Every agent-accepted change can be undone, including plan archival. Nothing the agent proposes can destroy state the user can't get back — the same bar Phase 4 set for the database.
8. **Failure test** *(new)* — With the model endpoint returning 500s, or hanging indefinitely, the app is indistinguishable from normal apart from missing agent output. No spinners, no modals, no blocked taps.

---

## 8. Open questions — proposed answers

Resolved below against the consumer bar (§1) and the BYOK sunset (§4.1). Owner to accept or amend.

**1. Chat vs single-shot UI → one-shot cards.** Not close. Cards match the existing bottom-sheet language, bound cost per action (now *your* cost), and give each surface a testable grounding bar. A persistent thread invites open-ended training questions — precisely the coaching positioning §2 refuses — and is the surface most likely to contradict F-03/F-06. Chat lives at Agent 3 behind the cost gate, if ever.

**2. Agent 2 vs 6.2 sequencing → deterministic first, model as fallback.** 6.2 ships hard-coded parsers for the known Strong/Hevy formats (stable, documented, the majority of real imports); the model mapper sits behind them for unrecognised formats only. This keeps the stranger test passing at zero cost, makes the common path fixture-testable, and resolves the §4-vs-§8 sequencing tension in the first draft: the deterministic half is Agent 1 *inside* 6.2, the fallback is Agent 2 *after* it.

**3. Memory → strictly post–Agent 3, with one carve-out.** Accepted/rejected *proposal outcomes* may be stored from Agent 2 as plain local data, so a rejected merge isn't re-suggested. Preference memory (“I hate machine rows”) is coaching-by-accumulation on an instalment plan — hold it. Either way it inherits the schema + reset rules noted under “After Agent 3”.

**4. Default on/off → opt-in, off by default, and reuse the 6.6 pattern verbatim.** A Settings card with an explicit enable action, a status line, and a disable — identical in shape to the Google Drive card shipped in 6.6. One consistent mental model for every external service, on a consent surface already built and verified, rather than inventing a second one. Post-BYOK the empty state stops saying “requires key” and becomes a plain on/off with the remaining monthly allowance shown.

**5. Parked routine importer branch → adopt as the Agent 2 seed, with rework.** It already implements the core policy (proposal → existing plan editor → human Save) and clamps untrusted model output. Four things before it lands: (a) reframe as importer-only, no generation — the litmus is whether it moves the user's own data or forms an opinion about training; (b) `_mapExercise` routes through 6.2's alias layer instead of minting customs on a near-miss; (c) **re-stamp it — its `v6.4` / `gymops-v92` stamps now collide with what is on `main`**; (d) its `api/generate-plan.js` inherits the unauthenticated-proxy exposure and is covered by Agent 0. Discarding it would throw away a working proposal-review flow that already matches this policy.

**Still genuinely open (owner decision, not resolvable from this document):**

- **The cost model.** Bounded free tier funded by the developer, or paid Layer 2? §4.1 recommends deferring until an actual bill argues otherwise — but Agent 2 cannot ship until a ceiling number exists.
- **iOS speech feasibility.** Decides whether voice prefill — the flagship of Agent 1 — ships, degrades to platform-conditional, or is dropped. Needs a spike, not a decision.

---

## 9. Acceptance criteria for *this document*

This vision is **accepted** when:

- [ ] Positioning and refusals are agreed (or explicitly amended in-place), including the five refusals added in this revision.
- [ ] Agent 0–3 scope and exit bars are agreed as the ladder (not a commitment to build all four immediately).
- [ ] Phase 6 priority is affirmed: **6.1 and 6.2 ship before any rung above Agent 1.**
- [ ] §8 answers accepted or amended; the two still-open items (cost model, iOS speech spike) have owners.
- [ ] The BYOK sunset in §4.1 is accepted as a Phase 7 trigger, with the interim posture agreed (bounded free tier, no monetization yet).
- [ ] CLAUDE.md / consumer plan gain a single pointer to this file — **and the CLAUDE.md “Agentic AI ideas” backlog block from 2026-07-23 is deleted**, not left alongside it. Two idea lists is how roadmaps drift.

Until then: **draft only** — safe to review, not safe to treat as the backlog spine.

---

## 10. Summary for reviewers

| | |
|--|--|
| **What GymOps is** | Local-first, mobile PWA logger; speed + history trust. Built to a consumer bar. |
| **What agentic means here** | Multi-step, tool-using help *around* training, proposals only — and, wherever possible, no model at all. |
| **What it is not** | AI coach, silent auto-logger, Layer 1 dependency, or anything requiring the user to hold an API key. |
| **Ladder** *(reordered by cost × reach)* | 0 foundation + proxy hardening → 1 **keyless & free** (voice, deterministic import, brief) → 2 bounded one-shot (fallback mapper, plan draft, prose) → 3 open-ended (chat, weekly review) behind a cost gate. |
| **Dependency** | 6.1 first-run and 6.2 import ship before anything above Agent 1. |
| **The compounding bet** | One name-resolution layer (6.2 aliases) — it serves import, voice, and merge advice alike. Worth more than any model work here. |
| **Non-negotiables** | Confirm gates, tool whitelist, deterministic signals, offline log path, bounded cost, authenticated proxy, reversible proposals. |

---

## 11. Revision log

**2026-07-26 — review revisions (this pass).** Driven by two owner decisions: consumer positioning, and BYOK retirement.

| Change | Section | Why |
|---|---|---|
| Ladder reordered by cost × reach | §5 | Under a shared key, capability escalation is the wrong axis. Voice (no LLM) moved from last to first; chat Q&A from first to last. |
| BYOK sunset section added | §4.1 | Owner decision; pulls the Phase 7 server-side-AI trigger and its auth prerequisite. |
| Five refusals added | §2 | No-key requirement, bounded cost, authenticated proxy, no silent egress, non-blocking failure. |
| Proxy hardening + cost controls made Agent 0 deliverables | §5 | Was deferred to Phase 7; a shared key makes it blocking. |
| Agent 0 exit made binary | §5 | “Test-guarded enough” was unfalsifiable. |
| Signal-contradiction exit bar added | §5 | §7 test 4 existed but nothing gated on it. |
| Plan-archive reversibility requirement added | §5, §7 | The only irreversible action on the ladder had no guard — out of character for a project with quarantine and prerestore. |
| Diagram redrawn as parallel paths | §3 | The pipeline diagram implied Layer 1 writes flow through the agent's tool layer — the opposite of the stated rule. |
| `_manualIntent` interaction documented | §3 | Prefill silently demotes the quick-log hero (5.6 behaviour); “pre-stage is inert” was false. |
| Alias dependency corrected | §4 | 5.1 shipped identity, not aliases; aliases are 6.2. |
| `IDLE_BANNERS` integration required for session brief | §5 | Idle screen already arbitrates banners and never stacks. |
| iOS speech feasibility gate added | §5, §8 | Standalone-PWA support is the open risk for the flagship Agent 1 capability. |
| Stranger+agent test kept and strengthened | §7 | Was unreachable under BYOK; §4.1 makes it the point. |
| Cost / recoverability / failure tests added | §7 | Doc had no numeric or failure-mode bars at all. |
| §8 answered rather than asked | §8 | Five resolved; two genuinely open (cost model, iOS spike). |
| Memory-store reset contract noted | §5 | 6.8 split `dbClearAll` from `dbResetWorkoutData`; a memory store must declare which it obeys. |
