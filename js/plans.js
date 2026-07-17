// ═══════════════════════════════════════════════════════
// GymOps — Workout plans: nudge/expiry banners, plans screen, plan editor, adherence
// ═══════════════════════════════════════════════════════

import {
  dbCreatePlan,
  dbGetActivePlan,
  dbGetAllPlans,
  dbGetAllSets,
  dbGetCompletedSessionsSince,
  dbGetLastCompletedSession,
  dbGetPlan,
  dbGetPlanExercises,
  dbGetSessionPlan,
  dbHasSessionToday,
  dbSavePlanExercises,
  dbUpdatePlan,
  dbUpdatePlanStatus,
} from './db.js';
import { SIGNAL_GAP_DAYS, getExerciseType, localDateStr } from './state.js';
import { escapeHTML, onScreenShow, showScreen } from './ui.js';
import { IDLE_BANNERS, _weekStart } from './idle.js';

// Plan adherence: compares plan exercises to what was actually logged.
export function renderPlanAdherence(sessionId) {
  const el   = document.getElementById('plan-adherence');
  const plan = dbGetSessionPlan(sessionId);
  if (!plan?.exercises?.length) { el.classList.add('hidden'); return; }

  const loggedNames = new Set(dbGetAllSets(sessionId).map(s => s.exercise));
  const total       = plan.exercises.length;
  const done        = plan.exercises.filter(e => loggedNames.has(e.exercise)).length;
  const skipped     = plan.exercises.filter(e => !loggedNames.has(e.exercise)).map(e => e.exercise);

  let text = `${plan.name}: ${done}/${total} exercises`;
  if (skipped.length) text += ` · skipped ${skipped.join(', ')}`;
  el.textContent = text;
  el.classList.remove('hidden');
}

// Plan expiry banner — fires when the active plan has run over its duration.
// Returns a render thunk or null (visibility is the mediator's job).
export function computePlanExpiryBanner() {
  const plan = dbGetActivePlan();
  if (!plan || !plan.duration_weeks) return null;

  const endMs    = new Date(plan.start_date).getTime() + plan.duration_weeks * 7 * 24 * 60 * 60 * 1000;
  const daysOver = Math.floor((Date.now() - endMs) / (24 * 60 * 60 * 1000));
  if (daysOver < 0) return null;

  const daysStr = daysOver === 0 ? 'today' : `${daysOver} day${daysOver !== 1 ? 's' : ''} ago`;
  return () => {
    document.getElementById('plan-expiry-text').textContent =
      `"${plan.name}" ended ${daysStr} — time to review.`;
  };
}

// ── Plan nudges ───────────────────────────────────────

const PLAN_NUDGE_DISMISSED_AT = 'gymops_plan_nudge_dismissed_at';

const PLAN_NUDGE_COOLDOWN_MS  = 24 * 60 * 60 * 1000; // matches F-04 reminder cooldown

function hidePlanNudge() {
  document.getElementById('plan-nudge-banner').classList.add('hidden');
}

export function dismissPlanNudge() {
  hidePlanNudge();
  localStorage.setItem(PLAN_NUDGE_DISMISSED_AT, Date.now().toString());
}

// Returns the nudge message for the active plan, or null. Deterministic rules,
// priority order:
//   1. Week pace (needs target_sessions_per_week): fires when the days left in
//      the week get tight for the sessions still needed — remaining sessions
//      ≥ days left including today.
//   2. Gap (any active plan): SIGNAL_GAP_DAYS+ days since the last session.
// Never fires if there's a completed session today.
export function computePlanNudge() {
  const plan = dbGetActivePlan();
  if (!plan) return null;
  if (dbHasSessionToday()) return null;

  // Expired plans are the expiry banner's job, not a nudge
  if (plan.duration_weeks) {
    const endMs = new Date(plan.start_date).getTime() + plan.duration_weeks * 7 * 86400000;
    if (Date.now() >= endMs) return null;
  }

  // Rule 1 — week pace
  if (plan.target_sessions_per_week) {
    const thisWeek  = _weekStart(new Date());
    const done      = dbGetCompletedSessionsSince(thisWeek.toISOString()).length;
    const remaining = plan.target_sessions_per_week - done;
    const daysLeft  = 7 - ((new Date().getDay() + 6) % 7); // incl. today (Mon=7 … Sun=1)
    if (remaining > 0 && remaining >= daysLeft - 1) {
      return `${done} of ${plan.target_sessions_per_week} sessions this week — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`;
    }
  }

  // Rule 2 — idle gap while a plan is active
  const last = dbGetLastCompletedSession();
  if (last) {
    const daysSince = Math.floor((Date.now() - new Date(last.start_time).getTime()) / 86400000);
    if (daysSince >= SIGNAL_GAP_DAYS) {
      return `No training in ${daysSince} days — ${plan.name} is waiting`;
    }
  }

  return null;
}

