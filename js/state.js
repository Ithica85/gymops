// ═══════════════════════════════════════════════════════
// GymOps — Shared app state, constants, and the exercise catalogue
// ═══════════════════════════════════════════════════════

export const APP_VERSION = 'v5.2';

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

// ── Rest timer duration preference ────────────────────
// Stored in localStorage as seconds. 90 s was the hardcoded value pre-4.9.
export const REST_SECS_KEY     = 'gymops_rest_secs';
export const REST_SECS_DEFAULT = 90;
export const REST_SECS_CHOICES = [60, 90, 120, 180];

export function getRestSecs() {
  const v = parseInt(localStorage.getItem(REST_SECS_KEY), 10);
  return REST_SECS_CHOICES.includes(v) ? v : REST_SECS_DEFAULT;
}

// YYYY-MM-DD in LOCAL time. Filenames and plan dates must reflect the user's
// calendar day — new Date().toISOString() is UTC, which names an evening
// export with tomorrow's date east of Greenwich.
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Master exercise list. Each entry has a name and type:
//   'reps'  — logs weight + reps
//   'timed' — logs duration_mins + optional calories
// Cardio keywords — free-text names containing any of these (case-insensitive)
// are auto-detected as timed exercises in the "Other" flow.
export const CARDIO_KEYWORDS = ['treadmill', 'bike', 'rower', 'elliptical', 'stairmaster'];

// Display/order of muscle-group sections in the picker and future coverage views.
export const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core', 'Cardio'];

