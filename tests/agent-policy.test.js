// Agent 0 — foundation, policy & proxy hardening (docs/AGENTIC_VISION.md §5).
//
// The exit bar for Agent 0 was deliberately made BINARY after review, replacing
// a first draft that said "test-guarded enough" — unfalsifiable. These tests are
// three of those five bars. They guard a fence around capability that does not
// exist yet, which is the only time a fence is cheap to build.
//
// The failure they prevent is not a crash. It is someone adding a write tool in
// six months, wiring it to an agent, and nobody noticing that no human ever
// confirms it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initDB } from '../js/db.js';
import { listTools, getTool, writeTools, validateRegistry, NEVER_AGENT_CALLABLE } from '../js/agent/tools.js';
import { MODEL_TIMEOUT_MS, fetchWithTimeout, isTimeout } from '../js/agent/policy.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Exit bar 1: zero write-capable tools, and adding one fails ──────────
describe('write policy (Agent 0 exit 1)', () => {
  it('exposes zero write-capable tools today', () => {
    expect(writeTools()).toEqual([]);
    expect(listTools().every(t => t.kind === 'read')).toBe(true);
  });

  // The bar is not "there are no write tools" — it is "adding one fails unless
  // it declares a confirm surface". Assert the rule, not the current contents.
  it('rejects a write tool with no confirm surface', () => {
    expect(() => validateRegistry([
      { name: 'archivePlan', kind: 'write', summary: 'x', run: () => {} },
    ])).toThrow(/must declare a confirmSurface/);
  });

  it('accepts a write tool that names one', () => {
    expect(validateRegistry([
      { name: 'proposePlan', kind: 'write', summary: 'x', confirmSurface: 'plan-editor', run: () => {} },
    ])).toBe(true);
  });

  it('rejects a tool with no declared kind — write must not be the silent default', () => {
    expect(() => validateRegistry([
      { name: 'mystery', summary: 'x', run: () => {} },
    ])).toThrow(/must declare kind/);
  });

  it('rejects a duplicate name, so a later entry cannot shadow a vetted one', () => {
    expect(() => validateRegistry([
      { name: 'dup', kind: 'read', summary: 'x', run: () => {} },
      { name: 'dup', kind: 'write', summary: 'x', confirmSurface: 's', run: () => {} },
    ])).toThrow(/registered twice/);
  });
});

// ── Exit bar 2: logSet / quickLogSet are absent, permanently ────────────
describe('the logging path is never agent-callable (Agent 0 exit 2)', () => {
  it('neither logSet nor quickLogSet is in the registry', () => {
    const names = listTools().map(t => t.name);
    expect(names).not.toContain('logSet');
    expect(names).not.toContain('quickLogSet');
    expect(getTool('logSet')).toBeNull();
    expect(getTool('quickLogSet')).toBeNull();
  });

  // Not "we forgot to add them" — a named refusal. Registering either must fail
  // even WITH a confirm surface, which is what makes this different from rule 1.
  it('refuses them even when they declare a confirm surface', () => {
    for (const name of NEVER_AGENT_CALLABLE) {
      expect(() => validateRegistry([
        { name, kind: 'write', summary: 'x', confirmSurface: 'a-sheet', run: () => {} },
      ])).toThrow(/never agent-callable/);
    }
  });

  it('names exactly the two logging entry points', () => {
    expect([...NEVER_AGENT_CALLABLE].sort()).toEqual(['logSet', 'quickLogSet']);
  });
});

// ── Read tools are real, not placeholders ──────────────────────────────
describe('read tools run against a real database', () => {
  it('every declared read tool executes and returns without throwing', async () => {
    localStorage.clear();
    await initDB();
    for (const { name } of listTools()) {
      const tool = getTool(name);
      // Empty DB: the contract is "returns a value or null", never a throw.
      expect(() => tool.run({ exercise: 'Barbell Bench Press' }), name).not.toThrow();
    }
  });

  it('getActivePlan returns null rather than a half-built object with no plan', async () => {
    localStorage.clear();
    await initDB();
    expect(getTool('getActivePlan').run()).toBeNull();
  });
});

// ── Exit bar 5: every outbound model call is bounded ───────────────────
describe('failure contract (Agent 0 exit 5)', () => {
  it('declares the 15s ceiling from the vision §6 budget table', () => {
    expect(MODEL_TIMEOUT_MS).toBe(15000);
  });

  it('rejects rather than hanging when the call outlives its deadline', async () => {
    const original = globalThis.fetch;
    // A fetch that never settles unless aborted — the exact upstream stall that
    // used to leave the AI summary modal reading "Generating…" forever.
    globalThis.fetch = (_url, { signal } = {}) => new Promise((_res, rej) => {
      signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    try {
      const err = await fetchWithTimeout('/api/ai-summary', {}, 20).catch(e => e);
      expect(isTimeout(err)).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('the live AI call site goes through the bounded fetch, not bare fetch', () => {
    const ai = readFileSync(join(ROOT, 'js/ai.js'), 'utf8');
    expect(ai).toMatch(/fetchWithTimeout\('\/api\/ai-summary'/);
    // A bare `fetch(` reintroduces the unbounded call this bar exists to remove.
    expect(ai).not.toMatch(/[^h]\bfetch\('\/api/);
  });

  it('the serverless proxy bounds its own upstream call too', () => {
    const fn = readFileSync(join(ROOT, 'api/ai-summary.js'), 'utf8');
    expect(fn).toMatch(/AbortSignal\.timeout\(UPSTREAM_TIMEOUT_MS\)/);
    // Server deadline must be under the client's, or the client aborts first and
    // the user gets a generic failure instead of the server's message.
    const ms = Number(fn.match(/UPSTREAM_TIMEOUT_MS = (\d+)/)?.[1]);
    expect(ms).toBeLessThan(MODEL_TIMEOUT_MS);
  });
});

// ── The standing tripwire, asserted in code ────────────────────────────
describe('open-proxy tripwire (§4.1 order: key stays unset until auth ships)', () => {
  // Exit bars 3 and 4 (auth, install credential, rate limits, global cap) are
  // NOT met yet — proxy hardening needs server-side state this project has never
  // had. Until then the only thing standing between the deployment and an open
  // proxy is that ANTHROPIC_API_KEY is unset. This test cannot check Vercel's
  // environment, so it pins the next best thing: that the warning explaining why
  // survives in the file a future edit would touch.
  it('the proxy still carries its unset-key warning', () => {
    const fn = readFileSync(join(ROOT, 'api/ai-summary.js'), 'utf8');
    expect(fn).toMatch(/ANTHROPIC_API_KEY/);
    expect(fn).toMatch(/open proxy/i);
    expect(fn).toMatch(/unset/i);
  });

  it('the agent module tree ships no code to the browser yet', () => {
    // js/agent/tools.js has no caller; if it is ever added to ASSETS without one,
    // it is dead bytes on every device. policy.js DOES have a caller (js/ai.js)
    // and must be cached or an offline AI tap fails on a missing module.
    const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
    expect(sw).toMatch(/'\/js\/agent\/policy\.js'/);
    expect(sw).not.toMatch(/'\/js\/agent\/tools\.js'/);
  });
});
