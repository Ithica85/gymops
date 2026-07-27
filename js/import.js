// ═══════════════════════════════════════════════════════
// GymOps — Strong / Hevy CSV import: parse + normalise (6.2)
// ═══════════════════════════════════════════════════════
//
// Parsing only. This module never touches the database — it turns a CSV file
// into a normalised, inspectable structure that the import pipeline can show
// the user *before* anything is written. Nothing here is destructive, which is
// what makes the preview step possible.
//
// Header-driven by design: columns are located by name, not position, so an
// export from a different app version with reordered or extra columns still
// imports. Both vendors have changed their format before; positional parsing
// would break silently and write garbage.
//
// ── Verified format facts (checked against published sample exports) ──
//
// Strong: Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,
//         Distance,Seconds,Notes,Workout Notes,RPE
//   · Date is "YYYY-MM-DD HH:MM:SS" and is the session key
//   · Unused Distance/Seconds are the sentinel 0, not empty
//   · **The unit is NOT recorded.** A Strong export cannot tell you whether
//     "40.0" is kg or lbs — the caller must supply it. Guessing would
//     silently corrupt every weight a switcher owns.
//
// Hevy: title,start_time,end_time,description,exercise_title,superset_id,
//       exercise_notes,set_index,set_type,weight_kg,reps,distance_km,
//       duration_seconds,rpe
//   · start_time is "DD MMM YYYY, HH:MM" and is the session key
//   · weight is explicitly kg — no question to ask
//   · set_type carries warmup/dropset/failure

import { resolveExerciseName } from './aliases.js';

// ── CSV reader ────────────────────────────────────────

// RFC4180-ish: quoted fields, embedded delimiters/newlines, "" escapes.
// Written as a character scanner rather than a regex or a naive split because
// exercise notes routinely contain commas and quotes, and a row that
// mis-splits becomes a silently wrong set rather than a visible error.
function _parseCSV(text, delimiter) {
  const rows = [];
  let row = [], field = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }  // escaped quote
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delimiter) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

