# GymOps — External review request: agentic vision

*Written 2026-07-26. The brief sent to the external reviewer (Grok) for a second-pass review of [AGENTIC_VISION.md](AGENTIC_VISION.md).*

**Pinned to:** `AGENTIC_VISION.md` as of commit `101f90b` on branch `docs/agentic-vision`; branch head `34ae89a` at time of sending. Versioned alongside the document it reviews so a later reader can tell *what* was reviewed, not just what came back. *(That branch was merged to `main` on 2026-07-26 once the review completed — the round-1 URLs below are historical and no longer resolve; the round-2 prompt further down uses `main`.)*

**Prior context:** the same reviewer's first-pass deep review of the app produced [REVIEW_RESPONSE.md](REVIEW_RESPONSE.md) (findings C1–P11), which drove [PHASE4_CONSUMER_PLAN.md](PHASE4_CONSUMER_PLAN.md). This request is deliberately continuous with that: same output format, explicit list of already-closed findings, new IDs prefixed `A`.

**Where the answers go:** findings from this pass belong in `REVIEW_RESPONSE.md` under an "Agentic pass (A1–An)" section, with the same disposition discipline — every finding gets a verdict and a destination, or an explicit refusal with a reason.

**Two design choices in the brief, recorded so they aren't mistaken for oversights:**

1. The reviewer is told **not to relitigate** the two owner decisions (consumer bar, BYOK retirement) but **is** asked to stress-test whether the document handles their consequences honestly. Decisions are the owner's; consequences are fair game.
2. The standing refusals are stated as in-scope to *challenge* but not to *ignore* — a reviewer who proposes a social feed hasn't read the frame, but one who argues a refusal has expired given the consumer decision is doing the job.

---

## The prompt (copy verbatim)

