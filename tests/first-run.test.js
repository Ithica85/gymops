// Phase 6.1 — first-run orientation + install prompt.
//
// Both are IDLE_BANNERS entries, so the rules that matter are eligibility
// rules: who sees which card, when, and never both at once. The install ask in
// particular is withheld until the app has proved something — these tests pin
// that, because it is a product decision that reads like a bug ("why doesn't
// the install prompt show?") to anyone who didn't make it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDB, dbCreateSession, dbInsertSet, dbFinishSession } from '../js/db.js';
import {
  IDLE_BANNERS,
  computeFirstRunCard,
  computeInstallCard,
  dismissFirstRunCard,
  dismissInstallCard,
} from '../js/idle.js';
import { EXERCISES } from '../js/state.js';

const EX = EXERCISES[0].name;

function completeASession() {
  const sid = dbCreateSession('kg');
  dbInsertSet(sid, EX, 1, 60, 8, null, null, 'kg');
  dbFinishSession(sid);
  return sid;
}

// The install card reads navigator/window feature flags. Node's own navigator
// exposes userAgent as a getter-only property, so platform emulation goes
// through defineProperty rather than assignment.
function _setNav(prop, value) {
  Object.defineProperty(navigator, prop, { value, configurable: true, writable: true });
}
function asIOS()       { _setNav('userAgent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'); }
function asInstalled() { _setNav('standalone', true); }

beforeEach(async () => {
  localStorage.clear();
  await initDB();
});

afterEach(() => {
  // Node's default userAgent mentions no platform, which is the neutral
  // "browser we can't guide" baseline every test starts from.
  _setNav('userAgent', '');
  _setNav('standalone', undefined);
});

describe('first-run orientation card', () => {
  it('shows on a fresh install', () => {
    expect(computeFirstRunCard()).toBeTypeOf('function');
  });

  it('disappears once the user has completed a session', () => {
    completeASession();
    expect(computeFirstRunCard()).toBeNull();
  });

  it('stays dismissed across reloads', () => {
    dismissFirstRunCard();
    expect(localStorage.getItem('gymops_first_run_dismissed')).toBeTruthy();
    expect(computeFirstRunCard()).toBeNull();
  });

  it('outranks every other banner so orientation is never buried', () => {
    expect(IDLE_BANNERS[0].id).toBe('first-run-card');
  });
});

describe('install card', () => {
  it('is withheld before the first completed session, even on iOS', () => {
    asIOS();
    expect(computeInstallCard()).toBeNull();
  });

  it('appears on iOS after a completed session', () => {
    asIOS();
    completeASession();
    expect(computeInstallCard()).toBeTypeOf('function');
  });

  it('never appears once the app is already installed', () => {
    asIOS();
    asInstalled();
    completeASession();
    expect(computeInstallCard()).toBeNull();
  });

  it('stays silent on a browser we cannot guide (no prompt event, not iOS)', () => {
    completeASession();
    expect(computeInstallCard()).toBeNull();
  });

  it('stays dismissed across reloads', () => {
    asIOS();
    completeASession();
    dismissInstallCard();
    expect(localStorage.getItem('gymops_install_dismissed')).toBeTruthy();
    expect(computeInstallCard()).toBeNull();
  });

  it('sits last so a time-sensitive banner always wins the slot', () => {
    expect(IDLE_BANNERS[IDLE_BANNERS.length - 1].id).toBe('install-card');
  });
});

describe('the two cards are mutually exclusive by construction', () => {
  it('zero sessions → orientation only', () => {
    asIOS();
    expect(computeFirstRunCard()).toBeTypeOf('function');
    expect(computeInstallCard()).toBeNull();
  });

  it('one session → install only', () => {
    asIOS();
    completeASession();
    expect(computeFirstRunCard()).toBeNull();
    expect(computeInstallCard()).toBeTypeOf('function');
  });
});
