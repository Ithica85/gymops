// ═══════════════════════════════════════════════════════
// GymOps — Import flow UI (6.2)
// ═══════════════════════════════════════════════════════
//
// One bottom sheet, four stages: choose → (unit, Strong only) → preview →
// done. The ordering is the point: the user sees exactly what will happen to
// their history before a single row is written, and a snapshot is taken even
// then.
//
// Two rules this flow exists to enforce:
//
//   1. The unit is asked, never guessed. A Strong export does not record kg
//      vs lbs (js/import.js), and guessing wrong silently corrupts every
//      weight a switcher owns.
//   2. An unresolved exercise name defaults to "keep as new", never to a
//      merge. A spurious new exercise is recoverable — rename or merge it
//      later. A wrong merge silently rewrites history that looked correct.

import {
  dbDiscardImportSnapshot,
  dbImportSessions,
  dbSnapshotBeforeImport,
  dbUndoImport,
} from './db.js';
import { parseImport, resolveImportExercises, detectImportSource } from './import.js';
import { localDateStr } from './state.js';
import { showToast } from './ui.js';
import { bumpCounter, COUNTERS } from './counters.js';

// Flow state. Cleared on every open so a cancelled import can't leak into the
// next one.
let _text = null;      // raw file text
let _detected = null;  // { source, label, unitKnown }
let _unit = null;      // 'kg' | 'lbs' — only asked for Strong
let _parsed = null;    // parseImport result
let _choices = null;   // Map(rawName → final name) for ambiguous entries

const STAGES = ['choose', 'unit', 'preview', 'done'];

function $(id) { return document.getElementById(id); }

function _showStage(name) {
  for (const s of STAGES) $(`import-stage-${s}`).classList.toggle('hidden', s !== name);
  $('import-error').classList.add('hidden');
}

