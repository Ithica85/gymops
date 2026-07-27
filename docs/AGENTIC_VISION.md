# GymOps — Agentic Product Vision

*Written 2026-07-26. Companion: [PHASE4_CONSUMER_PLAN.md](PHASE4_CONSUMER_PLAN.md) (standing product frame, Phases 4–7). This document does not replace that plan; it proposes a post–Phase-6 optional track for agentic AI that must stay coherent with it.*

**Status:** Draft for review — not scheduled work. No implementation commitment until this document is accepted (or revised) and Phase 6 success criteria remain on track.

---

## 1. One-line positioning

**GymOps remains the fastest logger that never loses your history.**  
The agentic layer is a **proposal-and-prep desk** on top of that history — not a coach that owns the workout, and not a chatbot that replaces the active log screen.

Evolved north star (additive, not a rewrite of brand):

> *The fastest logger that never loses your history — and an agent that only acts on that history with your say-so.*

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

**Explicitly out of Agent 0–3 (revisit only with a positioning change):** plateau/deload detection agents, guilt/nudge copy driven by an LLM, ambient auto-scheduling, watch-side autonomous logging.

---

## 3. Product shape: three surfaces, one brain

```
IDLE / COMPLETED / PLANS     ← agent home (Layer 2)
        │ proposals only
        ▼
ACTIVE WORKOUT               ← logger soul (Layer 1; agent may pre-stage only)
        │ writes only via existing functions
        ▼
TOOL WHITELIST               ← dbGet*, plan/session APIs, never raw SQL
```

| Surface | Role | Agent involvement |
|---------|------|-------------------|
| **Logger** (active screen) | Log set → rest → next. Quick-log, undo, PR, timers. | Best-effort pre-stage only (e.g. voice **prefill**, day/order already chosen). Never blocks or replaces Log Set / quick-log. |
| **Desk** (idle + completed) | Briefs, debriefs, history Q&A, weekly review. | Primary chat / on-demand agent UI. |
| **Architect** (plans + import) | Multi-day programs, CSV migrate-in. | Multi-step tool use: draft plan JSON, map import rows; human reviews before save. |

**Layer 1 / Layer 2 rule (unchanged):** Layer 1 never depends on Layer 2 or the agent. Layer 2 may read workout state; the agent may call tools that write only after confirm gates.

---

## 4. Relationship to current AI and Phase 6

**Today:** one BYOK post-session prose summary (`js/ai.js` → `/api/ai-summary`). Non-blocking, Layer 2 only. Deterministic signals elsewhere. An AI routine importer was prototyped on `feature/ai-routine-import` and parked — positioning (importer vs generator vs “not a coaching app”) is resolved in spirit by this doc: **importer + plan draft = in; autonomous generator that activates programs = out.**

**Phase 6 first:** consumer readiness (import, first-run, a11y, install polish) still takes priority. Agentic work is most valuable *after* strangers can bring Strong/Hevy history (6.2) and stable exercise identity (already shipped in 5.1). Agent 0 may be designed in parallel as a paper/policy pass; shipping Agent 1+ should not displace Phase 6 success criteria.

**Phase 7 gates still apply** for server-side (non-BYOK) AI: auth + rate limiting on any model proxy before a shared key exists.

---

## 5. Agentic track: Agent 0–3

Not calendar phases of the consumer plan — a **gated capability ladder**. Each step has an exit bar before the next opens.

### Agent 0 — Tool surface & policy (foundation)

**Theme:** Make “what the agent is allowed to do” explicit before any new model UX ships.

| Deliverable | Notes |
|-------------|--------|
| Tool allowlist | Named tools mapping 1:1 (or thin wrap) to existing read/write paths. Reads: history, plans, adherence, exercise identity. Writes: only behind confirm. |
| Confirm policy | Every write tool requires a user-visible confirm step (sheet or editor). Logging tools (`logSet` / `quickLogSet`) are **not** agent-callable in 0–3 except as “prefill then human taps.” |
| Data boundaries | Prefer local tool execution over bulk DB upload. Context packs for server calls stay minimal and purpose-scoped. |
| Auditability | Agent proposals are inspectable (structured draft the user can edit). No opaque “AI applied changes.” |
| Tests | Policy tests: disallowed tools rejected; write tools never run without a confirm flag/path. |

**Exit:** A short internal spec (tools + policy) exists and is test-guarded enough that Agent 1 cannot “accidentally” widen write power.

---

### Agent 1 — Read-only intelligence (first user-visible agent)

**Theme:** The agent earns trust by answering from *your* data only.

| Capability | User-facing shape |
|------------|-------------------|
| History Q&A | “How many times did I bench ≥100 kg this month?” → whitelist `dbGet*` / derived stats only. |
| Richer post-session debrief | Upgrade of today’s summary: structured bullets (volume vs last, PRs, skipped plan work) + optional short prose. Still on-demand; BYOK-compatible. |
| Signal explanation | Optional plain-language gloss of F-03/F-06 outputs — never a second score that contradicts them. |
| Share-ready debrief | Optional path to `navigator.share` (no social feed). |

**Exit:**

- [ ] User can get a correct, history-grounded answer without the agent inventing sets or sessions.
- [ ] Post-session agent path still fails open (no key / offline → app remains fully usable).
- [ ] Layer 1 unchanged in latency and offline behaviour.
- [ ] No new write path from the agent.

---

### Agent 2 — Draft & migrate (multi-step tools that matter)

**Theme:** Multi-step agent work where humans already expect a review step.