// Master exercise catalogue (v3.6: expanded from 16 to ~115, tagged by muscle group).
// RULES:
// - Names of pre-v3.6 entries must NEVER change — logged sets reference exercises
//   by name, so a rename orphans history. (Pre-v3.6 entries are marked ◂.)
// - EXERCISES[0] must stay 'Seated Shoulder Press' — it is the default starting
//   exercise for plan-less sessions. Array order is NOT display order; the picker
//   renders sections in MUSCLE_GROUPS order.
// - 'Other' stays last and untagged (muscleGroup: null) — custom exercises are
//   deliberately not forced into a group.
export const EXERCISES = [
  // Shoulders
  { name: 'Seated Shoulder Press',      type: 'reps',  muscleGroup: 'Shoulders' }, // ◂
  { name: 'Rear Delt Fly',              type: 'reps',  muscleGroup: 'Shoulders' }, // ◂
  { name: 'Staggered Kettlebell Halo',  type: 'reps',  muscleGroup: 'Shoulders' }, // ◂
  { name: 'Overhead Press',             type: 'reps',  muscleGroup: 'Shoulders' },
  { name: 'Dumbbell Shoulder Press',    type: 'reps',  muscleGroup: 'Shoulders' },
  { name: 'Arnold Press',               type: 'reps',  muscleGroup: 'Shoulders' },
  { name: 'Machine Shoulder Press',     type: 'reps',  muscleGroup: 'Shoulders' },
  { name: 'Lateral Raises',             type: 'reps',  muscleGroup: 'Shoulders' },
  { name: 'Cable Lateral Raise',        type: 'reps',  muscleGroup: 'Shoulders' },
  { name: 'Front Raises',               type: 'reps',  muscleGroup: 'Shoulders' },
  { name: 'Face Pulls',                 type: 'reps',  muscleGroup: 'Shoulders' },
  { name: 'Upright Rows',               type: 'reps',  muscleGroup: 'Shoulders' },
  { name: 'Reverse Pec Deck',           type: 'reps',  muscleGroup: 'Shoulders' },
  { name: 'Landmine Press',             type: 'reps',  muscleGroup: 'Shoulders' },

  // Chest
  { name: 'Chest Press',                type: 'reps',  muscleGroup: 'Chest' }, // ◂
  { name: 'Press Ups',                  type: 'reps',  muscleGroup: 'Chest' }, // ◂
  { name: 'Assisted Dips',              type: 'reps',  muscleGroup: 'Chest' }, // ◂
  { name: 'Barbell Bench Press',        type: 'reps',  muscleGroup: 'Chest' },
  { name: 'Incline Barbell Bench Press',type: 'reps',  muscleGroup: 'Chest' },
  { name: 'Decline Barbell Bench Press',type: 'reps',  muscleGroup: 'Chest' },
  { name: 'Dumbbell Bench Press',       type: 'reps',  muscleGroup: 'Chest' },
  { name: 'Incline Dumbbell Press',     type: 'reps',  muscleGroup: 'Chest' },
  { name: 'Dumbbell Fly',               type: 'reps',  muscleGroup: 'Chest' },
  { name: 'Incline Dumbbell Fly',       type: 'reps',  muscleGroup: 'Chest' },
  { name: 'Cable Crossover',            type: 'reps',  muscleGroup: 'Chest' },
  { name: 'Cable Chest Fly',            type: 'reps',  muscleGroup: 'Chest' },
  { name: 'Pec Deck',                   type: 'reps',  muscleGroup: 'Chest' },
  { name: 'Incline Machine Press',      type: 'reps',  muscleGroup: 'Chest' },
  { name: 'Smith Machine Bench Press',  type: 'reps',  muscleGroup: 'Chest' },
  { name: 'Dips',                       type: 'reps',  muscleGroup: 'Chest' },

  // Back
  { name: 'Bent Over Rows',             type: 'reps',  muscleGroup: 'Back' }, // ◂
  { name: 'Assisted Pull Ups',          type: 'reps',  muscleGroup: 'Back' }, // ◂
  { name: 'Deadlifts',                  type: 'reps',  muscleGroup: 'Back' }, // ◂
  { name: 'Lat Pulldown',               type: 'reps',  muscleGroup: 'Back' },
  { name: 'Close-Grip Lat Pulldown',    type: 'reps',  muscleGroup: 'Back' },
  { name: 'Pull Ups',                   type: 'reps',  muscleGroup: 'Back' },
  { name: 'Chin Ups',                   type: 'reps',  muscleGroup: 'Back' },
  { name: 'Seated Cable Row',           type: 'reps',  muscleGroup: 'Back' },
  { name: 'Single-Arm Dumbbell Row',    type: 'reps',  muscleGroup: 'Back' },
  { name: 'Chest-Supported Row',        type: 'reps',  muscleGroup: 'Back' },
  { name: 'T-Bar Row',                  type: 'reps',  muscleGroup: 'Back' },
  { name: 'Machine Row',                type: 'reps',  muscleGroup: 'Back' },
  { name: 'Straight-Arm Pulldown',      type: 'reps',  muscleGroup: 'Back' },
  { name: 'Back Extension',             type: 'reps',  muscleGroup: 'Back' },
  { name: 'Rack Pulls',                 type: 'reps',  muscleGroup: 'Back' },
  { name: 'Barbell Shrugs',             type: 'reps',  muscleGroup: 'Back' },
  { name: 'Dumbbell Shrugs',            type: 'reps',  muscleGroup: 'Back' },
  { name: 'Good Mornings',              type: 'reps',  muscleGroup: 'Back' },

  // Arms
  { name: 'Barbell Curl',               type: 'reps',  muscleGroup: 'Arms' },
  { name: 'EZ Bar Curl',                type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Dumbbell Curl',              type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Hammer Curl',                type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Incline Dumbbell Curl',      type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Preacher Curl',              type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Concentration Curl',         type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Cable Curl',                 type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Tricep Pushdown',            type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Rope Pushdown',              type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Overhead Tricep Extension',  type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Skull Crushers',             type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Close-Grip Bench Press',     type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Tricep Kickbacks',           type: 'reps',  muscleGroup: 'Arms' },
  { name: 'Wrist Curls',                type: 'reps',  muscleGroup: 'Arms' },

  // Legs
  { name: 'Goblet Squats',              type: 'reps',  muscleGroup: 'Legs' }, // ◂
  { name: 'Hamstring Curls',            type: 'reps',  muscleGroup: 'Legs' }, // ◂
  { name: 'Seated Leg Press',           type: 'reps',  muscleGroup: 'Legs' }, // ◂
  { name: 'Barbell Back Squat',         type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Front Squat',                type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Smith Machine Squat',        type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Hack Squat',                 type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Bulgarian Split Squat',      type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Walking Lunges',             type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Reverse Lunges',             type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Step Ups',                   type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Leg Extension',              type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Romanian Deadlift',          type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Sumo Deadlift',              type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Hip Thrust',                 type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Glute Bridge',               type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Standing Calf Raise',        type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Seated Calf Raise',          type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Hip Adductor Machine',       type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Hip Abductor Machine',       type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Box Jumps',                  type: 'reps',  muscleGroup: 'Legs' },
  { name: 'Kettlebell Swings',          type: 'reps',  muscleGroup: 'Legs' },

  // Core
  { name: 'Push Up to Downward Dog',    type: 'reps',  muscleGroup: 'Core' }, // ◂
  { name: "Farmer's Carries",           type: 'reps',  muscleGroup: 'Core' }, // ◂
  { name: 'Plank',                      type: 'timed', muscleGroup: 'Core' },
  { name: 'Side Plank',                 type: 'timed', muscleGroup: 'Core' },
  { name: 'Hanging Leg Raises',         type: 'reps',  muscleGroup: 'Core' },
  { name: 'Hanging Knee Raises',        type: 'reps',  muscleGroup: 'Core' },
  { name: 'Cable Crunch',               type: 'reps',  muscleGroup: 'Core' },
  { name: 'Ab Wheel Rollout',           type: 'reps',  muscleGroup: 'Core' },
  { name: 'Russian Twists',             type: 'reps',  muscleGroup: 'Core' },
  { name: 'Sit Ups',                    type: 'reps',  muscleGroup: 'Core' },
  { name: 'Crunches',                   type: 'reps',  muscleGroup: 'Core' },
  { name: 'Lying Leg Raises',           type: 'reps',  muscleGroup: 'Core' },
  { name: 'Dead Bug',                   type: 'reps',  muscleGroup: 'Core' },
  { name: 'Mountain Climbers',          type: 'reps',  muscleGroup: 'Core' },
  { name: 'Pallof Press',               type: 'reps',  muscleGroup: 'Core' },
  { name: 'Cable Woodchopper',          type: 'reps',  muscleGroup: 'Core' },

  // Cardio (all timed: duration + optional calories)
  { name: 'Elliptical',                 type: 'timed', muscleGroup: 'Cardio' }, // ◂
  { name: 'Stairmaster',                type: 'timed', muscleGroup: 'Cardio' }, // ◂
  { name: 'Treadmill Run',              type: 'timed', muscleGroup: 'Cardio' },
  { name: 'Treadmill Incline Walk',     type: 'timed', muscleGroup: 'Cardio' },
  { name: 'Stationary Bike',            type: 'timed', muscleGroup: 'Cardio' },
  { name: 'Spin Bike',                  type: 'timed', muscleGroup: 'Cardio' },
  { name: 'Rowing Machine',             type: 'timed', muscleGroup: 'Cardio' },
  { name: 'Ski Erg',                    type: 'timed', muscleGroup: 'Cardio' },
  { name: 'Assault Bike',               type: 'timed', muscleGroup: 'Cardio' },
  { name: 'Jump Rope',                  type: 'timed', muscleGroup: 'Cardio' },
  { name: 'Battle Ropes',               type: 'timed', muscleGroup: 'Cardio' },
  { name: 'Swimming',                   type: 'timed', muscleGroup: 'Cardio' },
  { name: 'Sled Push',                  type: 'timed', muscleGroup: 'Cardio' },

  // Always last, never grouped — opens the custom-exercise flow.
  { name: 'Other',                      type: 'reps',  muscleGroup: null },
];

// Looks up an exercise type by name. Falls back to 'reps' for custom names
// entered via the "Other" flow that don't appear in the EXERCISES array.
export function getExerciseType(name) {
  return EXERCISES.find(e => e.name === name)?.type ?? 'reps';
}

// Looks up an exercise's muscle group by name. Returns null for custom
// "Other" exercises and unknown names — they belong to no group.
export function getExerciseGroup(name) {
  return EXERCISES.find(e => e.name === name)?.muscleGroup ?? null;
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
