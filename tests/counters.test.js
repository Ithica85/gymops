// Phase 6.9 — local usage counters.
//
// Two things are being protected here, and only one of them is arithmetic.
// The other is that counting must never be able to cost the user an action:
// a counter is a side channel, so a full disk or a hostile private mode takes
// the number, never the set.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  COUNTERS, COUNTER_LABELS,
  bumpCounter, getCounters, getCounterSummary, getCountersSince,
} from '../js/counters.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

beforeEach(() => {
  localStorage.clear();
});

describe('counting', () => {
  it('starts empty and accumulates', () => {
    expect(getCounters()).toEqual({});
    bumpCounter(COUNTERS.SETS_MANUAL);
    bumpCounter(COUNTERS.SETS_MANUAL);
    bumpCounter(COUNTERS.SETS_QUICK, 3);
    const c = getCounters();
    expect(c[COUNTERS.SETS_MANUAL]).toBe(2);
    expect(c[COUNTERS.SETS_QUICK]).toBe(3);
  });

  it('stamps the start date once and never moves it', () => {
    expect(getCountersSince()).toBeNull();
    bumpCounter(COUNTERS.APP_OPENS);
    const first = getCountersSince();
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    bumpCounter(COUNTERS.APP_OPENS);
    expect(getCountersSince()).toBe(first);
  });

  it('survives a corrupted store instead of poisoning every later read', () => {
    localStorage.setItem('gymops_counters', '{not json');
    expect(getCounters()).toEqual({});
    bumpCounter(COUNTERS.PRS);
    expect(getCounters()[COUNTERS.PRS]).toBe(1);
  });

  it('ignores a non-object value left in the key', () => {
    localStorage.setItem('gymops_counters', '[1,2,3]');
    expect(getCounters()).toEqual({});
  });
});

describe('never costs the user the action', () => {
  it('swallows a storage failure rather than throwing into the caller', () => {
    const setItem = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    try {
      expect(() => bumpCounter(COUNTERS.SETS_MANUAL)).not.toThrow();
    } finally {
      localStorage.setItem = setItem;
    }
  });

  it('reads safely when storage throws on get', () => {
    const getItem = localStorage.getItem;
    localStorage.getItem = () => { throw new Error('SecurityError'); };
    try {
      expect(getCounters()).toEqual({});
      expect(getCountersSince()).toBeNull();
    } finally {
      localStorage.getItem = getItem;
    }
  });
});

describe('summary', () => {
  it('reports rates as null before there is anything to divide', () => {
    const s = getCounterSummary();
    expect(s.completionRate).toBeNull();
    expect(s.quickLogShare).toBeNull();
    expect(s.totalSets).toBe(0);
  });

  // "No data yet" and "0%" are different claims; rendering the second for the
  // first is how a readout starts lying.
  it('distinguishes no data from a genuine zero', () => {
    bumpCounter(COUNTERS.SESSIONS_STARTED, 4);
    expect(getCounterSummary().completionRate).toBe(0);
  });

  it('computes the funnel', () => {
    bumpCounter(COUNTERS.SESSIONS_STARTED, 10);
    bumpCounter(COUNTERS.SESSIONS_COMPLETED, 8);
    bumpCounter(COUNTERS.SETS_MANUAL, 30);
    bumpCounter(COUNTERS.SETS_QUICK, 70);
    const s = getCounterSummary();
    expect(s.completionRate).toBe(80);
    expect(s.quickLogShare).toBe(70);
    expect(s.totalSets).toBe(100);
  });

  // A session started before counting began can still be finished after it,
  // and a rate over 100% reads as a bug rather than as an artefact.
  it('caps completion at 100%', () => {
    bumpCounter(COUNTERS.SESSIONS_STARTED, 1);
    bumpCounter(COUNTERS.SESSIONS_COMPLETED, 3);
    expect(getCounterSummary().completionRate).toBe(100);
  });
});

describe('names and labels stay in step', () => {
  // An unlabelled counter is invisible in Settings; a label with no counter
  // renders a permanent zero. Both are silent.
  it('every counter has a label and every label a counter', () => {
    const labelled = COUNTER_LABELS.map(([k]) => k);
    const declared = Object.values(COUNTERS);
    expect([...labelled].sort()).toEqual([...declared].sort());
  });

  it('labels are unique and non-empty', () => {
    const words = COUNTER_LABELS.map(([, l]) => l);
    expect(new Set(words).size).toBe(words.length);
    for (const w of words) expect(w.length).toBeGreaterThan(2);
  });
});

describe('wiring', () => {
  const src = f => readFileSync(join(ROOT, f), 'utf8');

  // Bumps go through the constants, so a typo is a load-time reference error
  // instead of a counter incrementing into a key nothing ever displays.
  it('no call site passes a bare string', () => {
    for (const f of ['js/workout.js', 'js/app.js', 'js/plans.js', 'js/import-ui.js']) {
      const calls = [...src(f).matchAll(/bumpCounter\(([^)]*)\)/g)].map(m => m[1]);
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c, `${f}: bumpCounter(${c})`).toMatch(/COUNTERS\./);
    }
  });

  it('the module is precached, or offline use goes uncounted', () => {
    expect(src('sw.js')).toContain("'/js/counters.js'");
  });

  // The registry held ONE hook per screen until 6.9, so Settings' second
  // registration silently unregistered the Drive card — invisible everywhere
  // except a stale line on screen.
  it('screen-show hooks accumulate rather than replace', () => {
    expect(src('js/ui.js')).toMatch(/_screenShowHooks\[name\] \?\?= \[\]/);
    expect(src('js/ui.js')).toMatch(/_screenShowHooks\[name\]\?\.forEach/);
  });
});
