// ═══════════════════════════════════════════════════════
// GymOps — Idle screen: dashboard, IDLE_BANNERS mediator, smart session reminder (F-04)
// ═══════════════════════════════════════════════════════

import {
  dbGetActivePlan,
  dbGetCompletedSessionsSince,
  dbGetLastCompletedSession,
  dbGetNextPlanDay,
  dbGetPlanDays,
  dbGetRecentSessionStartTimes,
  dbGetRecentSessionsBestForExercise,
  dbGetSessionBestForExercise,
  dbGetSessionExerciseCount,
  dbGetSessionRepsExercises,
  dbGetSetCount,
  dbGetSetCountsByExerciseSince,
  dbHasSessionToday,
} from './db.js';
import { MUSCLE_GROUPS, WEIGHT_EPSILON_KG, convertWeight, getExerciseGroup, getWeightUnit } from './state.js';
import { onScreenShow } from './ui.js';
import { computePlanExpiryBanner, computePlanNudgeBanner } from './plans.js';

const REMINDER_KEY          = 'gymops_reminder_enabled';

const REMINDER_DISMISSED_AT = 'gymops_reminder_dismissed_at';

const REMINDER_DISMISSALS   = 'gymops_reminder_dismissals';

const REMINDER_OFFSET_MIN   = 'gymops_reminder_offset_min';

const REMINDER_WINDOW_MIN   = 90;  // ± minutes around predicted time to show banner

const REMINDER_OVERDUE_MIN  = 180; // minutes past predicted time before giving up

const REMINDER_COOLDOWN_MS  = 24 * 60 * 60 * 1000; // 24h between banners

const REMINDER_MIN_SESSIONS = 4;   // minimum sessions before pattern detection activates

const REMINDER_MAX_STDDEV   = 240; // max std dev (mins) — beyond this, pattern is too irregular

export function getReminderEnabled() { return localStorage.getItem(REMINDER_KEY) === 'true'; }

export function setReminderEnabled(v) {
  localStorage.setItem(REMINDER_KEY, v ? 'true' : 'false');
  document.querySelectorAll('.reminder-btn').forEach(btn => {
    btn.classList.toggle('unit-btn--active', btn.dataset.reminder === String(v));
  });
  checkIdleBanners(); // re-evaluate: hides the reminder when disabled, may show it when enabled
}

// Returns { meanMinutes, stdDevMinutes } from ISO start_time strings, or null if
// the pattern is too irregular (std dev > REMINDER_MAX_STDDEV).
export function computeTrainingWindow(startTimes) {
  const minutes = startTimes.map(t => {
    const d = new Date(t);
    return d.getHours() * 60 + d.getMinutes();
  });
  const mean    = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  const stdDev  = Math.sqrt(minutes.reduce((s, m) => s + (m - mean) ** 2, 0) / minutes.length);
  if (stdDev > REMINDER_MAX_STDDEV) return null;
  return { meanMinutes: mean, stdDevMinutes: stdDev };
}

function hideReminderBanner() {
  document.getElementById('reminder-banner').classList.add('hidden');
}

export function dismissReminderBanner() {
  hideReminderBanner();
  localStorage.setItem(REMINDER_DISMISSED_AT, Date.now().toString());
  const dismissals = parseInt(localStorage.getItem(REMINDER_DISMISSALS) ?? '0') + 1;
  localStorage.setItem(REMINDER_DISMISSALS, dismissals.toString());
  // After every 3 dismissals, shift the predicted time forward by 30 minutes
  if (dismissals % 3 === 0) {
    const offset = parseInt(localStorage.getItem(REMINDER_OFFSET_MIN) ?? '0');
    localStorage.setItem(REMINDER_OFFSET_MIN, (offset + 30).toString());
  }
}

// Decides whether the generic session reminder (F-04) should show.
// Returns a render thunk that fills in the banner text, or null.
// Priority against the plan banners is handled by IDLE_BANNERS order, not here.
export function computeReminderBanner() {
  if (!getReminderEnabled()) return null;

  const startTimes = dbGetRecentSessionStartTimes(10);
  if (startTimes.length < REMINDER_MIN_SESSIONS) return null;
  if (dbHasSessionToday()) return null;

  const lastDismissed = parseInt(localStorage.getItem(REMINDER_DISMISSED_AT) ?? '0');
  if (Date.now() - lastDismissed < REMINDER_COOLDOWN_MS) return null;

  const window = computeTrainingWindow(startTimes);
  if (!window) return null;

  const now            = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const offset         = parseInt(localStorage.getItem(REMINDER_OFFSET_MIN) ?? '0');
  const targetMinutes  = window.meanMinutes + offset;
  const diff           = currentMinutes - targetMinutes;

  if (diff < -REMINDER_WINDOW_MIN || diff > REMINDER_OVERDUE_MIN) return null;
  const overdue = diff > REMINDER_WINDOW_MIN;
  return () => {
    document.getElementById('reminder-text').textContent = overdue
      ? "Haven't trained yet today"
      : 'Time to train';
  };
}

