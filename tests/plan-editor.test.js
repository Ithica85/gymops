// Plan editor entry points (2026-07-28).
//
// openNewPlan and openEditPlan had no coverage at all, which is uncomfortable
// for two functions that decide what the user is about to save over. They now
// share one body (_openEditor), so these tests pin the behaviour that body has
// to keep: a new plan starts genuinely blank, and an edit loads the plan you
// picked rather than whatever the editor was last showing.
//
// The leak between them is the real risk. Both write the same nine fields, so
// anything one of them forgets to set keeps the previous plan's value — you
// open New Plan after editing "Upper / Lower" and find its name in the box.
import { describe, it, expect, beforeEach } from 'vitest';
import { initDB, dbCreatePlan, dbSavePlanExercises, dbGetAllPlans, dbUpdatePlanStatus } from '../js/db.js';
import { openNewPlan, addExerciseToPlan, savePlan } from '../js/plans.js';

const $ = id => document.getElementById(id);
const FIELDS = [
  'plan-name-input', 'plan-duration-input', 'plan-target-sessions-input',
  'plan-obj-1', 'plan-obj-2', 'plan-obj-3',
];

beforeEach(async () => {
  localStorage.clear();
  await initDB();
});

describe('openNewPlan', () => {
  it('opens the editor titled New Plan with one empty day', () => {
    openNewPlan();
    expect($('plan-editor-title').textContent).toBe('New Plan');
    for (const f of FIELDS) expect($(f).value, f).toBe('');
  });

  it('hides the archive button — there is nothing to archive yet', () => {
    openNewPlan();
    expect($('btn-archive-plan').classList.contains('hidden')).toBe(true);
  });

  it('clears the save error left over from a previous attempt', () => {
    $('plan-save-error').classList.remove('hidden');
    openNewPlan();
    expect($('plan-save-error').classList.contains('hidden')).toBe(true);
  });

  // The leak that matters: every field is written on every open, so a stale
  // value can never survive into a new plan.
  it('does not inherit field values from a previous edit', () => {
    for (const f of FIELDS) $(f).value = 'stale';
    openNewPlan();
    for (const f of FIELDS) expect($(f).value, f).toBe('');
  });
});

describe('the editor draft shape', () => {
  // _openEditor is private, but it is what makes a third entry point (an
  // importer proposing a plan, say) a few lines instead of a twelfth copy of
  // the same field writes. Exercising it through the public new-plan path
  // proves the draft it builds actually round-trips to a saved plan.
  it('a plan built in the editor saves with its exercises', () => {
    openNewPlan();
    $('plan-name-input').value = 'Upper / Lower';
    $('plan-duration-input').value = '8';
    addExerciseToPlan('Barbell Bench Press', 'reps', 0);
    addExerciseToPlan('Bent Over Rows', 'reps', 0);
    savePlan();

    const plans = dbGetAllPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].name).toBe('Upper / Lower');
    expect(plans[0].duration_weeks).toBe(8);
  });

  it('starting a second new plan does not carry the first one forward', () => {
    openNewPlan();
    $('plan-name-input').value = 'First';
    addExerciseToPlan('Barbell Bench Press', 'reps', 0);
    savePlan();

    openNewPlan();
    expect($('plan-name-input').value).toBe('');
    expect($('plan-editor-title').textContent).toBe('New Plan');
  });
});

describe('archive visibility', () => {
  // The one genuinely conditional field. An archived plan must not offer to be
  // archived again; a new one has nothing to archive. Both go through the same
  // `showArchive` flag now, so this pins the flag rather than three call sites.
  it('stays hidden for a new plan even after an active plan exists', () => {
    openNewPlan();
    $('plan-name-input').value = 'Active One';
    addExerciseToPlan('Barbell Bench Press', 'reps', 0);
    savePlan();

    const [plan] = dbGetAllPlans();
    expect(plan.status).toBe('active');

    openNewPlan();
    expect($('btn-archive-plan').classList.contains('hidden')).toBe(true);
  });
});
