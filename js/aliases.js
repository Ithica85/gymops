// ═══════════════════════════════════════════════════════
// GymOps — Exercise name resolution (6.2)
// ═══════════════════════════════════════════════════════
//
// One layer, four consumers: CSV import (6.2), the AI import fallback mapper,
// voice prefill, and the alias/merge advisor. All four are the same problem —
// a messy human string that has to become a stable `exercise_id` — so it is
// built once here and imported, never re-implemented per feature.
//
// Deterministic by construction. No model, no network, no scoring heuristics
// that can drift between releases. The ladder below is ordered by confidence,
// and the rule that matters most is the last one:
//
//   THIS MODULE NEVER SILENTLY INVENTS A CUSTOM EXERCISE ON A NEAR MISS.
//
// A near miss returns `match: 'ambiguous'` with candidates for the user to
// confirm. Minting a custom row for "Bench Press (Barbell)" because it didn't
// literally equal "Barbell Bench Press" is how a switcher's history fragments
// on day one — the precise failure the import feature exists to prevent.
//
// Import-source vocabularies (Strong, Hevy) name exercises as
// `Base (Equipment)`; the GymOps catalogue mostly names them `Equipment Base`
// and leans British/plural ("Press Ups", "Deadlifts"). Steps 3–5 exist to
// bridge those two conventions mechanically, which keeps the hand-curated
// ALIASES table small enough to stay correct.

import { CARDIO_KEYWORDS, EXERCISES, getExerciseType } from './state.js';

// ── Normalisation ─────────────────────────────────────

