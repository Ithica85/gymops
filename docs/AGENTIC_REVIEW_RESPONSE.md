# Response to the Agentic Vision Review (Grok, 2026-07-26)

Every finding from [AGENTIC_VISION_REVIEW_GROK.md](AGENTIC_VISION_REVIEW_GROK.md) (A1–A20), with a verdict and a disposition. Same audit-trail pattern as [REVIEW_RESPONSE.md](REVIEW_RESPONSE.md) (C1–P11).

Verdicts were established by checking each claim against the actual text of [AGENTIC_VISION.md](AGENTIC_VISION.md), [PHASE4_CONSUMER_PLAN.md](PHASE4_CONSUMER_PLAN.md) and the current code on 2026-07-26.

**Verdict key:** ✅ Accepted · 🟡 Partially accepted / overstated · ❌ Rejected · 📋 Confirmation only (no action)
**Disposition key:** `PATCH-VISION` (must land before the doc is accepted) · `PATCH-PHASE4` · `SPIKE` · `BACKLOG` (post-accept) · `REFUSE`

**Note on document location.** The vision previously lived on branch `docs/agentic-vision` so the reviewer could read the draft→revision diff. That purpose is served, so the branch was **merged to `main`** in the same change set as these patches — which also resolved the dangling cross-links and landed the `#H1 → #C4` citation fix. All five agentic documents now sit together in `docs/`.

---

## Disposition table