```
You previously completed a deep review of GymOps, a mobile-first PWA workout
logger. Your findings were triaged into docs/REVIEW_RESPONSE.md (IDs C1–P11)
and drove the roadmap in docs/PHASE4_CONSUMER_PLAN.md. I'd like a second-pass
review, this time of a new product-vision document for an agentic AI track.

## The artifacts

Repo (public): https://github.com/Ithica85/gymops

- DOCUMENT UNDER REVIEW — read as a DIFF (original draft → revised):
  https://github.com/Ithica85/gymops/compare/main...docs/agentic-vision
  Raw: https://raw.githubusercontent.com/Ithica85/gymops/docs/agentic-vision/docs/AGENTIC_VISION.md
- Standing product frame (use the docs-branch copy, it has a citation fix):
  https://github.com/Ithica85/gymops/blob/docs/agentic-vision/docs/PHASE4_CONSUMER_PLAN.md
- Your prior review's dispositions:
  https://github.com/Ithica85/gymops/blob/main/docs/REVIEW_RESPONSE.md
- Code + architecture notes: CLAUDE.md on main. Live app: gymops-two.vercel.app

## Where the project actually is

Vanilla HTML/CSS/JS, no frameworks, no build tools, no runtime npm deps.
SQLite via sql.js persisted to IndexedDB. One Vercel serverless function.
166 Vitest tests. In real daily use since May 2026, single user today.

Phase 4 (trust) and Phase 5 (identity/program model) complete. Phase 6
(consumer readiness) in progress: 6.4 SW update strategy, 6.6 Drive-connect-
to-Settings and 6.8 reset-options-split are shipped and live (v6.5). Still to
do: 6.1 first-run, 6.2 Strong/Hevy import, 6.3 accessibility, 6.5 install
polish, 6.7 landing page, 6.9 local usage counters.

Closed since your review — please do NOT re-raise these:
- #H1 exercise identity → shipped in 5.1 (stable exercise_id + rename)
- #H11 SW update strategy → shipped in 6.4 (network-first)
- #M8 dbClearAll wipes credentials → shipped in 6.8 (reset split)
- #C1 silent wipe on corrupt DB, #M11 undoSet scope → both fixed in Phase 4
- #C4 open proxy → still latent (ANTHROPIC_API_KEY confirmed unset), but the
  BYOK decision below makes it live work; the vision moves it to Agent 0.

## Two owner decisions that drove the revision

These are DECIDED. Don't relitigate them — but do stress-test whether the
document handles their consequences honestly:

1. GymOps is being built to a consumer bar. Anything that only works for the
   developer is out of scope.
2. BYOK (user-supplied Anthropic API key) is being retired as a delivery
   model — too much friction for a normal person.

Consequence the doc claims: retiring BYOK pulls the Phase 7 "server-side AI"
trigger on its own, independent of monetization, because a shared key means
every call is a cost and the proxy currently has no auth. The doc's interim
posture is "don't monetize yet; keyless features carry the consumer story;
model features ship bounded with a free per-install ceiling; paid Layer 2 is
the release valve when a real bill argues for it."

## Standing refusals (in scope to challenge, not to ignore)

No social feed. No exercise-catalogue arms race. No ML black-box coaching
(deterministic signals only — F-03/F-06 rule engines stay ground truth).
No ads. No paywall on the act of logging, ever. No LLM on the Layer 1
critical path (Layer 1 = the active-workout log loop). Local-first: the
device is the source of truth. Staying a PWA, staying vanilla.

If you think a refusal is now wrong given the consumer decision, say so
explicitly and argue it — but flag it as a positioning challenge, not a
feature suggestion.

## What I want from the review

1. Coherence: does the vision contradict PHASE4_CONSUMER_PLAN.md or the
   refusals anywhere? The prior pass caught several; I want a fresh set of eyes.
2. Economic realism: the ladder is ordered by cost-per-user × reach, and
   claims Agent 1 is zero-marginal-cost because voice prefill needs no LLM
   (speech → transcript → grammar + name-resolution, not a model call). Is
   that true, and is the bounded-free-tier posture actually survivable?
3. Exit bars: are they falsifiable and sufficient? The revision hardened
   several; I suspect some are still soft.
4. Missing risks — especially anything about abuse, cost blowout, privacy/data
   egress, or irreversible actions. The doc added a reversibility requirement
   for plan archival; are there others it missed?
5. The two questions the doc leaves genuinely open, where I'd value a
   recommendation with reasoning:
   a. The cost model — what's a defensible free ceiling for a solo-developer-
      funded consumer PWA, and what triggers moving to paid Layer 2?
   b. Whether Web Speech is reliable enough in an installed iOS PWA for voice
      prefill to be the flagship of Agent 1, or whether that's a bad bet.
6. Competitive read: does an agentic layer shaped like this actually
   differentiate against Strong/Hevy, or is it a distraction from 6.1/6.2 —
   the items that decide whether the app gets users at all?

## Output format

Match your previous review: a table of numbered findings (use A1, A2, … to
distinguish this pass), each with severity, the claim, and a concrete
recommendation. Separate "must fix before accepting the doc" from "worth
doing later." Be blunt — I'd rather hear the strongest objection than a
validated plan. If your view is that the whole agentic track is premature
against Phase 6, say that plainly and make the case.
```

---

## Round 2 — confirmation pass after the A1–A20 patches (2026-07-26)

*Sent after triaging the second-pass review. Everything now lives on `main`; the `docs/agentic-vision` branch was merged once the review it existed to support had happened.*