// Plan nudge banner — cooldown gate plus the computePlanNudge() rules.
// Returns a render thunk or null. The expiry banner outranks this via
// IDLE_BANNERS order — no cross-check needed here.
export function computePlanNudgeBanner() {
  const lastDismissed = parseInt(localStorage.getItem(PLAN_NUDGE_DISMISSED_AT) ?? '0');
  if (Date.now() - lastDismissed < PLAN_NUDGE_COOLDOWN_MS) return null;

  const message = computePlanNudge();
  if (!message) return null;
  return () => {
    document.getElementById('plan-nudge-text').textContent = message; // plan names are user text
  };
}

// ── Plans screen ──────────────────────────────────────

function renderPlansScreen() {
  const active   = dbGetActivePlan();
  const cardEl   = document.getElementById('active-plan-card');
  const pastEl   = document.getElementById('past-plans-list');
  const allPlans = dbGetAllPlans();
  const past     = allPlans.filter(p => p.status !== 'active');

  if (active) {
    const exs        = dbGetPlanExercises(active.plan_id);
    const startDate  = new Date(active.start_date);
    const weekNum    = Math.floor((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    let durationStr = active.duration_weeks
      ? `Week ${weekNum} of ${active.duration_weeks}`
      : `Started ${startDate.toLocaleDateString()}`;
    if (active.target_sessions_per_week) durationStr += ` · ${active.target_sessions_per_week}×/week`;
    const objectives = active.objectives_json ? JSON.parse(active.objectives_json) : [];

    cardEl.innerHTML = `
      <div class="plan-card-header">
        <div>
          <p class="plan-card-name">${escapeHTML(active.name)}</p>
          <p class="plan-card-meta">${durationStr}</p>
        </div>
        <button class="btn-text plan-card-edit" data-plan-id="${active.plan_id}">Edit</button>
      </div>
      ${objectives.length ? `<ul class="plan-objectives-list">${objectives.map(o => `<li>${escapeHTML(o)}</li>`).join('')}</ul>` : ''}
      <p class="plan-exercises-preview">${exs.map(e => {
        const t = (e.target_sets && e.target_reps) ? ` ${e.target_sets}×${e.target_reps}` : '';
        return `${escapeHTML(e.exercise)}${t}`;
      }).join(' · ')}</p>
    `;
    cardEl.classList.remove('hidden');
    cardEl.querySelector('.plan-card-edit').addEventListener('click', () => openEditPlan(active.plan_id));
  } else {
    cardEl.innerHTML = '<p class="plan-card-empty">No active plan. Create one to guide your sessions.</p>';
    cardEl.classList.remove('hidden');
  }

  pastEl.innerHTML = '';
  if (past.length) {
    const header = document.createElement('p');
    header.className = 'settings-label';
    header.style.marginTop = '24px';
    header.textContent = 'Past Plans';
    pastEl.appendChild(header);
    past.forEach(p => {
      const row = document.createElement('div');
      row.className = 'past-plan-row';
      row.innerHTML = `
        <span class="past-plan-name">${escapeHTML(p.name)}</span>
        <button class="btn-text plan-card-edit" data-plan-id="${p.plan_id}">View</button>
      `;
      row.querySelector('.plan-card-edit').addEventListener('click', () => openEditPlan(p.plan_id));
      pastEl.appendChild(row);
    });
  }
}

onScreenShow('plans', renderPlansScreen);

// ── Plan editor ───────────────────────────────────────

let _editingPlanId    = null; // null = new plan

let _editingExercises = [];   // { exercise, type, targetSets, targetReps }

export function openNewPlan() {
  _editingPlanId    = null;
  _editingExercises = [];
  document.getElementById('plan-editor-title').textContent    = 'New Plan';
  document.getElementById('plan-name-input').value            = '';
  document.getElementById('plan-duration-input').value        = '';
  document.getElementById('plan-target-sessions-input').value = '';
  document.getElementById('plan-obj-1').value                 = '';
  document.getElementById('plan-obj-2').value                 = '';
  document.getElementById('plan-obj-3').value                 = '';
  document.getElementById('plan-save-error').classList.add('hidden');
  document.getElementById('btn-archive-plan').classList.add('hidden');
  renderPlanEditorExercises();
  showScreen('plan-editor');
}

function openEditPlan(planId) {
  const plan = dbGetPlan(planId);
  if (!plan) return;
  const exs = dbGetPlanExercises(planId);
  const objectives = plan.objectives_json ? JSON.parse(plan.objectives_json) : [];

  _editingPlanId    = planId;
  _editingExercises = exs.map(e => ({
    exercise: e.exercise, type: getExerciseType(e.exercise),
    targetSets: e.target_sets, targetReps: e.target_reps,
  }));

  document.getElementById('plan-editor-title').textContent = plan.name;
  document.getElementById('plan-name-input').value         = plan.name;
  document.getElementById('plan-duration-input').value     = plan.duration_weeks ?? '';
  document.getElementById('plan-target-sessions-input').value = plan.target_sessions_per_week ?? '';
  document.getElementById('plan-obj-1').value              = objectives[0] ?? '';
  document.getElementById('plan-obj-2').value              = objectives[1] ?? '';
  document.getElementById('plan-obj-3').value              = objectives[2] ?? '';
  document.getElementById('plan-save-error').classList.add('hidden');
  document.getElementById('btn-archive-plan').classList.toggle('hidden', plan.status !== 'active');
  renderPlanEditorExercises();
  showScreen('plan-editor');
}

function renderPlanEditorExercises() {
  const container = document.getElementById('plan-exercises-list');
  container.innerHTML = '';
  _editingExercises.forEach((ex, i) => {
    const row = document.createElement('div');
    row.className = 'plan-exercise-row';
    row.innerHTML = `
      <span class="plan-exercise-row-name">${escapeHTML(ex.exercise)}</span>
      <div class="plan-exercise-row-targets">
        <input type="number" class="plan-target-input" placeholder="Sets" value="${ex.targetSets ?? ''}" min="1" max="20" inputmode="numeric" data-idx="${i}" data-field="sets">
        <span class="plan-target-sep">×</span>
        <input type="number" class="plan-target-input" placeholder="Reps" value="${ex.targetReps ?? ''}" min="1" max="100" inputmode="numeric" data-idx="${i}" data-field="reps">
      </div>
      <button class="plan-exercise-remove" data-idx="${i}">✕</button>
    `;
    row.querySelectorAll('.plan-target-input').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.dataset.idx);
        if (inp.dataset.field === 'sets') _editingExercises[idx].targetSets = parseInt(inp.value) || null;
        else                              _editingExercises[idx].targetReps = parseInt(inp.value) || null;
      });
    });
    row.querySelector('.plan-exercise-remove').addEventListener('click', () => {
      _editingExercises.splice(i, 1);
      renderPlanEditorExercises();
    });
    container.appendChild(row);
  });
}

