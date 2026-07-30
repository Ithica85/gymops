// ═══════════════════════════════════════════════════════
// GymOps — Agent 0: policy budgets
// ═══════════════════════════════════════════════════════
// The §6 "numbers, not adjectives" table from docs/AGENTIC_VISION.md, in one
// place, because a principle that demands numbers while quoting none is the
// failure it exists to prevent. Every agent or model surface reads its ceilings
// from here rather than inlining a magic number at the call site.
//
// These are ENTRY-GATE values, deliberately stingy and marked provisional in the
// vision. A generous allowance that later has to be clawed back is worse than a
// small one that grows.
//
// Import-free on purpose (same rule as state.js): this is the bottom of the
// dependency graph so anything may read a budget without risking a cycle.

// Wall-clock ceiling for any outbound model call. Matches the 6.6 Drive token
// timeout — the lesson there was that a request with no timeout stalls a shared
// chain and strands the UI, which is exactly Agent 0's exit bar 5.
export const MODEL_TIMEOUT_MS = 15000;

// Server-enforced allowance once a shared key exists. NOT yet enforced anywhere:
// the proxy is still BYOK-only and `ANTHROPIC_API_KEY` stays unset until auth
// and budgets are green (§4.1 order). Declared here so the number is written
// down before the code that spends against it exists.
export const FREE_CALLS_PER_INSTALL_PER_MONTH = 5;

// Hard global ceiling with a kill switch above it. The per-install limit is soft
// by construction — a reinstall mints a fresh bucket, accepted in writing — so
// this is the figure that actually bounds the bill.
export const GLOBAL_SPEND_CAP_USD_PER_MONTH = 25;

// Context ceiling per call: one session plus six prior bests. Keeps a single
// request from growing with a user's whole training history.
export const CONTEXT_MAX_SESSIONS = 1;
export const CONTEXT_MAX_PRIOR_BESTS = 6;

// Wraps a fetch with the model timeout and a real abort, returning the same
// shape fetch does. Callers get a rejection on timeout rather than a promise
// that never settles — the only way exit bar 5 ("a hung call cannot leave UI in
// a loading state") can be satisfied at every call site rather than one.
//
// AbortSignal.timeout() would be shorter but gives no way to distinguish a
// timeout from a user cancel, and Agent 1's surfaces need to cancel.
export function fetchWithTimeout(url, options = {}, timeoutMs = MODEL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  // An external signal (a user cancel) still aborts this request.
  options.signal?.addEventListener?.('abort', () => controller.abort(options.signal.reason));
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// True when a rejection came from us giving up rather than the network failing,
// so a caller can say "took too long" instead of "check your connection".
export function isTimeout(err) {
  return err?.name === 'AbortError' || err?.name === 'TimeoutError';
}
