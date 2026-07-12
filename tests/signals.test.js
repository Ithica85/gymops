// Unit tests for the deterministic signal/rule engines in js/app.js (Story 3.2).
// db.js is fully mocked — these test pure rule logic against constructed
// histories, especially WHICH tier wins when several conditions apply at once.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/db.js', async (importOriginal) => {
  const actual = await importOriginal();
  const mocked = {};
  for (const key of Object.keys(actual)) mocked[key] = vi.fn();
  return mocked;
});

import * as db from '../js/db.js';
import {
  computeProgressionSignal, computeSessionSignal, computePlanNudge,
  computePlanExpiryBanner, computePlanNudgeBanner,
} from '../js/app.js';

const daysAgoIso = d => new Date(Date.now() - d * 86400000).toISOString();
// history entries are newest-first, matching dbGetRecentSessionsBestForExercise
const hist = (...entries) => entries.map(([kg, daysAgo]) => ({
  best_weight_kg: kg, start_time: daysAgoIso(daysAgo),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear(); // unit defaults to kg; no dismissal cooldowns
});

describe('computeProgressionSignal tiers (P1 > P2 > P3 > P4)', () => {
  const run = (currentKg, history) => {
    db.dbGetSessionBestForExercise.mockReturnValue(currentKg);
    db.dbGetRecentSessionsBestForExercise.mockReturnValue(history);
    return computeProgressionSignal('Chest Press', 42);
  };

  it('P1 "3 sessions improving" outranks session-high and best-in-2-weeks', () => {
    // 95 → 100 → 105: also a new session high AND best in 2 weeks — P1 must win
    expect(run(105, hist([100, 1], [95, 3]))).toBe('3 sessions improving');
  });

  it('P1 "Best in 2 weeks" outranks P2 new-session-high', () => {
    // beats both recent sessions but they are not strictly improving (110 > 100)
    expect(run(115, hist([100, 1], [110, 12]))).toBe('Best in 2 weeks');
  });

  it('P2 new session high fires when P1 conditions fail', () => {
    // beats last session (100) but not the 110 from 12 days ago
    expect(run(105, hist([100, 1], [110, 12]))).toBe('+5 kg — new session high');
  });

  it('P3 gap-return outranks matched-previous-best', () => {
    // matched exactly, but last session was 5 days ago — gap message wins
    expect(run(100, hist([100, 5]))).toBe('Back after a few days');
  });

  it('P3 back-on-track outranks matched-previous-best', () => {
    // last session dipped (95 after 100); current recovers to the dip level
    expect(run(95, hist([95, 1], [100, 3]))).toBe('Back on track');
  });

  it('P3 matched previous best', () => {
    expect(run(100, hist([100, 1], [100, 3]))).toBe('Matched previous best');
  });

  it('P4 slight drop only when nothing positive applies', () => {
    expect(run(97, hist([100, 1], [95, 3]))).toBe('Slight drop from last session');
  });

  it('returns null for timed exercises', () => {
    db.dbGetSessionBestForExercise.mockReturnValue(20);
    db.dbGetRecentSessionsBestForExercise.mockReturnValue(hist([20, 1]));
    expect(computeProgressionSignal('Elliptical', 42)).toBeNull();
  });

  it('returns null on first-ever session for the exercise', () => {
    expect(run(100, [])).toBeNull();
  });

  it('returns null when no sets logged yet this session', () => {
    expect(run(null, hist([100, 1]))).toBeNull();
  });
});

describe('computeSessionSignal', () => {
  it('baseline: first-ever completed session', () => {
    db.dbGetSessionExerciseCount.mockReturnValue(3);
    db.dbGetSessionVolume.mockReturnValue(1000);
    db.dbGetPreviousCompletedSession.mockReturnValue(null);

    const s = computeSessionSignal(1);
    expect(s.exerciseLine).toBe('3 exercises logged');
    expect(s.volumeLine).toBeNull();
    expect(s.improvementLine).toBeNull();
    expect(s.interpretation).toBe('Great start — baseline set');
  });

  const setupComparative = ({ currentVol, prevVol, currentCount = 3, prevCount = 3, daysSince = 1, improvements = [] }) => {
    db.dbGetSessionExerciseCount.mockImplementation(id => (id === 1 ? currentCount : prevCount));
    db.dbGetSessionVolume.mockImplementation(id => (id === 1 ? currentVol : prevVol));
    db.dbGetPreviousCompletedSession.mockReturnValue({ session_id: 99, start_time: daysAgoIso(daysSince) });
    db.dbGetSessionRepsExercises.mockReturnValue(improvements.map(i => i.exercise));
    db.dbGetSessionBestForExercise.mockImplementation((id, ex) =>
      improvements.find(i => i.exercise === ex)?.currentKg ?? null);
    db.dbGetRecentSessionsBestForExercise.mockImplementation(ex =>
      hist([improvements.find(i => i.exercise === ex)?.prevKg ?? 0, 2]));
  };

  it('improving session: volume up + one PR → "Strong session"', () => {
    setupComparative({
      currentVol: 1100, prevVol: 1000,
      improvements: [{ exercise: 'Chest Press', currentKg: 65, prevKg: 60 }],
    });
    const s = computeSessionSignal(1);
    expect(s.volumeLine).toBe('Total volume up from last session');
    expect(s.improvementLine).toBe('Best set: Chest Press +5 kg');
    expect(s.interpretation).toBe('Strong session');
  });

  it('two improvements → "Building momentum" outranks volume-based lines', () => {
    setupComparative({
      currentVol: 1100, prevVol: 1000,
      improvements: [
        { exercise: 'Chest Press', currentKg: 65, prevKg: 60 },
        { exercise: 'Squat', currentKg: 90, prevKg: 85 },
      ],
    });
    expect(computeSessionSignal(1).interpretation).toBe('Building momentum');
  });

  it('declining session: volume well down, no PRs → "Keep building"', () => {
    setupComparative({ currentVol: 850, prevVol: 1000 });
    const s = computeSessionSignal(1);
    expect(s.volumeLine).toBe('Volume slightly down from last session');
    expect(s.interpretation).toBe('Keep building');
  });

  it('gap return outranks improvement-based interpretations', () => {
    setupComparative({
      currentVol: 1100, prevVol: 1000, daysSince: 5,
      improvements: [{ exercise: 'Chest Press', currentKg: 65, prevKg: 60 }],
    });
    expect(computeSessionSignal(1).interpretation).toBe('Good return after a few days off');
  });

  it('skipped exercises are counted in the exercise line', () => {
    setupComparative({ currentVol: 700, prevVol: 1000, currentCount: 2, prevCount: 4 });
    expect(computeSessionSignal(1).exerciseLine).toBe('2 of 4 exercises — 2 skipped');
  });
});

describe('computePlanNudge', () => {
  // Pin the clock: Friday 2026-07-10 10:00 local. daysLeft incl. today = 3.
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-07-10T10:00:00') });
  });
  afterEach(() => vi.useRealTimers());

  const activePlan = (over = {}) => ({
    plan_id: 1, name: 'Bulk', start_date: '2026-06-29', duration_weeks: 8,
    target_sessions_per_week: null, ...over,
  });

  it('week-pace rule fires when remaining sessions crowd the days left', () => {
    db.dbGetActivePlan.mockReturnValue(activePlan({ target_sessions_per_week: 3 }));
    db.dbHasSessionToday.mockReturnValue(false);
    db.dbGetCompletedSessionsSince.mockReturnValue([]); // 0 done, 3 needed, 3 days left
    expect(computePlanNudge()).toBe('0 of 3 sessions this week — 3 days left');
  });

  it('week-pace rule stays quiet when on pace', () => {
    db.dbGetActivePlan.mockReturnValue(activePlan({ target_sessions_per_week: 3 }));
    db.dbHasSessionToday.mockReturnValue(false);
    db.dbGetCompletedSessionsSince.mockReturnValue([{}, {}]); // 2 done, 1 needed, 3 days left
    db.dbGetLastCompletedSession.mockReturnValue({ start_time: daysAgoIso(1) });
    expect(computePlanNudge()).toBeNull();
  });

  it('gap rule fires after SIGNAL_GAP_DAYS without training', () => {
    db.dbGetActivePlan.mockReturnValue(activePlan());
    db.dbHasSessionToday.mockReturnValue(false);
    db.dbGetLastCompletedSession.mockReturnValue({ start_time: daysAgoIso(4) });
    expect(computePlanNudge()).toBe('No training in 4 days — Bulk is waiting');
  });

  it('never fires when a session was completed today', () => {
    db.dbGetActivePlan.mockReturnValue(activePlan({ target_sessions_per_week: 3 }));
    db.dbHasSessionToday.mockReturnValue(true);
    expect(computePlanNudge()).toBeNull();
  });

  it('never fires for an expired plan (the expiry banner owns that)', () => {
    db.dbGetActivePlan.mockReturnValue(activePlan({ start_date: '2026-01-01', duration_weeks: 4 }));
    db.dbHasSessionToday.mockReturnValue(false);
    db.dbGetLastCompletedSession.mockReturnValue({ start_time: daysAgoIso(10) });
    expect(computePlanNudge()).toBeNull();
  });

  it('returns null with no active plan', () => {
    db.dbGetActivePlan.mockReturnValue(null);
    expect(computePlanNudge()).toBeNull();
  });
});

