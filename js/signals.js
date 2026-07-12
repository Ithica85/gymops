// ═══════════════════════════════════════════════════════
// GymOps — Deterministic rule engines: progression signal (F-03) + session signal (F-06)
// ═══════════════════════════════════════════════════════

import {
  dbFinishSession,
  dbGetPreviousCompletedSession,
  dbGetRecentSessionsBestForExercise,
  dbGetSessionBestForExercise,
  dbGetSessionExerciseCount,
  dbGetSessionRepsExercises,
  dbGetSessionVolume,
} from './db.js';
import { SIGNAL_GAP_DAYS, WEIGHT_EPSILON_KG, getExerciseType, getWeightUnit } from './state.js';

// Deterministic rule engine — returns a signal string or null.
// Priority order: P1 (long-term) > P2 (session best) > P3 (last session) > P4 (negative).
// Same inputs always produce the same output (no randomness, no side effects).
export function computeProgressionSignal(exercise, sessionId) {
  if (getExerciseType(exercise) === 'timed') return null;

  const currentBestKg = dbGetSessionBestForExercise(sessionId, exercise);
  if (currentBestKg == null) return null;

  const history = dbGetRecentSessionsBestForExercise(exercise, 6); // newest first
  if (!history.length) return null; // first-ever session for this exercise

  const prevBestKg  = history[0].best_weight_kg;
  const currentUnit = getWeightUnit();

  // P1 — 3 sessions improving: previous 2 completed sessions + current all strictly up
  if (history.length >= 2) {
    const [h0, h1] = history;
    if (h1.best_weight_kg < h0.best_weight_kg - WEIGHT_EPSILON_KG &&
        currentBestKg    > h0.best_weight_kg + WEIGHT_EPSILON_KG) {
      return '3 sessions improving';
    }
  }

  // P1 — Best in 2 weeks: current beats every completed session in the last 14 days
  const twoWeeksAgo  = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const recentBests  = history.filter(h => h.start_time >= twoWeeksAgo);
  if (recentBests.length > 0) {
    const maxRecentKg = Math.max(...recentBests.map(h => h.best_weight_kg));
    if (currentBestKg > maxRecentKg + WEIGHT_EPSILON_KG) {
      return 'Best in 2 weeks';
    }
  }

  // P2 — New session high: current beats most recent completed session
  if (currentBestKg > prevBestKg + WEIGHT_EPSILON_KG) {
    const deltaKg    = currentBestKg - prevBestKg;
    const delta      = currentUnit === 'lbs'
      ? Math.round(deltaKg * 2.2046)
      : Math.round(deltaKg * 10) / 10;
    return `+${delta} ${currentUnit} — new session high`;
  }

  // P3 — Time gap: returning after 3+ days away
  const daysSince = (Date.now() - new Date(history[0].start_time).getTime()) / 86400000;
  if (daysSince >= SIGNAL_GAP_DAYS) return 'Back after a few days';

  // P3 — Back on track: most recent session was a dip, current session recovers
  if (history.length >= 2) {
    const prev2BestKg = history[1].best_weight_kg;
    if (prevBestKg  < prev2BestKg - WEIGHT_EPSILON_KG &&
        currentBestKg >= prevBestKg - WEIGHT_EPSILON_KG) {
      return 'Back on track';
    }
  }

  // P3 — Matched previous best
  if (Math.abs(currentBestKg - prevBestKg) <= WEIGHT_EPSILON_KG) {
    return 'Matched previous best';
  }

  // P4 — Negative (only fires when nothing positive applies)
  if (currentBestKg < prevBestKg - WEIGHT_EPSILON_KG) {
    return 'Slight drop from last session';
  }

  return null;
}

export function renderProgressionSignal(signal) {
  const el = document.getElementById('progression-signal');
  if (!signal) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.textContent = signal;
    el.classList.remove('hidden');
  }
}

// ── Session completion signal ──────────────────────────

// Deterministic interpretation line derived from session stats.
function _sessionInterpretation({ daysSincePrev, volumeDeltaRatio, improvementCount, bestDeltaKg }) {
  if (daysSincePrev === null) return 'Great start — baseline set';
  if (daysSincePrev >= SIGNAL_GAP_DAYS) return 'Good return after a few days off';
  if (bestDeltaKg > WEIGHT_EPSILON_KG) {
    if (improvementCount >= 2) return 'Building momentum';
    if (volumeDeltaRatio !== null && volumeDeltaRatio > 0.05) return 'Strong session';
    return 'Solid progression today';
  }
  if (volumeDeltaRatio !== null && volumeDeltaRatio > 0.05) return 'Consistent work this week';
  if (volumeDeltaRatio !== null && Math.abs(volumeDeltaRatio) <= 0.1) return 'Consistent with last session';
  return 'Keep building';
}