// Some locales export Strong with semicolons (and then decimal commas).
// Sniffed from the header line rather than assumed.
function _sniffDelimiter(text) {
  const firstLine = text.split('\n', 1)[0] ?? '';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis  = (firstLine.match(/;/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

// ── Field coercion ────────────────────────────────────

// Handles the comma-decimal locales that ship with semicolon delimiters
// ("62,5"), the same normalisation logSet already does on manual entry.
function _num(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function _int(v) {
  const n = _num(v);
  return n == null ? null : Math.round(n);
}

// Strong: "2020-12-30 18:51:52" (local wall time, no zone).
function _parseStrongDate(s) {
  const m = String(s ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, +(sec ?? 0));
}

const _MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

// Hevy: "22 Dec 2025, 08:00".
function _parseHevyDate(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const mo = _MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (mo < 0) return null;
  return new Date(+m[3], mo, +m[1], +m[4], +m[5]);
}

// Strong's "2h 38m" / "45m" session duration, in minutes.
function _parseDuration(s) {
  const str = String(s ?? '');
  const h = str.match(/(\d+)\s*h/);
  const m = str.match(/(\d+)\s*m/);
  if (!h && !m) return null;
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
}

// ── Format detection ──────────────────────────────────

const FORMATS = {
  strong: {
    label: 'Strong',
    required: ['date', 'exercise name'],
    unitKnown: false, // the export does not record kg vs lbs
  },
  hevy: {
    label: 'Hevy',
    required: ['start_time', 'exercise_title'],
    unitKnown: true,  // weight_kg is explicit
  },
};

function _headerIndex(headerRow) {
  const idx = {};
  headerRow.forEach((h, i) => {
    const key = String(h ?? '').replace(/^﻿/, '').trim().toLowerCase();
    if (key) idx[key] = i;
  });
  return idx;
}

function _detect(idx) {
  for (const [source, spec] of Object.entries(FORMATS)) {
    if (spec.required.every(col => col in idx)) return source;
  }
  return null;
}

// ── Row → set ─────────────────────────────────────────
//
// Schema rule: a set has EITHER (weight + reps) OR duration_mins, never both
// and never neither. Reps decide — weight 0 with reps is a valid bodyweight
// set (US-001), so weight can never be the discriminator. Only when there are
// no reps does a duration make the row a timed set.
function _classify({ weight, reps, seconds }) {
  if (reps != null && reps > 0) {
    return { weight: weight ?? 0, reps, durationMins: null };
  }
  if (seconds != null && seconds > 0) {
    return { weight: null, reps: null, durationMins: Math.round((seconds / 60) * 100) / 100 };
  }
  return null; // an empty/placeholder row — skipped, and counted as skipped
}

// ── Public API ────────────────────────────────────────

/**
 * Parses a Strong or Hevy CSV export into normalised sessions.
 *
 * `unit` is required for Strong ('kg' | 'lbs') because the export does not
 * record it; it is ignored for Hevy, whose weights are always kg.
 *
 * Returns:
 *   { source, label, unit, unitWasAsked, sessions, exercises, stats, warnings }
 * where each session is
 *   { startTime: Date, endTime: Date|null, name, notes, sets: [...] }
 * and each set is
 *   { exerciseRaw, setNumber, weight, reps, durationMins, unit, setType }
 *
 * Throws only on input that isn't a recognisable export at all — a file the
 * user can act on ("this isn't a Strong or Hevy CSV") rather than a stack
 * trace. Row-level problems become `warnings` + `stats.skipped`, so one bad
 * line never costs the other 4,000.
 */
export function parseImport(text, { unit = null } = {}) {
  const raw = String(text ?? '').replace(/^﻿/, '');
  if (!raw.trim()) throw new Error('That file is empty.');

  const rows = _parseCSV(raw, _sniffDelimiter(raw));

  // Format check precedes the row-count check on purpose: for a file that
  // isn't an export at all, "this isn't a Strong or Hevy CSV" tells the user
  // what to do next, where "no data rows" sends them looking for the wrong
  // problem in the right file.
  const idx = _headerIndex(rows[0] ?? []);
  const source = _detect(idx);
  if (!source) {
    throw new Error("That doesn't look like a Strong or Hevy export. Check you exported the workout CSV.");
  }
  if (rows.length < 2) throw new Error('That file has no data rows.');

  const spec = FORMATS[source];
  const isStrong = source === 'strong';
  if (isStrong && !unit) {
    throw new Error('Strong exports do not record kg or lbs — choose the unit before importing.');
  }
  const resolvedUnit = isStrong ? unit : 'kg';

  const at = (row, col) => (col in idx ? row[idx[col]] : undefined);
  const warnings = [];
  const bySession = new Map();
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every(c => String(c ?? '').trim() === '')) continue; // blank line

    const rawDate = isStrong ? at(row, 'date') : at(row, 'start_time');
    const when = isStrong ? _parseStrongDate(rawDate) : _parseHevyDate(rawDate);
    const exerciseRaw = String((isStrong ? at(row, 'exercise name') : at(row, 'exercise_title')) ?? '').trim();

    if (!when || !exerciseRaw) {
      skipped++;
      if (warnings.length < 20) {
        warnings.push(`Row ${r + 1}: skipped — ${!when ? 'unreadable date' : 'no exercise name'}.`);
      }
      continue;
    }

    const weight  = _num(isStrong ? at(row, 'weight') : at(row, 'weight_kg'));
    const reps    = _int(at(row, 'reps'));
    const seconds = _num(isStrong ? at(row, 'seconds') : at(row, 'duration_seconds'));

    const shape = _classify({ weight, reps, seconds });
    if (!shape) { skipped++; continue; } // empty placeholder set — silent, they're common

    const key = `${when.getTime()}|${String(at(row, isStrong ? 'workout name' : 'title') ?? '')}`;
    if (!bySession.has(key)) {
      const durationMins = isStrong ? _parseDuration(at(row, 'duration')) : null;
      const endTime = isStrong
        ? (durationMins != null ? new Date(when.getTime() + durationMins * 60000) : null)
        : _parseHevyDate(at(row, 'end_time'));
      bySession.set(key, {
        startTime: when,
        endTime,
        name:  String(at(row, isStrong ? 'workout name' : 'title') ?? '').trim(),
        notes: String(at(row, isStrong ? 'workout notes' : 'description') ?? '').trim(),
        sets: [],
      });
    }

    bySession.get(key).sets.push({
      exerciseRaw,
      ...shape,
      unit: shape.weight == null ? null : resolvedUnit,
      setType: String(at(row, 'set_type') ?? 'normal').trim().toLowerCase() || 'normal',
    });
  }

  const sessions = [...bySession.values()].sort((a, b) => a.startTime - b.startTime);

  // Set numbering is recomputed per (session, exercise) from row order rather
  // than trusted from the file. Strong's "Set Order" is 1-based and Hevy's
  // "set_index" is 0-based — and in real Hevy exports set_index has been seen
  // running across exercises rather than within one. The DB requires dense
  // per-exercise numbering, so deriving it is both safer and version-proof.
  for (const s of sessions) {
    const counters = new Map();
    for (const set of s.sets) {
      const n = (counters.get(set.exerciseRaw) ?? 0) + 1;
      counters.set(set.exerciseRaw, n);
      set.setNumber = n;
    }
  }

  const exercises = [...new Set(sessions.flatMap(s => s.sets.map(x => x.exerciseRaw)))].sort();
  const setCount  = sessions.reduce((n, s) => n + s.sets.length, 0);

  if (!setCount) throw new Error('No usable sets found in that file.');

  return {
    source,
    label: spec.label,
    unit: resolvedUnit,
    unitWasAsked: !spec.unitKnown,
    sessions,
    exercises,
    stats: {
      sessions: sessions.length,
      sets: setCount,
      exercises: exercises.length,
      skipped,
      firstDate: sessions[0]?.startTime ?? null,
      lastDate: sessions[sessions.length - 1]?.startTime ?? null,
    },
    warnings,
  };
}

/**
 * Runs every distinct exercise name in a parse result through the resolver.
 *
 * Split from parsing so the preview can show "42 matched, 3 need a decision"
 * before anything is written, and so the confirmation step has a stable list
 * to drive. Returns `{ resolved: Map(raw → resolution), needsDecision: [...] }`
 * where `needsDecision` holds only the ambiguous ones — the entries a user
 * must rule on before the import may proceed.
 */
export function resolveImportExercises(parsed) {
  const resolved = new Map();
  const needsDecision = [];
  for (const raw of parsed.exercises) {
    const resolution = resolveExerciseName(raw);
    resolved.set(raw, resolution);
    if (resolution.match === 'ambiguous') needsDecision.push({ raw, ...resolution });
  }
  return { resolved, needsDecision };
}

// Detects the format without committing to a full parse — lets the UI ask the
// Strong unit question only when the file actually is a Strong export.
export function detectImportSource(text) {
  const raw = String(text ?? '').replace(/^﻿/, '');
  const rows = _parseCSV(raw.split('\n').slice(0, 1).join('\n'), _sniffDelimiter(raw));
  const source = _detect(_headerIndex(rows[0] ?? []));
  return source ? { source, label: FORMATS[source].label, unitKnown: FORMATS[source].unitKnown } : null;
}