// ── Idle banners (mediator) ───────────────────────────

// The idle screen shows at most ONE banner at a time. Entries are in priority
// order: the first compute() that returns a render thunk wins; every other
// banner is hidden. To add a banner, add an entry at the right priority —
// no cross-banner visibility checks needed.
export const IDLE_BANNERS = [
  { id: 'plan-expiry-banner', compute: computePlanExpiryBanner },
  { id: 'plan-nudge-banner',  compute: computePlanNudgeBanner  },
  { id: 'reminder-banner',    compute: computeReminderBanner   },
];

// Evaluates all idle banners in priority order. Called on every idle screen
// visit and whenever a setting changes banner eligibility.
function checkIdleBanners() {
  let winner = null;
  for (const banner of IDLE_BANNERS) {
    document.getElementById(banner.id).classList.add('hidden');
    if (!winner) {
      const render = banner.compute();
      if (render) winner = { id: banner.id, render };
    }
  }
  if (winner) {
    winner.render();
    document.getElementById(winner.id).classList.remove('hidden');
  }
}

// ── Progression signal ────────────────────────────────

// Returns midnight on the Monday of the week containing d (local time).
export function _weekStart(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); // Mon=0 … Sun=6
  return date;
}

// Human-relative day for the hook line: "today", "yesterday", "on Tuesday"
// (within the last week), or "12 days ago".
function _relativeDay(iso) {
  const d     = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that  = new Date(d);
  that.setHours(0, 0, 0, 0);
  const days  = Math.round((today - that) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7)  return 'on ' + d.toLocaleDateString(undefined, { weekday: 'long' });
  return `${days} days ago`;
}

// Renders the 7-day week strip (Mon–Sun) and the consecutive-week streak.
// Hidden entirely until the first completed session exists.
function renderWeekStrip() {
  const card = document.getElementById('week-strip');
  if (!dbGetLastCompletedSession()) { card.classList.add('hidden'); return; }

  const thisWeek = _weekStart(new Date());
  const lookback = new Date(thisWeek.getTime() - 25 * 7 * 86400000); // ~6 months for streak
  const sessions = dbGetCompletedSessionsSince(lookback.toISOString());

  // Trained day indexes (Mon=0) for the current week
  const trained = new Set();
  // Week-start timestamps that contain at least one session (for the streak)
  const weeks = new Set();
  sessions.forEach(t => {
    const d = new Date(t);
    weeks.add(_weekStart(d).getTime());
    if (d >= thisWeek) trained.add((d.getDay() + 6) % 7);
  });

  const days = document.getElementById('week-strip-days');
  days.innerHTML = '';
  const todayIdx = (new Date().getDay() + 6) % 7;
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((letter, i) => {
    const col = document.createElement('div');
    col.className = 'week-day';
    if (trained.has(i)) col.classList.add('week-day--trained');
    if (i === todayIdx) col.classList.add('week-day--today');
    const dot = document.createElement('span');
    dot.className = 'week-day-dot';
    const lbl = document.createElement('span');
    lbl.className = 'week-day-letter';
    lbl.textContent = letter;
    col.append(dot, lbl);
    days.appendChild(col);
  });

  // Streak = consecutive calendar weeks with ≥1 session, ending at the current
  // week. An untrained current week doesn't break the streak yet — it just
  // isn't counted — so the streak survives until a full week is missed.
  let cursor = weeks.has(thisWeek.getTime())
    ? thisWeek.getTime()
    : thisWeek.getTime() - 7 * 86400000;
  let streak = 0;
  while (weeks.has(cursor)) {
    streak++;
    cursor -= 7 * 86400000;
  }
  const streakEl = document.getElementById('week-strip-streak');
  streakEl.classList.toggle('hidden', streak < 2);
  if (streak >= 2) streakEl.textContent = `${streak}-week streak`;

  renderMuscleCoverage();
  card.classList.remove('hidden');
}