// Aggregates session stats and returns the 3–4 closure signal lines.
// Must be called after dbFinishSession() so the current session is 'completed'.
// Uses beforeSessionId to exclude the current session from historical queries.
export function computeSessionSignal(sessionId) {
  const currentExerciseCount = dbGetSessionExerciseCount(sessionId);
  const currentVolumeKg      = dbGetSessionVolume(sessionId);
  const prevSession          = dbGetPreviousCompletedSession(sessionId);

  if (!prevSession) {
    return {
      exerciseLine:    `${currentExerciseCount} exercise${currentExerciseCount !== 1 ? 's' : ''} logged`,
      volumeLine:      null,
      improvementLine: null,
      interpretation:  'Great start — baseline set',
    };
  }

  const prevExerciseCount = dbGetSessionExerciseCount(prevSession.session_id);
  const prevVolumeKg      = dbGetSessionVolume(prevSession.session_id);
  const daysSincePrev     = (Date.now() - new Date(prevSession.start_time).getTime()) / 86400000;

  // Exercise completion line
  let exerciseLine;
  if (currentExerciseCount >= prevExerciseCount) {
    exerciseLine = `${currentExerciseCount} exercise${currentExerciseCount !== 1 ? 's' : ''} logged`;
  } else {
    const skipped = prevExerciseCount - currentExerciseCount;
    exerciseLine = `${currentExerciseCount} of ${prevExerciseCount} exercises — ${skipped} skipped`;
  }

  // Volume delta line
  let volumeLine      = null;
  let volumeDeltaRatio = null;
  if (prevVolumeKg > 0 && currentVolumeKg > 0) {
    volumeDeltaRatio = (currentVolumeKg - prevVolumeKg) / prevVolumeKg;
    if (volumeDeltaRatio > 0.05)       volumeLine = 'Total volume up from last session';
    else if (volumeDeltaRatio < -0.05) volumeLine = 'Volume slightly down from last session';
    else                               volumeLine = 'Volume matched last session';
  }

  // Best improvement across all reps exercises (vs most recent session each was performed)
  const exercises      = dbGetSessionRepsExercises(sessionId);
  let bestDeltaKg      = 0;
  let bestExercise     = null;
  let improvementCount = 0;
  const currentUnit    = getWeightUnit();

  exercises.forEach(exercise => {
    const currentBestKg = dbGetSessionBestForExercise(sessionId, exercise);
    const history       = dbGetRecentSessionsBestForExercise(exercise, 1, sessionId);
    if (!history.length || currentBestKg == null) return;
    const delta = currentBestKg - history[0].best_weight_kg;
    if (delta > WEIGHT_EPSILON_KG) {
      improvementCount++;
      if (delta > bestDeltaKg) { bestDeltaKg = delta; bestExercise = exercise; }
    }
  });

  let improvementLine = null;
  if (bestExercise !== null) {
    const displayDelta = currentUnit === 'lbs'
      ? Math.round(bestDeltaKg * 2.2046)
      : Math.round(bestDeltaKg * 10) / 10;
    improvementLine = `Best set: ${bestExercise} +${displayDelta} ${currentUnit}`;
  }

  return {
    exerciseLine,
    volumeLine,
    improvementLine,
    interpretation: _sessionInterpretation({ daysSincePrev, volumeDeltaRatio, improvementCount, bestDeltaKg }),
  };
}

export function renderSessionSignal(signal) {
  document.getElementById('signal-exercises').textContent      = signal.exerciseLine;
  const volEl = document.getElementById('signal-volume');
  if (signal.volumeLine) {
    volEl.textContent = signal.volumeLine;
    volEl.classList.remove('hidden');
  } else {
    volEl.classList.add('hidden');
  }
  const impEl = document.getElementById('signal-improvement');
  if (signal.improvementLine) {
    impEl.textContent = signal.improvementLine;
    impEl.classList.remove('hidden');
  } else {
    impEl.classList.add('hidden');
  }
  document.getElementById('signal-interpretation').textContent = signal.interpretation;
}

export function dismissSessionSignal() {
  document.getElementById('session-signal').classList.add('hidden');
}