export function addExerciseToPlan(name, type) {
  if (_editingExercises.some(e => e.exercise === name)) return; // no duplicates
  _editingExercises.push({ exercise: name, type: type ?? getExerciseType(name), targetSets: null, targetReps: null });
  renderPlanEditorExercises();
  showScreen('plan-editor');
}

export function savePlan() {
  const name     = document.getElementById('plan-name-input').value.trim();
  const errorEl  = document.getElementById('plan-save-error');

  if (!name || !_editingExercises.length) {
    errorEl.classList.remove('hidden');
    return;
  }
  errorEl.classList.add('hidden');

  const durationWeeks  = parseInt(document.getElementById('plan-duration-input').value) || null;
  const targetSessions = parseInt(document.getElementById('plan-target-sessions-input').value) || null;
  const objectives    = [
    document.getElementById('plan-obj-1').value.trim(),
    document.getElementById('plan-obj-2').value.trim(),
    document.getElementById('plan-obj-3').value.trim(),
  ].filter(Boolean);
  const objectivesJson = objectives.length ? JSON.stringify(objectives) : null;

  if (_editingPlanId) {
    dbUpdatePlan(_editingPlanId, name, durationWeeks, objectivesJson, targetSessions);
    dbSavePlanExercises(_editingPlanId, _editingExercises);
  } else {
    // Archive any currently active plan before creating the new one
    const existing = dbGetActivePlan();
    if (existing) dbUpdatePlanStatus(existing.plan_id, 'archived');
    const planId = dbCreatePlan(name, localDateStr(), durationWeeks, objectivesJson, targetSessions);
    dbSavePlanExercises(planId, _editingExercises);
  }

  showScreen('plans');
}

export function archiveCurrentPlan() {
  if (!_editingPlanId) return;
  if (!confirm('Archive this plan? It will no longer guide your sessions.')) return;
  dbUpdatePlanStatus(_editingPlanId, 'archived');
  showScreen('plans');
}

// ── Idle dashboard ────────────────────────────────────