function _fail(message) {
  const el = $('import-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

export function openImport() {
  _text = _detected = _unit = _parsed = _choices = null;
  $('import-title').textContent = 'Import workouts';
  $('import-file-input').value = ''; // so re-choosing the same file still fires change
  document.querySelectorAll('[data-import-unit]').forEach(b => b.classList.remove('unit-btn--active'));
  _showStage('choose');
  $('import-modal').classList.remove('hidden');
}

export function closeImport() {
  $('import-modal').classList.add('hidden');
}

// ── Stage 1: choose a file ────────────────────────────

export async function handleImportFile(file) {
  if (!file) return;
  try {
    _text = await file.text();
  } catch (_) {
    _fail("That file couldn't be read.");
    return;
  }

  _detected = detectImportSource(_text);
  if (!_detected) {
    _fail("That doesn't look like a Strong or Hevy export. Check you exported the workout CSV.");
    return;
  }

  $('import-title').textContent = `Import from ${_detected.label}`;
  if (_detected.unitKnown) { _parseAndPreview('kg'); return; }
  _showStage('unit');
}

// ── Stage 2: the unit question (Strong only) ──────────

export function setImportUnit(unit) {
  _unit = unit;
  document.querySelectorAll('[data-import-unit]').forEach(b => {
    b.classList.toggle('unit-btn--active', b.dataset.importUnit === unit);
  });
}

export function confirmImportUnit() {
  if (!_unit) { _fail('Choose kg or lbs to continue.'); return; }
  _parseAndPreview(_unit);
}

// ── Stage 3: preview + decisions ──────────────────────

function _parseAndPreview(unit) {
  try {
    _parsed = parseImport(_text, { unit });
  } catch (err) {
    _showStage('choose');
    _fail(err.message);
    return;
  }

  const { resolved, needsDecision } = resolveImportExercises(_parsed);

  // Conservative default: anything ambiguous stays a NEW exercise unless the
  // user actively picks a catalogue match.
  _choices = new Map();
  for (const item of needsDecision) _choices.set(item.raw, item.name);

  _renderSummary(resolved, needsDecision);
  _renderDecisions(needsDecision);
  _showStage('preview');
}

function _renderSummary(resolved, needsDecision) {
  const { sessions, sets, exercises, skipped, firstDate, lastDate } = _parsed.stats;
  const span = firstDate && lastDate
    ? `${localDateStr(firstDate)} → ${localDateStr(lastDate)}`
    : '';
  const matched = exercises - needsDecision.length;

  const lines = [
    `${sessions} workout${sessions === 1 ? '' : 's'} · ${sets} set${sets === 1 ? '' : 's'}`,
    span,
    `${matched} of ${exercises} exercises matched automatically`,
  ];
  if (needsDecision.length) {
    lines.push(`${needsDecision.length} need${needsDecision.length === 1 ? 's' : ''} a decision below`);
  }
  if (skipped) lines.push(`${skipped} row${skipped === 1 ? '' : 's'} skipped as unreadable`);
  if (_parsed.unitWasAsked) lines.push(`Weights read as ${_parsed.unit}`);

  // textContent + pre-line: the file's own strings never reach innerHTML.
  $('import-summary').textContent = lines.filter(Boolean).join('\n');
}

// One row per unresolved name: the name as the source wrote it, then the
// candidate matches, then the always-present "Keep as new" which is selected
// by default.
function _renderDecisions(needsDecision) {
  const host = $('import-decisions');
  host.innerHTML = '';
  if (!needsDecision.length) return;

  for (const item of needsDecision) {
    const row = document.createElement('div');
    row.className = 'import-decision';

    const name = document.createElement('p');
    name.className = 'import-decision-name';
    name.textContent = item.raw;
    row.appendChild(name);

    const opts = document.createElement('div');
    opts.className = 'import-decision-options';

    const choices = [...item.candidates.map(c => c.name), item.name];
    for (const choice of choices) {
      const btn = document.createElement('button');
      btn.className = 'import-choice';
      btn.textContent = choice === item.name ? `Keep as "${choice}"` : choice;
      btn.classList.toggle('import-choice--active', _choices.get(item.raw) === choice);
      btn.addEventListener('click', () => {
        _choices.set(item.raw, choice);
        [...opts.children].forEach(b => b.classList.remove('import-choice--active'));
        btn.classList.add('import-choice--active');
      });
      opts.appendChild(btn);
    }

    row.appendChild(opts);
    host.appendChild(row);
  }
}

// ── Stage 4: write ────────────────────────────────────

export async function confirmImport() {
  if (!_parsed) return;
  const btn = $('btn-import-confirm');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  try {
    // Snapshot BEFORE the first write. A failure here aborts the import
    // rather than proceeding un-undoable (A6).
    await dbSnapshotBeforeImport();
  } catch (_) {
    btn.disabled = false;
    btn.textContent = 'Import';
    _fail("Couldn't prepare a safety snapshot, so nothing was imported. Free up some device storage and try again.");
    return;
  }

  // Resolve every set to its final name: confident matches from the resolver,
  // ambiguous ones from the user's choice.
  const { resolved } = resolveImportExercises(_parsed);
  for (const session of _parsed.sessions) {
    for (const set of session.sets) {
      set.exercise = _choices.get(set.exerciseRaw) ?? resolved.get(set.exerciseRaw).name;
    }
  }

  let result;
  try {
    result = dbImportSessions(_parsed.sessions, { unit: _parsed.unit });
    bumpCounter(COUNTERS.IMPORTS_RUN); // only a write that actually landed counts
  } catch (err) {
    await dbUndoImport(); // roll back a partial write before surfacing anything
    btn.disabled = false;
    btn.textContent = 'Import';
    _fail(`Import failed and nothing was changed: ${err.message}`);
    return;
  }

  btn.disabled = false;
  btn.textContent = 'Import';

  const lines = [`Imported ${result.sessions} workout${result.sessions === 1 ? '' : 's'} · ${result.sets} set${result.sets === 1 ? '' : 's'}`];
  if (result.duplicateSessions) {
    lines.push(`${result.duplicateSessions} already in your history — skipped, not duplicated`);
  }
  $('import-result').textContent = lines.join('\n');
  $('import-title').textContent = 'Import complete';
  _showStage('done');
}

// Accepting the import drops the snapshot — keeping it forever would leave a
// full second copy of the database on a device the user may be short of space
// on, and the undo offer has already been declined.
export async function finishImport() {
  await dbDiscardImportSnapshot();
  closeImport();
  showToast('History imported');
  location.reload(); // rebuild every screen against the new history
}

export async function undoImportNow() {
  const ok = await dbUndoImport();
  if (!ok) { _fail('Nothing to undo.'); return; }
  closeImport();
  location.reload();
}
