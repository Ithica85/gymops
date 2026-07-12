// ═══════════════════════════════════════════════════════
// GymOps — Shared app state, constants, and the exercise catalogue
// ═══════════════════════════════════════════════════════

export const APP_VERSION = 'v3.5';

// ── Weight unit preference ────────────────────────────
// Stored in localStorage as 'kg' or 'lbs'. Each set also stores its unit at log time
// so historical PREV display converts correctly when the user switches units.
export const UNIT_KEY = 'gymops_weight_unit';

export function getWeightUnit() { return localStorage.getItem(UNIT_KEY) ?? 'kg'; }

// Converts a weight value between units, rounded to 1 decimal. Returns the value
// unchanged when fromUnit === toUnit or weight is null.
export function convertWeight(weight, fromUnit, toUnit) {
  if (weight == null || fromUnit === toUnit) return weight;
  const converted = fromUnit === 'lbs' ? weight / 2.2046 : weight * 2.2046;
  return Math.round(converted * 10) / 10;
}

export const WEIGHT_EPSILON_KG = 0.05; // ~100 g tolerance — avoids float noise in "matched" checks

export const SIGNAL_GAP_DAYS   = 3;    // gap threshold for "Back after a few days"

// Master exercise list. Each entry has a name and type:
//   'reps'  — logs weight + reps
//   'timed' — logs duration_mins + optional calories
// Cardio keywords — free-text names containing any of these (case-insensitive)
// are auto-detected as timed exercises in the "Other" flow.
export const CARDIO_KEYWORDS = ['treadmill', 'bike', 'rower', 'elliptical', 'stairmaster'];

// Custom exercise names (entered via "Other") are stored as-is.
// Type is either auto-detected via CARDIO_KEYWORDS or chosen via the Strength/Cardio prompt.
export const EXERCISES = [
  { name: 'Seated Shoulder Press',       type: 'reps'  },
  { name: 'Goblet Squats',               type: 'reps'  },
  { name: 'Rear Delt Fly',               type: 'reps'  },
  { name: 'Hamstring Curls',             type: 'reps'  },
  { name: 'Elliptical',                  type: 'timed' },
  { name: 'Stairmaster',                 type: 'timed' },
  { name: 'Assisted Dips',               type: 'reps'  },
  { name: 'Assisted Pull Ups',           type: 'reps'  },
  { name: 'Press Ups',                   type: 'reps'  },
  { name: 'Bent Over Rows',              type: 'reps'  },
  { name: 'Push Up to Downward Dog',     type: 'reps'  },
  { name: 'Staggered Kettlebell Halo',   type: 'reps'  },
  { name: "Farmer's Carries",            type: 'reps'  },
  { name: 'Seated Leg Press',            type: 'reps'  },
  { name: 'Chest Press',                 type: 'reps'  },
  { name: 'Deadlifts',                   type: 'reps'  },
  { name: 'Other',                       type: 'reps'  },
];

// Looks up an exercise type by name. Falls back to 'reps' for custom names
// entered via the "Other" flow that don't appear in the EXERCISES array.
export function getExerciseType(name) {
  return EXERCISES.find(e => e.name === name)?.type ?? 'reps';
}

// ── Session notes auto-save ───────────────────────────

// Single mutable state object. No framework reactivity — all DOM updates are
// explicit via render* functions called after state mutations.
export const state = {
  sessionId:    null,
  exercise:     EXERCISES[0].name,
  exerciseType: EXERCISES[0].type,
  setNumber:    1,
};

// ── Input helpers ─────────────────────────────────────
