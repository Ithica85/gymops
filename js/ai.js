// ═══════════════════════════════════════════════════════
// GymOps — AI session summary — builds context, calls /api/ai-summary
// ═══════════════════════════════════════════════════════

import { dbGetAllSets, dbGetPlanDays, dbGetRecentSessionsBestForExercise, dbGetSessionPlan } from './db.js';
import { getWeightUnit, state } from './state.js';
import { getAnthropicKey } from './settings.js';

// Builds a compact text description of the completed session for the prompt.
// Groups sets by exercise in first-occurrence order, then summarises each.
function _buildSessionContext(sessionId) {
  const sets = [...dbGetAllSets(sessionId)].reverse(); // ASC order
  const unit = getWeightUnit();
  const order = [];
  const groups = {};
  for (const s of sets) {
    if (!groups[s.exercise]) { groups[s.exercise] = []; order.push(s.exercise); }
    groups[s.exercise].push(s);
  }
  const lines = [];
  for (const ex of order) {
    const exSets = groups[ex];
    if (exSets[0].duration_mins != null) {
      const totalMins = exSets.reduce((sum, s) => sum + (s.duration_mins ?? 0), 0);
      const cals = exSets.reduce((sum, s) => sum + (s.calories ?? 0), 0);
      lines.push(`${ex}: ${Math.round(totalMins)} mins${cals ? `, ${cals} cal` : ''}`);
    } else {
      const weighted = exSets.filter(s => s.weight != null);
      if (!weighted.length) continue;
      const bestKg = Math.max(...weighted.map(s =>
        s.unit === 'lbs' ? s.weight / 2.2046 : s.weight
      ));
      const displayBest = unit === 'lbs'
        ? Math.round(bestKg * 2.2046)
        : Math.round(bestKg * 10) / 10;
      const bestReps = Math.max(...exSets.map(s => s.reps ?? 0));
      const history = dbGetRecentSessionsBestForExercise(ex, 5, sessionId);
      let histNote = '';
      if (history.length > 0) {
        const deltaKg = bestKg - history[0].best_weight_kg;
        if (deltaKg >= 0.5) {
          const d = unit === 'lbs' ? Math.round(deltaKg * 2.2046) : Math.round(deltaKg * 10) / 10;
          histNote = ` (+${d}${unit} vs last session)`;
        } else if (deltaKg <= -0.5) {
          const d = unit === 'lbs' ? Math.round(Math.abs(deltaKg) * 2.2046) : Math.round(Math.abs(deltaKg) * 10) / 10;
          histNote = ` (-${d}${unit} vs last session)`;
        } else {
          histNote = ' (matched previous best)';
        }
      }
      lines.push(`${ex}: best ${displayBest}${unit} × ${bestReps} reps, ${exSets.length} sets${histNote}`);
    }
  }
  // Append plan context if this session was linked to a plan
  const plan = dbGetSessionPlan(sessionId);
  if (plan) {
    const startDate   = new Date(plan.start_date);
    const weekNumber  = Math.floor((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    const durationStr = plan.duration_weeks ? ` (${weekNumber} of ${plan.duration_weeks} weeks)` : '';
    lines.push('');
    lines.push(`Plan: ${plan.name}${durationStr}`);
    if (plan.day) {
      const days = dbGetPlanDays(plan.plan_id);
      const idx  = days.findIndex(d => d.day_id === plan.day.day_id);
      lines.push(`Day trained: ${plan.day.name}${days.length > 1 ? ` (day ${idx + 1} of ${days.length})` : ''}`);
    }
    const objectives = plan.objectives_json ? JSON.parse(plan.objectives_json) : [];
    if (objectives.length) lines.push(`Objectives: ${objectives.join('; ')}`);
    const planNames  = plan.exercises.map(e => e.exercise);
    const loggedNames = [...new Set(dbGetAllSets(sessionId).map(s => s.exercise))];
    const done    = planNames.filter(n => loggedNames.includes(n));
    const skipped = planNames.filter(n => !loggedNames.includes(n));
    const extra   = loggedNames.filter(n => !planNames.includes(n));
    if (done.length)    lines.push(`Completed plan exercises: ${done.join(', ')}`);
    if (skipped.length) lines.push(`Skipped: ${skipped.join(', ')}`);
    if (extra.length)   lines.push(`Added outside plan: ${extra.join(', ')}`);
  }

  return lines.join('\n');
}

export async function generateAISummary() {
  const textEl = document.getElementById('ai-summary-text');
  document.getElementById('ai-summary-modal').classList.remove('hidden');
  textEl.className = 'ai-summary-text loading';
  textEl.textContent = 'Generating…';

  const key = getAnthropicKey();
  if (!key) {
    textEl.className = 'ai-summary-text error';
    textEl.textContent = 'Add your Anthropic API key in Settings → AI to enable this feature.';
    return;
  }

  const context = _buildSessionContext(state.sessionId);

  try {
    const resp = await fetch('/api/ai-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, apiKey: key }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      textEl.className = 'ai-summary-text error';
      textEl.textContent = data.error ?? `Error (${resp.status})`;
      return;
    }

    textEl.className = 'ai-summary-text';
    textEl.textContent = data.text ?? 'Summary unavailable — great workout either way!';
  } catch (_) {
    textEl.className = 'ai-summary-text error';
    textEl.textContent = 'Network error. Check your connection and try again.';
  }
}

export function hideAISummaryModal() {
  document.getElementById('ai-summary-modal').classList.add('hidden');
}

// ── Boot ──────────────────────────────────────────────