| ID | Sev | Verdict | Disposition |
|----|-----|---------|-------------|
| **A1** | 🔴 | ✅ **Accepted — this is a drafting error, not a judgment call.** "6.1 and 6.2 before any rung *above* Agent 1" permits Agent 1 UI to ship alongside the two items that decide whether strangers exist. That is weaker than what was verbally recommended when the revision was written ("start nothing above Agent 0 until 6.1 and 6.2 are live"). | `PATCH-VISION` §4, §9 — absolute gate. **Status update Grok didn't have: 6.1 shipped 2026-07-26 (v6.6), so the gate now reduces to 6.2 alone.** |
| **A2** | 🔴 | 🟡 **Accepted on action, overstated on evidence.** Promoting a capability to "flagship" while its feasibility is unresolved is incoherent against the §1 consumer bar — that part is unarguable. But "WebKit has stated it is not available" is stronger than the record supports; iOS support is *unreliable in standalone*, which is why this is a spike, not a drop. | `PATCH-VISION` §5 (demote) + `SPIKE` (Grok's 20-trial protocol adopted verbatim) |
| **A3** | 🔴 | ✅ **Accepted — sharpest finding in the review.** The doc asserts a "per-install monthly budget, server-enforced" without ever defining the principal. A localStorage UUID resets on reinstall and private mode. "Per-install ceiling enforced" was not a design; it was a wish. | `PATCH-VISION` §4.1 + Agent 0. Resolution: an opaque install credential is **not an account** (no email, no password, no recovery), so the consumer bar survives — but reinstall leakage is accepted in writing, and the **global cap + kill switch** is named as the real backstop. |
| **A4** | 🔴 | ✅ **Accepted.** Describing Agent 2 as the next buildable rung while leaving the ceiling "genuinely open" is an incomplete gate. | `PATCH-VISION` §5 — explicit Agent 2 entry gate + provisional numbers (A13 folds in here) |
| **A5** | 🟠 | ✅ **Accepted, with a sharper principle than the review proposes.** Grok offers "(a) or (b), prefer (a)". The underlying rule is narrower and worth stating once: **consent gates egress, not features.** The 6.6 Settings-card pattern exists because data leaves the device; a local deterministic feature has nothing to consent to. | `PATCH-VISION` §8 Q4 + §7.5 |
| **A6** | 🟠 | ✅ **Accepted — better catch than the plan-archive finding it extends.** Bulk import writes years of sets and exercise identities. The recoverability test never required a pre-import snapshot. | `PATCH-VISION` §5, §7 — and flagged into **6.2 implementation**, since import ships in Phase 6 whether or not this vision is accepted |
| **A7** | 🟠 | ✅ **Accepted — factual correction.** Chrome's Web Speech path is cloud-backed; "free at any scale … works offline once the speech layer does" reads as a claim it can't support. Zero *Anthropic* spend is the true statement. | `PATCH-VISION` §5 |
| **A8** | 🟠 | ✅ **Accepted, and taken further than recommended.** Labelling 6.2 parsers "Agent 1" creates dual ownership of one piece of work — §8 Q2 literally says "the deterministic half is Agent 1 *inside* 6.2", which is the drift Grok names. It also makes A1's gate circular (Agent 1 gated behind 6.2, while containing 6.2). | `PATCH-VISION` §5 — deterministic import re-homed to **6.2 only**; rung relabelled and explicitly declared non-agentic. **Promoted to must-fix**: A1 is incoherent without it. |
| **A9** | 🟠 | ✅ **Accepted.** The earlier fix touched only the Phase 7 trigger line. §2.1 ("personal-first") and §2.2 ("not deepening BYOK coupling") both now contradict owner decisions. | `PATCH-PHASE4` §2.1 + §2.2, same change set |
| **A10** | 🟠 | ✅ **Accepted.** §2 refuses silent egress and promises "the user can see what was sent"; no exit bar enforced it. Same stated-but-not-gated defect this revision criticised in the first draft. | `PATCH-VISION` §5 Agent 2 exit |
| **A11** | 🟡 | 🟡 **Partially accepted.** Grok's mechanism (1) — feed deterministic signal lines in as *inputs* rather than let the model reinterpret raw sets — is the right fix and is architectural, not a test. Mechanism (2), banned-phrase fixtures, is brittle and will rot. | `PATCH-VISION` (mechanism 1, one line) · `BACKLOG` (fixture design, at Agent 2 build time) |
| **A12** | 🟡 | 🟡 **Partially accepted — take the weaker bar.** "Un-archive exists and is tested" quietly invents a plan-history product surface. Grok's (b) is proportionate and reuses machinery that already exists. | `PATCH-VISION` §5 — replace with: confirm names the archived plan + prerestore-class snapshot, restore via backup semantics |
| **A13** | 🟡 | ✅ **Accepted — and it lands on a principle this document itself declares.** "Numbers, not adjectives" with no numbers is the exact failure it was written to prevent. | `PATCH-VISION` §6 — provisional table (folded into A4's patch) |
| **A14** | 🟡 | ✅ **Accepted, and promoted to must-fix.** The doc calls BYOK "transitional" but never says *don't remove it until the replacement works*. Retiring the BYOK path before auth + budgets ship would brick the owner's own AI usage for no gain. The `ANTHROPIC_API_KEY`-stays-unset tripwire is already standing project policy and belongs in the doc. | `PATCH-VISION` §4.1 + Agent 0 ordering |
| **A15** | 🟡 | ✅ **Accepted.** §4 states the alias dependency; the Agent 1 section never restates it, so voice could be built against exact-match resolution and fragment history — the precise failure the trust brand exists to prevent. | `PATCH-VISION` §5 (one line) |
| **A16** | 🟡 | ✅ **Accepted — good extension of the `_manualIntent` catch.** Permission prompts, error toasts and focus theft are Layer 1 regressions that never touch `logSet`. | `PATCH-VISION` §5 Agent 1 exit |
| **A17** | 🟡 | ✅ **Accepted.** A "what this does not buy you" section matches how this project already records refusals, and the claim it corrects (differentiation) was asserted rather than argued. | `PATCH-VISION` — new short §, placed before §7 |
| **A18** | 🟢 | ✅ **Accepted.** Trivial and correct. | `PATCH-VISION` §8 Q5 — add: never merge `api/generate-plan.js` until Agent 0 auth covers it |
| **A19** | 🟢 | ✅ **Accepted.** The reset contract is noted under "After Agent 3" but not at the Agent 2 carve-out where it would actually be built. 6.8 made `dbClearAll` and `dbResetWorkoutData` different contracts; a new store must declare which it obeys. | `PATCH-VISION` §8 Q3 (one line) |
| **A20** | 🟢 | 📋 **Confirmation — no action.** Refusals hold; importer-vs-generator litmus stays in the exit bars; deload agents stay closed. | — |

**Score:** 16 accepted, 3 partially accepted, 0 rejected, 1 confirmation. No finding was refused — which is itself a signal about how much of the revision was assertion rather than design.

---

## Where the review is overstated

Recorded so the patches don't over-correct:

1. **A2's evidence.** The recommendation (demote voice, spike it) is right. The certainty ("will fail on installed iOS") is not established here and should not be written into the doc as settled fact — the patch says *unresolved and spike-gated*, not *broken*.
2. **A5's framing.** "Agent desk surfaces are on for first-run" overshoots. The correct rule is narrower and more durable: consent gates **egress**, not features.
3. **A8's minimum.** Grok's floor ("say the name is a cost rung") is too soft — it leaves two backlogs owning one piece of work. The patch re-homes deterministic import outright.
4. **A12.** Grok offers building un-archive as one option. It shouldn't be an option; the cheap bar is the right one until a real user story asks for plan history.

---

## Patch list — one revision pass, in apply order

Ordered so each patch lands on text the previous one hasn't moved.

### P1 · §4 "Phase 6 first" — absolute gate *(A1, A8)*

> **Phase 6 first — and the gate is absolute.** No user-visible agent surface ships before **6.1 first-run and 6.2 import are both live**. That includes Agent 1. The first draft of this gate read "before any rung *above* Agent 1", which permitted the most seductive capability on the ladder to be built alongside the two items that decide whether strangers exist at all. **Agent 0 is the sole exception** — it ships no user-visible surface and its proxy hardening is overdue on its own merits.
>
> *Status 2026-07-26: 6.1 shipped (v6.6, `gymops-v94`). The gate now reduces to 6.2.*

### P2 · §5 Agent 1 — re-home deterministic import, relabel the rung *(A8)*

- Delete the **Deterministic import (with 6.2)** row from the Agent 1 table.
- Retitle: `### Agent 1 — Desk v0: keyless & free`
- Insert under the theme line:

> **This rung is non-agentic by construction.** No model calls, no tool use — the number is a position on the cost ladder, not a claim of agency. Deterministic Strong/Hevy parsing belongs to **6.2 and only 6.2**; listing it here would give one piece of work two owners and two backlogs.

### P3 · §5 — voice demoted, economics corrected, alias dependency stated *(A2, A7, A15)*

Replace the "most north-star-aligned capability" paragraph:

> **Voice prefill is the cheapest capability here and the least certain.** Speech produces a transcript; turning *"bench 100 for 8"* into `{exercise, weight, reps}` is name-resolution plus a small grammar, so it costs **zero Anthropic spend** and has no hallucination surface. It is *not* free of network, permission, or platform cost — Chrome's Web Speech path is cloud-backed, and mic permission is a real UX toll mid-session. It is therefore a **spike-gated stretch capability, not this rung's flagship**: the flagships are session brief and structured debrief, which work for every stranger on every target platform. Voice ships only if the iOS spike passes; otherwise it is Android/Chrome-only and labelled **degraded**.
>
> **Hard dependency:** voice name-resolution goes through the **6.2 alias layer**. No v0 that mints a custom exercise on a near-miss — that fragments history, which is the opposite of the brand.

Replace the feasibility-gate paragraph with the spike protocol:

> **Spike protocol (pass/fail, before any voice commitment):** installed A2HS on current iOS, gym-like ambient noise, push-to-talk "bench one hundred for eight", 20 trials. **Pass = correct fields ≥80% and zero Layer 1 blockage when permission is denied.** Fail → voice drops from this rung.

### P4 · §4.1 + Agent 0 — identity model *(A3)*

Add to §4.1 as a fourth consequence:

> 4. **"Per-install" requires a principal, and we don't have one.** A localStorage UUID resets on reinstall, private mode, and every new device — so a per-install ceiling is soft by construction. The design is: an **opaque install credential** minted once, stored locally, sent as a bearer token, rate-limited by credential **and** by IP/ASN, underneath a **hard global monthly cap with a kill switch**. This is not an account — no email, no password, no recovery — so the §1 consumer bar holds. **Reinstall leakage is accepted, in writing:** a determined user gets a fresh bucket. The global cap, not the per-install one, is what actually bounds the bill. Until this exists, no shared key is set, and the doc does not claim "per-install ceiling enforced".

Amend the Agent 0 exit bar accordingly:

> - [ ] Install credential is minted, persisted and required by the proxy; rate limits apply per credential **and** per IP/ASN; a global monthly cap and kill switch exist and are tested.

### P5 · §5 Agent 2 entry gate + §6 numbers *(A4, A13)*

New block before the Agent 2 capability table:

> **Entry gate (all three, no exceptions):** Agent 0 exits green · a free-ceiling number is written down · the abuse model in §4.1 is accepted. Until then Agent 2 is paper.

New table in §6 under principle 8:

> | Budget | Provisional value | Revisit when |
> |---|---|---|
> | Model call timeout | 15s | — (matches the 6.6 token timeout) |
> | Free model calls | **5 per install per month**, fail-closed | first real usage data |
> | Global spend cap | **$25/month**, kill switch above it | a bill that argues otherwise |
> | Context per call | ≤ 1 session + 6 prior bests | context-window pricing changes |
>
> Deliberately stingy. A generous free allowance that later has to be clawed back is worse than a small one that grows.

### P6 · §8 Q4 + §7.5 — consent gates egress, not features *(A5)*

Replace Q4's answer:

> **4. Default on/off → consent gates egress, not features.** Deterministic, on-device capabilities (session brief, structured debrief, import) are **product**: on by default, no consent surface, because nothing leaves the device. **Model-backed** capabilities are opt-in behind the 6.6 Settings-card pattern — status line, explicit enable, disable — because they send your data to a third party. This resolves the contradiction the first revision carried, where a globally opt-in agent could not satisfy the stranger test in §7.5.

Amend §7.5 to read *"…logs a first session with deterministic agent help and no tutorial. Model-backed help is not required to pass this test."*

### P7 · §5 + §7 — import is the irreversible action *(A6)*

Add to Agent 2's destructive-path block and mirror in §7.7:

> **Import is the larger irreversible action.** A bulk import writes years of sets and mints exercise identities. It runs **only after an automatic prerestore-class snapshot**, and "Undo import" (or a tested restore path) exists before any import ships — deterministic or model-assisted. Treat it with the same seriousness as `dbRestoreBackup`. *This binds 6.2 regardless of whether this vision is accepted.*

### P8 · §5 Agent 2 exit — pre-send disclosure *(A10)*

> - [ ] Every model call shows a **reviewable summary of the context being sent** before it is sent (default collapsed, expandable to the full pack). Dismissing it cancels the call — fail closed, never send-anyway.

### P9 · §4.1 + Agent 0 — sequencing, and don't brick yourself *(A14)*

> **Agent 0 is a platform project, not a parallel chore** — auth, budgets, abuse controls, timeouts and tests are the bulk of the work on this ladder, and for a solo developer that is likely more effort than any UI above it. Strict order: **(1)** `ANTHROPIC_API_KEY` stays unset until auth ships (standing tripwire, predates this doc) · **(2)** auth + global kill switch · **(3)** budgets · **(4)** only then retire the BYOK path. **BYOK keeps working until (2) and (3) are green** so the owner's own AI usage never bricks in the gap.

### P10 · §5 exit-bar corrections *(A11, A12, A16, A19)*

- **A11** — replace the contradiction bar with: *"Prose generation receives the deterministic signal lines as **inputs** and never re-derives a verdict from raw sets; a fixture check confirms the signal is present and uncontradicted."*
- **A12** — replace *"un-archive exists and is tested"* with: *"the archive confirm names the plan being archived, and a prerestore-class snapshot of the plans tables is taken; restoration uses existing backup semantics. Full plan-history UX is out of scope until a user story asks for it."*
- **A16** — add to Agent 1 exit: *"Denying microphone permission produces **zero UI change** beyond the mic control disabling itself. No modal on the active screen; prefill has unit tests asserting the emphasis classes are unchanged."*
- **A19** — §8 Q3, append: *"The proposal-outcome store declares its schema and which reset path clears it (`dbClearAll` vs `dbResetWorkoutData` — 6.8 made these different contracts) **at Agent 2 build time**, not as a footnote."*

### P11 · New § before §7 — what this does not buy you *(A17)*

> ## What this does not buy you
>
> Stated plainly so the track is never mistaken for a growth strategy:
>
> - **No acquisition story.** Switchers leave Strong/Hevy over paywalls, lock-in and bloat — not over a missing agent. Import (6.2) and first-run (6.1) are the acquisition critical path; nothing on this ladder is.
> - **No retention story until history exists.** Every capability here is grounded in training history. With no history it has nothing to say.
> - **No moat in voice.** Strong and Hevy can ship better voice on native whenever they choose. The moat is local-first truth, deterministic signals, free logging forever.
>
> The honest differentiator, and only after import works: **history-grounded preparation that never owns the log.** Not "we have an agent."

### P12 · `PHASE4_CONSUMER_PLAN.md` §2 *(A9)*

§2.1 →

> 1. **Consumer product, built to a consumer bar** *(amended 2026-07-26)*. GymOps was personal-first; it is now being built for strangers. Anything that only works for the developer is out of scope. Prioritisation rule: prefer work that moves a stranger from install to logged session. Work that also pays back the current user still wins ties — it is no longer the tiebreak itself.

§2.2 →

> 2. **No monetization planned; option kept open via architecture, not pricing** *(amended 2026-07-26)*. The optionality-preserving investments are stable exercise IDs and real backup/restore. **BYOK is retired** (see [AGENTIC_VISION.md](AGENTIC_VISION.md) §4.1): AI is delivered by a shared key behind auth + budgets, or not at all — and logging is never coupled to AI, free or paid. Stripe/tiers/entitlements remain deferrable, but the Phase 7 server-side-AI trigger is now **pulled**, not hypothetical.

---

## Close decision

**Accept the vision as spine — after P1–P12 land in a single revision pass. Not before.**

This is a narrower gap than Grok's "do not accept" implies, but the direction is the same and the must-fix list is real. Three of the four critical findings (A1, A3, A8) are places where the document asserted a control it had not designed:

- A gate that read as absolute but wasn't (A1)
- A budget with no principal to charge (A3)
- A rung that claimed work belonging to Phase 6 (A8)

Those are exactly the defects this revision criticised in the first draft — *stated but not gated*. Patching them is a day of writing, not a rethink, and the philosophy underneath survives review intact: proposals only, deterministic first, cost×reach ordering, C4 in Agent 0, importer-not-generator.

**Must-fix before acceptance:** A1, A2, A3, A4, A5, A6, **A8**, A9, A10, **A14**.
*(A8 and A14 are promoted beyond Grok's list — A1 is incoherent without A8, and A14 prevents a live footgun: retiring BYOK before its replacement exists.)*

**The practical consequence is small right now**, and worth saying plainly: 6.1 shipped today, so the gate reduces to **6.2**. Nothing on this ladder was going to be built before import anyway. The patches cost a document pass and buy a spine that won't quietly authorise the wrong work in three weeks.

**Recommended change set, in one commit:** patch the vision (P1–P11), patch `PHASE4_CONSUMER_PLAN.md` §2 (P12), merge `docs/agentic-vision` to `main`, add the pointer from CLAUDE.md, and delete the CLAUDE.md "Agentic AI ideas" block. The branch existed to preserve a review diff; that review has happened. — **Done 2026-07-26, commit `273675d`.**

---

## Round 2 — confirmation pass (2026-07-26)

The reviewer's close position: *"The document is good enough to be the spine. The triage was accurate; promotions of A8 and A14 were right; your four pushbacks are mostly right."* Two findings survived.

| ID | Verdict | Disposition |
|----|---------|-------------|
| **B1** | ✅ **Accepted, structurally — citation pending.** The reviewer hardened the voice question with a WebKit source and a cheaper canary path. The canary is obviously right and is applied: a feature-detection check on an installed iOS instance costs minutes, and running the 20-trial protocol before it is how a platform question becomes a wasted sprint. **The WebKit citation itself has not been recorded** — it is not written into the doc unverified; §5 carries a marked pending-citation block instead. If the source is firm, voice is dropped without running even the canary. | `PATCHED` §5 (two-stage gate) · `OPEN` — record the citation, then close |
| **B2** | ✅ **Accepted — a real leftover, and our error.** The A8 patch removed "the deterministic half is Agent 1 *inside* 6.2" from §5 but left the identical claim standing in §8 Q2. A finding closed in one place and left open in another — exactly the failure mode the round-2 brief asked them to look for. | `PATCHED` §8 Q2 — ownership now stated unambiguously |

**Also corrected (self-caught alongside B2):** CLAUDE.md's docs map described the vision as *"accepted 2026-07-26"* while §9 was unticked. Now reads as a proposal with the §9 checklist outstanding, and notes that the §4 gate binds regardless of acceptance.

**Owner actions outstanding:**

1. ~~Patch §8 Q2 (B2)~~ — done.
2. **Tick §9 when you mean it.** Deliberately left unticked; acceptance is an owner act, not a reviewer's or an author's.
3. **Build 6.2**, with the import snapshot + tested undo required by A6. Everything else on this ladder waits on it.
