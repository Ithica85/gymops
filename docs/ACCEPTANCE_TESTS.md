# GymOps — Acceptance tests for the two open Phase 6 criteria

Two of Phase 6's success criteria (`PHASE4_CONSUMER_PLAN.md` §3) are claims about
**people**, not code, so no amount of testing from the developer's machine can
close them:

- [ ] *A stranger can install the PWA, import their Strong/Hevy history, and complete a logged session with zero guidance.*
- [ ] *A screen-reader user can log a set.*

This document is what you hand to the person doing each one. They are **two
different tests with two different testers** — don't combine them.

---

## The rule that makes Test A valid

> **Do not help them. At all.**

The criterion is *"without asking a question"*. The moment you answer one, the
test is over and the answer is "no" — so the most valuable thing the tester can
record is **the moment they wanted to ask**, not whether they eventually
succeeded.

If you're in the room: sit where you can't see the screen, say nothing, and let
silences run. "Do you want a hint?" is a hint. If they hand you the phone and
ask, the honest response is *"I can't answer that — write down what you wanted
to know and carry on however you like."*

**Getting stuck is a result, not a failure of the test.** A tester who gives up
at step 3 has produced the single most useful piece of information in this
document.

---

# Test A — The stranger test

**Who:** someone who lifts, has never used GymOps, and has never watched you use
it. Ideally they already log workouts in another app.

**How long:** about 20 minutes.

**What they need:**
- Their own phone (note which: iPhone/Safari or Android/Chrome — the install
  step genuinely differs, and iOS never offers an automatic install button).
- Ideally, a CSV export of their history from Strong or Hevy. If they don't
  have one, Task 3 is marked N/A rather than failed — but try to find a tester
  who does, because switching is the whole acquisition path.

**What you send them:** one link and nothing else.

> https://gymops-two.vercel.app/about.html

*(That is the real arrival path — a shared link. If you want the stricter
variant, send `https://gymops-two.vercel.app` instead, with no about page at
all, and note which variant was used.)*

**Do not send:** instructions, a feature list, a "start by tapping…", or this
document's task list rephrased helpfully.

## Tasks

Each task says **what to achieve**, never how. That's deliberate.

| # | Task | Done? | Time | Where did you hesitate, or want to ask something? |
|---|---|---|---|---|
| 1 | Work out what this app is and decide whether you'd use it | ☐ | | |
| 2 | Get it onto your phone's home screen and open it from there | ☐ | | |
| 3 | Bring your existing training history in from your old app | ☐ | | |
| 4 | Record a workout: at least two different exercises, at least three sets each, with realistic weights | ☐ | | |
| 5 | Finish the workout and find out how it compared to your last one | ☐ | | |
| 6 | Look up one exercise's history and say whether you're getting stronger at it | ☐ | | |
| 7 | Find out where your data is stored and how you'd get it out | ☐ | | |
| 8 | Set up the training split you actually follow | ☐ | | |

## Then, in their own words

1. **Where did you get stuck, confused, or annoyed?** (Be specific and be blunt
   — this is the only part we can't get any other way.)
2. **Was there a moment you would have given up if this weren't a favour?**
3. **What did you expect to happen that didn't?**
4. **Anything that felt broken or wrong?**
5. **Would you keep using it? Why, or why not?**
6. **If you imported: is your history right?** Right weights, right dates, right
   exercise names, personal bests where you expect them?

## Before handing the phone back

Ask them to open **Settings → Usage** and screenshot it. That's the local
counter readout (6.9) — it never leaves their device, so a screenshot is the
only way it reaches you. It corroborates the written answers: workouts started
versus finished, and how many sets were typed rather than logged in one tap.

## How to score it

**Pass** requires all of:

- Tasks 2, 4 and 5 completed **without asking anything.**
- Task 3 completed without asking, **or** marked N/A for want of an export file.
- Imported history is correct — a wrong weight, a shifted date or a silently
  merged exercise is a **fail regardless of how smooth the flow felt.** This is
  a logger; the numbers being right outranks everything.

Anything else is a fail, and the "where did you hesitate" column is the fix
list. Record the result and the date in `PHASE4_CONSUMER_PLAN.md` rather than
just ticking the box — a bare tick loses the evidence.

---

# Test B — The screen-reader test

**Separate tester, separate session.** This criterion is specifically a claim
about screen readers, which is why 6.3 shipped with it left unticked: names,
roles, focus handling and a full keyboard-only run were all verified
programmatically, and none of that is the same as someone hearing the app.

**Who:** ideally someone who uses VoiceOver or TalkBack daily — their judgement
on whether something is *usable* rather than merely *labelled* is the point. If
that isn't available, you can run it yourself with the screen reader on and the
screen off; that's a weaker result and should be recorded as such.

**Setup:** VoiceOver (iOS: Settings → Accessibility → VoiceOver) or TalkBack
(Android: Settings → Accessibility → TalkBack). **Screen off or eyes closed** —
otherwise it isn't the test.

## Tasks

| # | Task | Done? | Notes |
|---|---|---|---|
| 1 | Reach and activate the control that starts a workout | ☐ | |
| 2 | Choose a specific exercise from the picker | ☐ | |
| 3 | Enter a weight and reps, and log the set | ☐ | |
| 4 | Confirm the set was recorded, without looking | ☐ | |
| 5 | Log a second set using the one-tap repeat | ☐ | |
| 6 | Open a sheet (e.g. the exercise picker), then close it without choosing anything | ☐ | |
| 7 | Finish the workout | ☐ | |

## Specific things to listen for

- Does every control announce **what it is**, or do you meet anything that just
  says "button"?
- Does the weight field announce **its unit** — "Weight (kg)" — and does it
  change to "Duration (minutes)" on a cardio exercise?
- When a sheet opens, does focus **move into it**, and does it **stay inside**
  while you swipe around?
- When you close a sheet, does focus **return to what opened it**, or dump you
  at the top of the page?
- Is anything announced that shouldn't be — decorative dividers, section
  headers read as buttons?
- Is anything **silent** that matters, e.g. the set you just logged appearing in
  the list?

**Pass:** tasks 1–5 completed by ear alone. Tasks 6 and 7 are about focus
management, and a failure there is worth fixing even if 1–5 pass.

---

## Recording results

Update the two checkboxes in `PHASE4_CONSUMER_PLAN.md` §3 with the date, the
tester's context (device, browser, whether they had an export file, which screen
reader), and the outcome — in the same style as the two criteria already ticked
there, which each carry their evidence with them. **A criterion ticked without
its evidence is worth less than one left open.**