| Capability | User-facing shape |
|------------|-------------------|
| NL plan builder | One-line goal → structured draft (days, exercises, targets) → plan editor for edit/save. Save still uses existing plan APIs; activation still archives the previous active plan under current rules. |
| Import mapper (with 6.2) | Strong/Hevy (etc.) CSV → column + exercise name mapping; ambiguous rows flagged for confirm; aliases respect stable `exercise_id`. |
| Alias / merge advisor | Suggest consolidating fragmented custom names; **never** auto-merge. |
| Plan edit proposals | e.g. “Pin skipped accessories next Pull” → draft plan-exercises diff → user accepts in editor. |

**Exit:**

- [ ] A full plan can go from natural language to **saved** plan only after explicit Save in the editor (or equivalent confirm).
- [ ] Import never silently invents exercise identity; clashes and unknowns surface.
- [ ] Agent 0 write policy still holds (no direct DB writes from the model).

---

### Agent 3 — Session edge (prep without owning the set)

**Theme:** The agent touches the *boundary* of the workout, not the set-log.

| Capability | User-facing shape |
|------------|-------------------|
| Session brief (idle) | Before Start: next plan day, last time trained, thin coverage notes, optional “open day switch.” Cached/stale-tolerant so offline Start still works. |
| Voice prefill | Speech → weight/reps (or duration) fields → user confirms with Log Set / quick-log. No silent auto-log. |
| Pre-stage only | Agent may influence which day/exercise is *ready*; `beginSessionFlow` / `setActiveExercise` / `logSet` remain user- or Layer-1-driven. |
| Weekly review (on demand) | Coverage, adherence, PRs, skipped volume — read tools + optional draft plan tweak → Agent 2 confirm path. |

**Exit:**

- [ ] Full session completable with agent disabled / offline after brief was shown.
- [ ] Voice path cannot write a set without the same confirm affordance as manual entry.
- [ ] Active-screen hierarchy (quick-log hero, fold constraints) unchanged unless a separate design pass says otherwise.
- [ ] Deterministic signals and PR celebration behaviour unchanged.

---

### After Agent 3 (not in scope of this vision)

Parked until Agent 0–3 exit bars are met and Phase 7 triggers are real:

- Persistent agent memory (preferences, accepted proposals) as a first-class store  
- Server-side non-BYOK models (auth + rate limits first)  
- Cloud sync so the desk follows the user across devices  
- Watch / ambient agents (native decision required; correctness bar from consumer plan)

---

## 6. Architecture principles (implementation constraints)

1. **Local-first history remains the source of truth.** IndexedDB/sql.js, backup/restore, quarantine paths are non-negotiable; the agent does not become the system of record.
2. **Prefer local tool execution** for Q&A over uploading the full DB. Server proxies exist for model tokens (as today), not for owning user data.
3. **Vanilla / PWA / no runtime npm deps** remain the default for the logger. Agent UI may grow as modules under the same constraints until a Phase 7 trigger forces otherwise; the logger must not wait on a framework rewrite.
4. **BYOK stays valid** through Agent 1–3 where practical; deepening server-key coupling stays a Phase 7 monetization/optionality decision (consumer plan §2.2 / §Phase 7).
5. **Every schema or identity change** still follows existing rules: `_createSchema` + `_migrate`, no silent wipes, exercise IDs stable.

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
5. **Stranger+agent test** — Import history → agent helps map names / draft a plan → first session logged without a human tutorial from the developer.

---

## 8. Open questions for review

Resolve before treating this doc as accepted:

1. **Chat vs single-shot UI on the desk** — Persistent thread, or one-shot cards (“Brief”, “Ask”, “Weekly review”) that match the current bottom-sheet language?
2. **Agent 2 vs Phase 6.2 sequencing** — Import mapper as part of 6.2 delivery vs pure regex/heuristic import first and agent mapper later?
3. **Memory** — Are “I hate machine rows” / accepted proposals in scope before Agent 3 exit, or strictly post–Agent 3?
4. **Default on/off** — Is the desk agent opt-in (BYOK / toggle) for personal use, or present with a clear “requires key” empty state like today’s AI summary?
5. **Parked routine importer branch** — Adopt as Agent 2 plan-draft seed, or discard in favour of a clean design against this policy?

---

## 9. Acceptance criteria for *this document*

This vision is **accepted** when:

- [ ] Positioning and refusals are agreed (or explicitly amended in-place).
- [ ] Agent 0–3 scope and exit bars are agreed as the ladder (not a commitment to build all four immediately).
- [ ] Phase 6 priority over shipping Agent 1+ is affirmed.
- [ ] Open questions in §8 have owners or interim defaults.
- [ ] CLAUDE.md / consumer plan gain a single pointer to this file once accepted (no duplicate roadmaps).

Until then: **draft only** — safe to review, not safe to treat as the backlog spine.

---

## 10. Summary for reviewers

| | |
|--|--|
| **What GymOps is** | Local-first, mobile PWA logger; speed + history trust. |
| **What agentic means here** | Multi-step, tool-using help *around* training (desk + architect), proposals only. |
| **What it is not** | AI coach, silent auto-logger, or Layer 1 dependency. |
| **Ladder** | 0 policy → 1 read-only → 2 draft/import → 3 session-edge prep. |
| **Dependency** | Phase 6 (especially import + stranger readiness) before agent value compounds. |
| **Non-negotiables** | Confirm gates, tool whitelist, deterministic signals, offline log path. |
