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
import { initDB, dbCreatePlan, dbSavePlanExercises, dbGetAllPlans, dbGetPlanDays, dbUpdatePlanStatus } from '../js/db.js';
import { openNewPlan, addDayToPlan, addExerciseToPlan, savePlan } from '../js/plans.js';

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

// ── 5.10: the empty-day rule is stated, not applied silently ──────────────
//
// savePlan used to `.filter(d => d.exercises.length)` — a day the user added and
// left empty was dropped and the plan saved anyway, so the only feedback was the
// day being gone on the next visit. These tests pin the opposite: Save waits,
// and says which day.
//
// One branch isn't reachable from here: a day the user *named*. The name lives in
// _editingDays via an `input` listener, and the stub's addEventListener is a
// no-op, so tests can only produce the positional label — which is also the
// realistic case (you tap + Add Day and reach for Save before naming it). The
// named branch is one `||` shared with the label savePlan persists, and is
// covered by browser verification.
describe('empty-day guard (5.10)', () => {
  const err = () => $('plan-save-error');
  const errShown = () => !err().classList.contains('hidden');

  const oneFilledPlusEmpty = () => {
    openNewPlan();
    $('plan-name-input').value = 'Upper / Lower';
    addExerciseToPlan('Barbell Bench Press', 'reps', 0);
    addDayToPlan();
  };

  it('blocks Save and names the empty day', () => {
    oneFilledPlusEmpty();
    savePlan();

    expect(errShown()).toBe(true);
    expect(err().textContent).toBe('"Day 2" has no exercises. Add one, or remove the day.');
  });

  it('writes nothing at all when it blocks', () => {
    oneFilledPlusEmpty();
    savePlan();
    expect(dbGetAllPlans()).toHaveLength(0);
  });

  it('names every empty day, plural', () => {
    oneFilledPlusEmpty();
    addDayToPlan();
    savePlan();

    expect(err().textContent)
      .toBe('"Day 2" and "Day 3" have no exercises. Add one to each, or remove them.');
  });

  // The positive half, and the actual point of the item: once the day has an
  // exercise it survives the save instead of being quietly discarded.
  it('saves both days once the empty one is filled', () => {
    oneFilledPlusEmpty();
    addExerciseToPlan('Bent Over Rows', 'reps', 1);
    savePlan();

    const [plan] = dbGetAllPlans();
    expect(plan.name).toBe('Upper / Lower');
    expect(dbGetPlanDays(plan.plan_id).map(d => d.name)).toEqual(['Day 1', 'Day 2']);
    expect(errShown()).toBe(false);
  });

  // A first-time user hasn't added anything yet, so naming "Day 1" at them
  // describes the editor's internals rather than what they need to do.
  it('keeps the generic message for an untouched new plan', () => {
    openNewPlan();
    $('plan-name-input').value = 'Upper / Lower';
    savePlan();

    expect(err().textContent).toBe('Enter a plan name and at least one exercise.');
  });

  it('reports the missing name first, even with empty days present', () => {
    oneFilledPlusEmpty();
    $('plan-name-input').value = '   ';
    savePlan();

    expect(err().textContent).toBe('Enter a plan name and at least one exercise.');
  });

  // A per-day message names a day that the next draft may not have.
  it('resets the message when the editor reopens', () => {
    oneFilledPlusEmpty();
    savePlan();
    expect(err().textContent).toContain('Day 2');

    openNewPlan();
    expect(err().textContent).toBe('Enter a plan name and at least one exercise.');
    expect(errShown()).toBe(false);
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