// Case, punctuation and spacing collapse. "Close-Grip Lat Pulldown" and
// "close grip lat  pulldown" are the same key.
function _norm(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Singular-insensitive form, applied per token. The catalogue is inconsistent
// about plurals ("Deadlifts" but "Front Squat"; "Lateral Raises" but
// "Hammer Curl") and the import sources are too, so both sides are folded to
// the same shape rather than trying to be linguistically correct — "crunches"
// becoming "crunche" is fine as long as it happens on both sides.
// 'ss' endings are protected so "press" survives.
function _singular(norm) {
  return norm
    .split(' ')
    .map(w => (w.length > 2 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

function _key(s) { return _singular(_norm(s)); }

// ── Catalogue index ───────────────────────────────────

// Built once at module load. 'Other' is a UI flow, never a resolution target.
const _catalogue = EXERCISES.filter(e => e.name !== 'Other');
const _byKey = new Map();
for (const e of _catalogue) _byKey.set(_key(e.name), e);

// Type for a name that isn't in the catalogue. `getExerciseType` is a pure
// catalogue lookup that defaults to 'reps' — it cannot type an unknown name,
// so an imported "Airdyne Bike Sprint" would land as a weight/reps exercise
// and the importer would write reps for a cardio session. The keyword sniff
// is the same one the picker's "Other" flow uses (US-002).
function _inferType(name) {
  if (_byKey.has(_key(name))) return getExerciseType(name);
  const lower = String(name ?? '').toLowerCase();
  return CARDIO_KEYWORDS.some(kw => lower.includes(kw)) ? 'timed' : 'reps';
}

// ── Curated aliases ───────────────────────────────────
//
// Only the irregulars belong here. Anything the mechanical steps already
// handle (equipment reordering, plurals, punctuation) must NOT be added —
// a redundant entry is a second source of truth that can rot.
// Keys are `_key()` form; values are exact catalogue names.
const ALIASES = {
  // Squat family — the catalogue is specific where the sources are not
  'squat':                  'Barbell Back Squat',
  'back squat':             'Barbell Back Squat',
  'barbell squat':          'Barbell Back Squat',
  'goblet squat':           'Goblet Squats',
  'split squat':            'Bulgarian Split Squat',
  // Press family
  'bench press':            'Barbell Bench Press',
  'incline bench press':    'Incline Barbell Bench Press',
  'decline bench press':    'Decline Barbell Bench Press',
  'incline press':          'Incline Dumbbell Press',
  'dumbbell incline bench press': 'Incline Dumbbell Press',
  'military press':         'Overhead Press',
  'ohp':                    'Overhead Press',
  'standing military press': 'Overhead Press',
  'push up':                'Press Ups',   // catalogue is British
  'pushup':                 'Press Ups',
  'press up':               'Press Ups',
  // Pull family
  'seated row':             'Seated Cable Row',
  'cable row':              'Seated Cable Row',
  'pulldown':               'Lat Pulldown',
  'lat pull down':          'Lat Pulldown',
  'bent over row':          'Bent Over Rows',
  'barbell row':            'Bent Over Rows',
  'one arm dumbbell row':   'Single-Arm Dumbbell Row',
  'dumbbell row':           'Single-Arm Dumbbell Row',
  // Legs
  'leg press':              'Seated Leg Press',
  'leg curl':               'Hamstring Curls',
  'lying leg curl':         'Hamstring Curls',
  'seated leg curl':        'Hamstring Curls',
  'rdl':                    'Romanian Deadlift',
  'stiff leg deadlift':     'Romanian Deadlift',
  'lunge':                  'Walking Lunges',
  // Arms — note 'triceps'/'biceps' fold to 'tricep'/'bicep' via _singular
  'tricep extension':       'Overhead Tricep Extension',
  'skullcrusher':           'Skull Crushers',
  'bicep curl':             'Dumbbell Curl',
  'preacher curl':          'Preacher Curl',
  // Core
  'crunch':                 'Crunches',
  'situp':                  'Sit Ups',
  'leg raise':              'Lying Leg Raises',
  'hanging leg raise':      'Hanging Leg Raises',
  // Cardio
  'running':                'Treadmill Run',
  'run':                    'Treadmill Run',
  'treadmill':              'Treadmill Run',
  'cycling':                'Stationary Bike',
  'bike':                   'Stationary Bike',
  'indoor bike':            'Stationary Bike',
  'rowing':                 'Rowing Machine',
  'rower':                  'Rowing Machine',
  'elliptical trainer':     'Elliptical',
  'stair climber':          'Stairmaster',
  'skipping':               'Jump Rope',
};

// Equipment qualifiers the import sources put in parentheses. Used both to
// strip and to recombine, so "Bench Press (Barbell)" can reach
// "Barbell Bench Press" without a table entry.
const EQUIPMENT = new Set([
  'barbell', 'dumbbell', 'machine', 'cable', 'smith machine', 'assisted',
  'weighted', 'bodyweight', 'band', 'kettlebell', 'ez bar', 'plate', 'sled',
  'suspension', 'plate loaded', 'lever', 'resistance band',
]);

// Splits "Bench Press (Barbell)" into { base: 'Bench Press', equip: 'barbell' }.
// A parenthetical that isn't recognised equipment (e.g. "(Left Arm)") is kept
// as part of the base so it can't silently merge two different exercises.
function _splitEquipment(raw) {
  const m = String(raw ?? '').match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return { base: String(raw ?? '').trim(), equip: null };
  const equip = _norm(m[2]);
  if (!EQUIPMENT.has(equip)) return { base: String(raw ?? '').trim(), equip: null };
  return { base: m[1].trim(), equip };
}

// Hardware that is mutually exclusive: a dumbbell exercise is not a barbell
// one. ('assisted', 'weighted' and friends are qualifiers, not hardware, so
// they are deliberately absent — they don't contradict anything.)
const EXCLUSIVE_EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'machine', 'kettlebell'];

// Guards the equipment-stripping step. Dropping "(Dumbbell)" from
// "Incline Bench Press (Dumbbell)" and matching the base alone lands on
// "Incline Barbell Bench Press" — a silent, confident, wrong merge of two
// different lifts. If the candidate names hardware the source contradicted,
// the match is refused and the name falls through to confirmation instead.
function _equipmentConflict(equip, catalogueName) {
  if (!equip) return false;
  const name = _key(catalogueName);
  const src  = _key(equip);
  return EXCLUSIVE_EQUIPMENT.some(k => {
    const other = _key(k);
    return other !== src && name.includes(other) && !name.includes(src);
  });
}

function _lookup(candidateKey, equip = null) {
  const hit = _byKey.get(candidateKey) ??
    (ALIASES[candidateKey] ? _byKey.get(_key(ALIASES[candidateKey])) : null) ?? null;
  if (!hit) return null;
  return _equipmentConflict(equip, hit.name) ? null : hit;
}

// ── Fuzzy candidates (never auto-applied) ─────────────

// Token-overlap score in [0,1]. Deliberately crude: its only job is to
// populate a confirmation list, never to decide anything on its own.
function _overlap(aKey, bKey) {
  const a = new Set(aKey.split(' '));
  const b = new Set(bKey.split(' '));
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.max(a.size, b.size);
}

const FUZZY_FLOOR = 0.5; // below this, a suggestion is noise

function _candidates(key, limit = 3) {
  return _catalogue
    .map(e => ({ name: e.name, type: e.type, score: _overlap(key, _key(e.name)) }))
    .filter(c => c.score >= FUZZY_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── Public API ────────────────────────────────────────

/**
 * Resolves a raw exercise name from an import source (or voice, or an AI
 * draft) onto the catalogue.
 *
 * Returns `{ name, type, match, candidates }` where `match` is:
 *   'exact'      — catalogue name, character for character
 *   'normalised' — same after case/punctuation/plural folding
 *   'equipment'  — matched by stripping or reordering a `(Equipment)` suffix
 *   'alias'      — matched via the curated ALIASES table
 *   'ambiguous'  — close but not certain; `candidates` is non-empty and the
 *                  CALLER MUST ASK before writing. `name` holds the cleaned
 *                  original, so confirming "keep as new exercise" is one tap.
 *   'custom'     — nothing close; treat as a genuinely new exercise
 *
 * The first four are safe to apply without asking. The last two are not.
 */
export function resolveExerciseName(raw) {
  const cleaned = String(raw ?? '').trim();
  if (!cleaned) return { name: '', type: 'reps', match: 'custom', candidates: [] };

  // 1. Exact catalogue name
  const exact = _catalogue.find(e => e.name === cleaned);
  if (exact) return { name: exact.name, type: exact.type, match: 'exact', candidates: [] };

  // 2. Normalised + singular-folded
  const key = _key(cleaned);
  const normHit = _byKey.get(key);
  if (normHit) return { name: normHit.name, type: normHit.type, match: 'normalised', candidates: [] };

  // 3. Curated alias on the whole string
  const aliasHit = ALIASES[key] ? _byKey.get(_key(ALIASES[key])) : null;
  if (aliasHit) return { name: aliasHit.name, type: aliasHit.type, match: 'alias', candidates: [] };

  // 4/5. Equipment suffix — strip it, then try reordering it onto the front
  //      and the back. "Bench Press (Barbell)" → "barbell bench press".
  const { base, equip } = _splitEquipment(cleaned);
  if (equip) {
    for (const candidate of [_key(`${equip} ${base}`), _key(base), _key(`${base} ${equip}`)]) {
      const hit = _lookup(candidate, equip);
      if (hit) return { name: hit.name, type: hit.type, match: 'equipment', candidates: [] };
    }
  }

  // 6. Close but not certain — hand back to the user, never guess.
  const candidates = _candidates(equip ? _key(base) : key);
  if (candidates.length) {
    return { name: cleaned, type: _inferType(cleaned), match: 'ambiguous', candidates };
  }

  // 7. Genuinely new. Typed by the cardio-keyword sniff (see _inferType), so
  //    a custom treadmill name lands as timed rather than as weight × reps.
  return { name: cleaned, type: _inferType(cleaned), match: 'custom', candidates: [] };
}

// True when a resolution can be written without asking the user first.
// Import must route everything else through a confirmation step.
export function isConfidentMatch(resolution) {
  return ['exact', 'normalised', 'alias', 'equipment'].includes(resolution.match);
}

// Test/diagnostic surface — lets a fixture assert the table stays honest
// (every alias target must be a real catalogue name).
export const _ALIASES = ALIASES;