// Folds { exercise, set_count } rows into per-muscle-group set totals, in
// MUSCLE_GROUPS display order. Exercises with no group (custom "Other" names)
// are skipped — they were deliberately never forced into a group.
export function computeMuscleCoverage(rows) {
  const totals = new Map(MUSCLE_GROUPS.map(g => [g, 0]));
  rows.forEach(({ exercise, set_count }) => {
    const group = getExerciseGroup(exercise);
    if (group) totals.set(group, totals.get(group) + set_count);
  });
  return MUSCLE_GROUPS.map(group => ({ group, sets: totals.get(group) }));
}

// Renders the muscle-coverage chip row inside the week-strip card: one chip
// per group, lit with its set count when trained this week, dimmed otherwise.
// An all-dim row is intentional — it shows what the week is still missing.
function renderMuscleCoverage() {
  const row = document.getElementById('week-strip-coverage');
  row.innerHTML = '';
  const weekISO = _weekStart(new Date()).toISOString();
  computeMuscleCoverage(dbGetSetCountsByExerciseSince(weekISO)).forEach(({ group, sets }) => {
    const chip = document.createElement('span');
    chip.className = 'coverage-chip' + (sets > 0 ? ' coverage-chip--hit' : '');
    chip.textContent = group;
    if (sets > 0) {
      const count = document.createElement('span');
      count.className = 'coverage-chip-count';
      count.textContent = sets;
      chip.appendChild(count);
    }
    row.appendChild(chip);
  });
}

// Sets the idle subtitle: a hook from the last session when history exists
// ("Chest Press hit 65 kg on Tuesday — beat it?"), a session summary when
// nothing improved, or the default "Ready to train" for a fresh install.
function renderIdleHook() {
  const el   = document.getElementById('idle-subtitle');
  const last = dbGetLastCompletedSession();
  if (!last) {
    el.textContent = 'Ready to train';
    el.classList.remove('idle-subtitle--hook');
    return;
  }

  const when = _relativeDay(last.start_time);

  // Best improvement in the last session vs each exercise's prior history —
  // same comparison the completion signal makes (kg-normalised).
  let bestDeltaKg  = 0;
  let bestExercise = null;
  let bestKg       = null;
  dbGetSessionRepsExercises(last.session_id).forEach(exercise => {
    const currentBestKg = dbGetSessionBestForExercise(last.session_id, exercise);
    const history       = dbGetRecentSessionsBestForExercise(exercise, 1, last.session_id);
    if (!history.length || currentBestKg == null) return;
    const delta = currentBestKg - history[0].best_weight_kg;
    if (delta > WEIGHT_EPSILON_KG && delta > bestDeltaKg) {
      bestDeltaKg  = delta;
      bestExercise = exercise;
      bestKg       = currentBestKg;
    }
  });

  if (bestExercise) {
    const unit  = getWeightUnit();
    const value = convertWeight(bestKg, 'kg', unit);
    el.textContent = `${bestExercise} hit ${value} ${unit} ${when} — beat it?`;
  } else {
    const sets      = dbGetSetCount(last.session_id);
    const exercises = dbGetSessionExerciseCount(last.session_id);
    el.textContent  = `Last workout ${when} — ${sets} set${sets !== 1 ? 's' : ''} across ${exercises} exercise${exercises !== 1 ? 's' : ''}`;
  }
  el.classList.add('idle-subtitle--hook');
}

// Shows the active plan and current week number below the week strip; for
// multi-day plans, also which day the next session will land on (5.2).
function renderIdlePlanLine() {
  const el   = document.getElementById('idle-plan-line');
  const plan = dbGetActivePlan();
  if (!plan) { el.classList.add('hidden'); return; }
  const weekNum = Math.floor((Date.now() - new Date(plan.start_date).getTime()) / (7 * 86400000)) + 1;
  let text = `${plan.name} · Week ${weekNum}${plan.duration_weeks ? ` of ${plan.duration_weeks}` : ''}`;
  if (dbGetPlanDays(plan.plan_id).length > 1) {
    const next = dbGetNextPlanDay(plan.plan_id);
    if (next) text += ` · Next: ${next.name}`;
  }
  el.textContent = text;
  el.classList.remove('hidden');
}

function renderIdleDashboard() {
  renderIdleHook();
  renderWeekStrip();
  renderIdlePlanLine();
}

// Re-render the dashboard and re-evaluate banners every time idle is shown
onScreenShow('idle', () => { renderIdleDashboard(); checkIdleBanners(); });

// ── Exercise history ──────────────────────────────────
