// ═══════════════════════════════════════════════════════
// GymOps — AI routine import (Plans screen "Import with AI").
// Turns a natural-language description into a plan draft: calls
// /api/generate-plan, maps the returned exercise names onto the catalogue,
// then hands the draft to the plan editor for REVIEW. It never writes a plan —
// the user edits and taps Save like any other new plan.
// ═══════════════════════════════════════════════════════

import { EXERCISES, getExerciseType } from './state.js';
import { getAnthropicKey } from './settings.js';
import { openPlanFromDraft } from './plans.js';

// Normalised catalogue name → entry, built once. Normalisation lets "bench
// press", "Bench Press", and "bench-press" all resolve to the catalogue row.
const _byNorm = new Map();
for (const e of EXERCISES) _byNorm.set(_norm(e.name), e);

function _norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Maps an AI exercise name onto the catalogue (exact normalised match), else
// keeps it as a custom name (type inferred by getExerciseType's cardio
// keywords). Returns { exercise, type }.
function _mapExercise(name) {
  const hit = _byNorm.get(_norm(name));
  if (hit) return { exercise: hit.name, type: hit.type };
  const clean = String(name ?? '').trim();
  return { exercise: clean, type: getExerciseType(clean) };
}

function _clampInt(v, lo, hi) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
}

// Turns the API's plan JSON into the editor's draft shape (_editingDays),
// clamping every number and dropping empty days — the model output is
// untrusted, so nothing reaches the editor unvalidated.
function _toDraft(plan) {
  const days = (Array.isArray(plan?.days) ? plan.days : []).slice(0, 7).map((d, i) => ({
    dayId: null,
    name: (d?.name ? String(d.name) : `Day ${i + 1}`).slice(0, 30),
    exercises: (Array.isArray(d?.exercises) ? d.exercises : []).slice(0, 12).map(ex => {
      const { exercise, type } = _mapExercise(ex?.exercise ?? '');
      return {
        exercise, type,
        targetSets: _clampInt(ex?.sets, 1, 20),
        targetReps: _clampInt(ex?.reps, 1, 100),
      };
    }).filter(e => e.exercise),
  })).filter(d => d.exercises.length);

  return {
    name: (plan?.name ? String(plan.name) : 'Imported Plan').slice(0, 60),
    durationWeeks: _clampInt(plan?.duration_weeks, 1, 52),
    objectives: (Array.isArray(plan?.objectives) ? plan.objectives : [])
      .slice(0, 3).map(o => String(o).slice(0, 80)),
    days,
  };
}

let _busy = false;

// Reads the textarea, calls the endpoint, and on success opens the plan editor
// pre-filled for review. All UI state (loading / error) is toggled here.
export async function importPlanFromPrompt() {
  if (_busy) return;
  const input   = document.getElementById('plan-import-input');
  const genBtn  = document.getElementById('btn-plan-import-generate');
  const text    = input.value.trim();

  document.getElementById('plan-import-error').classList.add('hidden');
  if (!text) { _showImportError('Describe the routine to import.'); return; }

  const key = getAnthropicKey();
  if (!key) { _showImportError('Add an Anthropic API key in Settings → AI first.'); return; }

  _busy = true;
  genBtn.disabled = true;
  genBtn.textContent = 'Generating…';

  try {
    const resp = await fetch('/api/generate-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, apiKey: key, exercises: EXERCISES.map(e => e.name) }),
    });
    const data = await resp.json();
    if (!resp.ok) { _showImportError(data.error ?? `Error (${resp.status})`); return; }

    const draft = _toDraft(data.plan ?? {});
    if (!draft.days.length) { _showImportError('The AI returned no usable exercises. Try rephrasing.'); return; }

    closePlanImport();
    openPlanFromDraft(draft); // hands off to the editor — user reviews, edits, Saves
  } catch (_) {
    _showImportError('Network error. Check your connection and try again.');
  } finally {
    _busy = false;
    genBtn.disabled = false;
    genBtn.textContent = 'Generate';
  }
}

function _showImportError(msg) {
  const errorEl = document.getElementById('plan-import-error');
  errorEl.textContent = msg; // API error text — textContent, never innerHTML
  errorEl.classList.remove('hidden');
}

export function openPlanImport() {
  document.getElementById('plan-import-input').value = '';
  document.getElementById('plan-import-error').classList.add('hidden');
  const genBtn = document.getElementById('btn-plan-import-generate');
  genBtn.disabled = false;
  genBtn.textContent = 'Generate';
  document.getElementById('plan-import-modal').classList.remove('hidden');
}

export function closePlanImport() {
  document.getElementById('plan-import-modal').classList.add('hidden');
}

// Pure mapping helpers, exported for tests.
export const _test = { _toDraft, _mapExercise, _norm };