```
Follow-up to your second-pass review of GymOps' AGENTIC_VISION.md (findings
A1–A20). Your findings were triaged and the document has been patched. I want
a confirmation pass, not a fresh review.

## What to read

Repo (public, all on main now): https://github.com/Ithica85/gymops

- Patched vision: docs/AGENTIC_VISION.md — see the §11 revision log, second
  table, which maps every change to the finding that caused it.
- Our dispositions: docs/AGENTIC_REVIEW_RESPONSE.md — verdict + destination
  for A1–A20, plus a section on where we think your review overstated.
- Your raw review, for reference: docs/AGENTIC_VISION_REVIEW_GROK.md
- Standing frame, now amended: docs/PHASE4_CONSUMER_PLAN.md §2

## Outcome of the triage

16 accepted, 3 partial, 0 rejected, 1 confirmation-only. We promoted two of
your non-must-fix findings to must-fix: A8 (A1's gate is incoherent without
it — Agent 1 cannot be gated behind 6.2 while containing 6.2) and A14
(retiring BYOK before its replacement exists would brick the owner's own
usage).

Key changes:
- A1: gate made absolute — no user-visible agent surface before 6.1 + 6.2,
  Agent 1 included. (6.1 shipped 2026-07-26, so the live gate is 6.2 alone.)
- A8: deterministic import re-homed to 6.2 only; the rung is now "Desk v0"
  and explicitly declared non-agentic by construction.
- A2/A7/A15: voice demoted from flagship to spike-gated stretch, your 20-trial
  protocol adopted verbatim, economics corrected to "zero Anthropic spend"
  rather than "free/offline", alias dependency made hard.
- A3: identity model specified — opaque install credential (not an account:
  no email, password or recovery), rate-limited per credential and per
  IP/ASN, under a hard global monthly cap with a kill switch. Reinstall
  leakage is accepted in writing; the global cap is named as the real bound.
- A4/A13: provisional numbers written down — 15s timeout, 5 free model calls
  per install per month, $25/month global cap, ≤1 session + 6 prior bests of
  context. Agent 2 has a three-part entry gate.
- A5: resolved as "consent gates egress, not features" — deterministic local
  capabilities are on by default; model-backed ones are opt-in behind the 6.6
  Settings-card pattern. Stranger test now explicitly requires only
  deterministic help.
- A6: import named as the larger irreversible action; prerestore-class
  snapshot + tested undo required before any import ships, deterministic or
  not. This binds 6.2 regardless of the vision.
- A9: PHASE4 §2.1 and §2.2 amended in the same change set.
- A10/A11/A12/A16/A17/A18/A19: exit bars, pre-send context disclosure, the
  contradiction mechanism (signals as inputs), the weakened un-archive bar,
  mic-denial bar, a "what this does not buy you" section, and the
  generate-plan and memory-store notes.

## Where we pushed back — please challenge if you still disagree

1. A2 evidence: we accepted your recommendation but not the certainty. The
   doc says installed-iOS speech is *unresolved*, not known-broken, and
   spikes it. If you have a hard source that WebKit does not support
   SpeechRecognition in home-screen web apps, we will drop voice outright
   rather than spend a spike on it.
2. A5 framing: we think the durable rule is narrower than "desk surfaces on
   for first-run" — consent gates egress, not features. Does that hold?
3. A8: we went further than your floor and re-homed deterministic import
   entirely rather than just relabelling.
4. A12: we took your weaker option and explicitly refused to build un-archive
   UX until a user story asks for it.

## What I want back

1. Do the patches actually close A1–A6, A8, A9, A10, A14 — or did any patch
   close a finding on paper while leaving the hole? Be specific about which.
2. Did any patch introduce a new contradiction? The identity model (A3) and
   the consent rule (A5) are the newest text and the least reviewed.
3. Are the provisional numbers (5 calls/install/month, $25/month cap)
   defensible, or wrong by an order of magnitude in either direction?
4. Close call: is the document now acceptable as the backlog spine, given the
   gate reduces to 6.2? If not, name the specific blocker.

Same output format: numbered findings (use B1, B2, … for this pass),
severity, claim, recommendation, split into "blocks acceptance" vs "later".
If your answer to (4) is yes, say so plainly — I do not need findings
manufactured to justify a third pass.
```

---

## Notes for whoever re-runs this

- **The compare URL is the load-bearing link.** It shows the original draft and the revisions as separate commits, so the reviewer sees *what changed and why* rather than re-reading a finished document. If the reviewer's tooling can't fetch GitHub, fall back to the raw URL — but the diff is lost, and a second pass over a settled document tends to produce agreement rather than challenge.
- **Point at the docs-branch copy of `PHASE4_CONSUMER_PLAN.md`,** not main's. The `#H1 → #C4` citation fix rides on this branch; main's copy still cites the exercise-identity finding for the AI-proxy gate until the vision merges.
- **Update the closed-findings list before re-sending.** It is the difference between a review that advances and one that re-litigates. As of this writing, 6.1/6.2/6.3/6.5/6.7/6.9 are still open and fair game.
- **Question 6 is the one the project cannot answer from the inside.** Opportunity cost against 6.1/6.2 is exactly the judgement an external reviewer is positioned to make and the author is not.