describe('banner priority building blocks (expiry vs nudge)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-07-10T10:00:00') });
  });
  afterEach(() => vi.useRealTimers());

  it('expired plan: expiry banner computes, nudge computes null — order in IDLE_BANNERS does the rest', () => {
    const expired = { plan_id: 1, name: 'Bulk', start_date: '2026-01-01', duration_weeks: 4, target_sessions_per_week: 3 };
    db.dbGetActivePlan.mockReturnValue(expired);
    db.dbHasSessionToday.mockReturnValue(false);
    db.dbGetLastCompletedSession.mockReturnValue({ start_time: daysAgoIso(10) });

    expect(computePlanExpiryBanner()).toBeTypeOf('function'); // wants to render
    expect(computePlanNudgeBanner()).toBeNull();              // yields to expiry
  });

  it('active plan mid-flight: expiry null, nudge renders', () => {
    db.dbGetActivePlan.mockReturnValue({ plan_id: 1, name: 'Bulk', start_date: '2026-06-29', duration_weeks: 8 });
    db.dbHasSessionToday.mockReturnValue(false);
    db.dbGetLastCompletedSession.mockReturnValue({ start_time: daysAgoIso(4) });

    expect(computePlanExpiryBanner()).toBeNull();
    expect(computePlanNudgeBanner()).toBeTypeOf('function');
  });

  it('nudge respects the 24h dismissal cooldown', () => {
    db.dbGetActivePlan.mockReturnValue({ plan_id: 1, name: 'Bulk', start_date: '2026-06-29', duration_weeks: 8 });
    db.dbHasSessionToday.mockReturnValue(false);
    db.dbGetLastCompletedSession.mockReturnValue({ start_time: daysAgoIso(4) });

    localStorage.setItem('gymops_plan_nudge_dismissed_at', String(Date.now() - 60 * 60 * 1000)); // 1h ago
    expect(computePlanNudgeBanner()).toBeNull();

    localStorage.setItem('gymops_plan_nudge_dismissed_at', String(Date.now() - 25 * 60 * 60 * 1000)); // 25h ago
    expect(computePlanNudgeBanner()).toBeTypeOf('function');
  });
});
