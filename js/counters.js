// ═══════════════════════════════════════════════════════
// GymOps — Local usage counters (6.9)
// ═══════════════════════════════════════════════════════
// Enough of a funnel to reason about activation — did a session that started
// get finished, is quick-log actually used, did an import happen — WITHOUT any
// telemetry: nothing is transmitted, and there is nowhere to transmit it to.
// The numbers live in this browser and are readable in Settings.
//
// No consent surface, deliberately. AGENTIC_VISION.md §9.4: consent gates
// EGRESS, not features — nothing leaves the device here, so a permission
// prompt would be consent theatre. The honesty obligation is that Settings
// says plainly what is counted and where it stays.
//
// KNOWN LIMIT, stated up front so nobody mistakes this for analytics: these
// are one device's counters. They tell you about your own use, or a user's if
// they read them to you. They cannot tell you anything about strangers — that
// is the deliberate cost of having no backend, not an oversight.
//
// This module must never be able to break the app. A counter is a side
// channel: a full disk (see 4.4) or a hostile private mode must cost you the
// number, never the set you just logged. Every entry point swallows its own
// errors and returns a sane empty shape.

import { localDateStr } from './state.js';

const KEY       = 'gymops_counters';
const SINCE_KEY = 'gymops_counters_since';

// Canonical names. Call sites use these constants rather than string literals
// so a typo is a reference error at load rather than a counter that silently
// increments into a key nothing ever displays.
export const COUNTERS = Object.freeze({
  APP_OPENS:          'app_opens',
  SESSIONS_STARTED:   'sessions_started',
  SESSIONS_COMPLETED: 'sessions_completed',
  SESSIONS_DISCARDED: 'sessions_discarded',
  SETS_MANUAL:        'sets_manual',
  SETS_QUICK:         'sets_quick',
  SETS_UNDONE:        'sets_undone',
  PRS:                'prs',
  PLANS_CREATED:      'plans_created',
  IMPORTS_RUN:        'imports_run',
});

// Display order + wording for Settings. Anything counted but unlabelled simply
// isn't shown, which is the safe direction: a stray key can't render as a
// mystery row. A test keeps the two lists in step.
export const COUNTER_LABELS = Object.freeze([
  [COUNTERS.APP_OPENS,          'App opened'],
  [COUNTERS.SESSIONS_STARTED,   'Workouts started'],
  [COUNTERS.SESSIONS_COMPLETED, 'Workouts finished'],
  [COUNTERS.SESSIONS_DISCARDED, 'Workouts discarded'],
  [COUNTERS.SETS_MANUAL,        'Sets typed in'],
  [COUNTERS.SETS_QUICK,         'Sets logged in one tap'],
  [COUNTERS.SETS_UNDONE,        'Sets undone'],
  [COUNTERS.PRS,                'Personal bests'],
  [COUNTERS.PLANS_CREATED,      'Plans created'],
  [COUNTERS.IMPORTS_RUN,        'Imports run'],
]);

function _read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // A hand-edited or half-written value must not poison every later read.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Adds n to a counter. Silent on any failure — see the note above about never
// costing the user the action they actually took.
export function bumpCounter(name, n = 1) {
  if (!name) return;
  try {
    const all = _read();
    const current = Number.isFinite(all[name]) ? all[name] : 0;
    all[name] = current + n;
    localStorage.setItem(KEY, JSON.stringify(all));
    // Stamped on first write, never overwritten: the numbers are meaningless
    // without knowing what period they cover.
    if (!localStorage.getItem(SINCE_KEY)) localStorage.setItem(SINCE_KEY, localDateStr());
  } catch {
    /* counting is never worth an exception */
  }
}

export function getCounters() {
  return _read();
}

// The local date counting began, or null before the first bump.
export function getCountersSince() {
  try {
    return localStorage.getItem(SINCE_KEY);
  } catch {
    return null;
  }
}

// Raw counts plus the two ratios worth reading, computed here so they're
// testable and so Settings only has to format. Rates are null rather than 0
// when the denominator is empty — "no data yet" and "0%" are different claims,
// and rendering the second for the first is how a dashboard lies.
export function getCounterSummary() {
  const c = _read();
  const n = k => (Number.isFinite(c[k]) ? c[k] : 0);

  const started   = n(COUNTERS.SESSIONS_STARTED);
  const completed = n(COUNTERS.SESSIONS_COMPLETED);
  const manual    = n(COUNTERS.SETS_MANUAL);
  const quick     = n(COUNTERS.SETS_QUICK);
  const sets      = manual + quick;

  return {
    counts: Object.fromEntries(COUNTER_LABELS.map(([k]) => [k, n(k)])),
    since: getCountersSince(),
    totalSets: sets,
    // Finished ÷ started. Capped at 100: a session started before counting
    // began can still be finished after, and a rate over 100% reads as a bug.
    completionRate: started ? Math.min(100, Math.round((completed / started) * 100)) : null,
    quickLogShare: sets ? Math.round((quick / sets) * 100) : null,
  };
}

// Only "Clear Everything" removes these (it sweeps every gymops_* key).
// "Reset Workout Data" deliberately leaves them: they record how the APP has
// been used, which a training-history reset does not undo.
