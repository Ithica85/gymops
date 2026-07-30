// ═══════════════════════════════════════════════════════
// GymOps — Agent 0: tool allowlist & write policy
// ═══════════════════════════════════════════════════════
// The fence, built before there is anything to fence in. docs/AGENTIC_VISION.md
// §5 Agent 0: "make what the agent is allowed to do explicit before any model UX
// ships." No agent calls this yet, and that is the point — when Agent 1 arrives
// the constraint already exists and CI already enforces it, rather than being
// argued about while a feature is half-built.
//
// This is NOT wired into the app and is deliberately absent from sw.js ASSETS:
// with no caller it would be dead bytes on every user's device. It is a
// build-time policy artifact with teeth (tests/agent-policy.test.js) until a
// rung above it imports it.
//
// ── The two rules ─────────────────────────────────────
//
// 1. A WRITE tool must name a user-visible confirm surface. Registering one
//    without `confirmSurface` is a registry error, not a code review note —
//    `validateRegistry()` throws and CI fails.
//
// 2. `logSet` / `quickLogSet` are NEVER agent-callable, at ANY rung. Not behind
//    a confirm, not with a flag. Logging a set is the one path the whole product
//    is built to keep fast and truthful (§7 logger + trust tests); an agent that
//    can write sets can invent training history. The agent may type INTO the
//    input elements and let the human tap Log Set — that is a prefill, and the
//    human still commits it.
//
// Reads are thin wrappers over functions that already exist and already have
// callers. Nothing here adds capability; it declares what is permitted.

import {
  dbGetActivePlan,
  dbGetAllExercises,
  dbGetExercise,
  dbGetExerciseSessionHistory,
  dbGetExercisesWithHistory,
  dbGetLastCompletedSession,
  dbGetPlanDays,
  dbGetPlanExercises,
} from '../db.js';

// Names that may never appear in the registry, whatever kind they claim to be.
// Checked by identity of the NAME, because the danger is the capability, not any
// particular import of it.
export const NEVER_AGENT_CALLABLE = Object.freeze(['logSet', 'quickLogSet']);

// kind: 'read'  — no confirm needed, cannot mutate anything.
//       'write' — MUST declare confirmSurface: the id/description of the sheet
//                 or editor where the user sees and accepts the change.
//
// There are deliberately ZERO write tools today. Agent 1 is keyless and
// read-only; the first legitimate write is Agent 2's plan draft, which already
// has its confirm surface (the plan editor, reached via _openEditor).
const REGISTRY = [
  {
    name: 'getTrainingHistory',
    kind: 'read',
    summary: 'Exercises the user has logged, most recently used first.',
    run: () => dbGetExercisesWithHistory(),
  },
  {
    name: 'getExerciseHistory',
    kind: 'read',
    summary: 'Per-session bests for one exercise, oldest first.',
    run: ({ exercise }) => dbGetExerciseSessionHistory(exercise),
  },
  {
    name: 'getLastSession',
    kind: 'read',
    summary: 'The most recently completed session.',
    run: () => dbGetLastCompletedSession(),
  },
  {
    name: 'getActivePlan',
    kind: 'read',
    summary: 'The active plan with its days and target exercises, or null.',
    run: () => {
      const plan = dbGetActivePlan();
      if (!plan) return null;
      return {
        ...plan,
        days: dbGetPlanDays(plan.plan_id),
        exercises: dbGetPlanExercises(plan.plan_id),
      };
    },
  },
  {
    name: 'getExerciseIdentity',
    kind: 'read',
    summary: 'Stable exercise identity by name, or the whole catalogue.',
    run: ({ exercise } = {}) => (exercise ? dbGetExercise(exercise) : dbGetAllExercises()),
  },
];

// Throws on any policy violation. Called at import time below so a bad registry
// cannot be shipped, and exported so a test can assert the rules directly rather
// than only observing that the current registry happens to pass.
export function validateRegistry(registry = REGISTRY) {
  const seen = new Set();
  for (const tool of registry) {
    if (!tool.name) throw new Error('Agent tool registered without a name');
    if (seen.has(tool.name)) throw new Error(`Agent tool "${tool.name}" registered twice`);
    seen.add(tool.name);

    if (NEVER_AGENT_CALLABLE.includes(tool.name)) {
      throw new Error(
        `Agent tool "${tool.name}" is never agent-callable — the agent may prefill inputs, not log sets`
      );
    }
    if (tool.kind !== 'read' && tool.kind !== 'write') {
      throw new Error(`Agent tool "${tool.name}" must declare kind 'read' or 'write'`);
    }
    // Rule 1. The whole point of the fence.
    if (tool.kind === 'write' && !tool.confirmSurface) {
      throw new Error(
        `Agent tool "${tool.name}" is a write tool and must declare a confirmSurface — ` +
        'every agent write is accepted by a human on a visible surface'
      );
    }
    if (typeof tool.run !== 'function') {
      throw new Error(`Agent tool "${tool.name}" has no run()`);
    }
  }
  return true;
}

validateRegistry();

export const listTools = () =>
  REGISTRY.map(({ name, kind, summary, confirmSurface }) => ({ name, kind, summary, confirmSurface }));

export const getTool = name => REGISTRY.find(t => t.name === name) ?? null;

export const writeTools = () => REGISTRY.filter(t => t.kind === 'write');
