// Phase 6.3 — accessibility guards.
//
// These assert against the source files rather than a rendered page, because
// the things they protect are invisible when they break: a contrast ratio that
// drifts under 4.5, a new modal added without a name, an input shipped with
// only a placeholder. Every one of those looks completely fine on screen.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeRowInteractive } from '../js/ui.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css  = readFileSync(join(ROOT, 'css/style.css'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// ── WCAG relative luminance / contrast ────────────────
function luminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function token(name) {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} not found`);
  return m[1].trim();
}

describe('colour contrast (WCAG AA, 4.5:1 for normal text)', () => {
  // --muted is the app's entire secondary tier (76 uses) and appears on all
  // three background layers. At #777 it failed on every one of them.
  it.each(['bg', 'surface', 'surface2'])('--muted passes on --%s', surface => {
    expect(contrast(token('muted'), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  // .btn-danger's label is 1rem/800 = 16px. WCAG "large text" starts at
  // 18.66px bold, so this needs the full 4.5 — not the 3.0 large-text bar.
  it('white label on the danger fill passes', () => {
    expect(contrast('#ffffff', token('danger-solid'))).toBeGreaterThanOrEqual(4.5);
  });

  // The bright --danger stays a TEXT colour on dark surfaces. Collapsing the
  // two tokens back into one is the mistake this guards against.
  it('--danger still passes as text on --bg', () => {
    expect(contrast(token('danger'), token('bg'))).toBeGreaterThanOrEqual(4.5);
  });

  it('body text and accent pass comfortably', () => {
    expect(contrast(token('text'), token('bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('accent'), token('bg'))).toBeGreaterThanOrEqual(4.5);
  });

  it('the danger fill is only used as a fill, never as text', () => {
    expect(css).not.toMatch(/color:\s*var\(--danger-solid\)/);
  });
});

describe('accessible names in index.html', () => {
  it('every dialog has a name', () => {
    const dialogs = html.match(/<div[^>]*role="dialog"[^>]*>/g) ?? [];
    expect(dialogs.length).toBeGreaterThan(10);
    const unnamed = dialogs.filter(d => !/aria-labelledby=|aria-label=/.test(d));
    expect(unnamed).toEqual([]);
  });

  it('every aria-labelledby points at an element that exists', () => {
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    const refs = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map(m => m[1]);
    expect(refs.length).toBeGreaterThan(10);
    expect(refs.filter(r => !ids.has(r))).toEqual([]);
  });

  it('every input and textarea has a name (placeholders do not count)', () => {
    const labelFor = new Set([...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map(m => m[1]));
    const unnamed = [];
    for (const m of html.matchAll(/<(input|textarea)\b[^>]*>/gs)) {
      const tag = m[0];
      const id = tag.match(/id="([^"]+)"/)?.[1];
      if (!id) continue;
      if (!/aria-label(?:ledby)?=/.test(tag) && !labelFor.has(id)) unnamed.push(id);
    }
    expect(unnamed).toEqual([]);
  });

  it('the log inputs are labelled by reference, so the unit stays correct', () => {
    // aria-label="Weight" would announce "Weight" on a treadmill — the visible
    // label is rewritten per exercise type, so the name must follow it.
    // Attribute ORDER is not asserted: it's meaningless in HTML, and pinning it
    // would fail the next time these tags are reformatted.
    const tagFor = id => [...html.matchAll(/<input\b[^>]*>/gs)]
      .map(m => m[0]).find(t => t.includes(`id="${id}"`));
    expect(tagFor('input-weight')).toMatch(/aria-labelledby="label-field1"/);
    expect(tagFor('input-reps')).toMatch(/aria-labelledby="label-field2"/);
  });

  it('symbol-only dismiss buttons are named', () => {
    for (const m of html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)) {
      if (m[1].trim() === '✕') expect(m[0]).toMatch(/aria-label=/);
    }
  });
});

describe('makeRowInteractive', () => {
  function stubRow() {
    const handlers = {};
    return {
      attributes: {}, tabIndex: undefined,
      setAttribute(k, v) { this.attributes[k] = v; },
      addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
      fire(type, evt) { (handlers[type] ?? []).forEach(fn => fn(evt)); },
    };
  }

  it('gives the row the button contract it was only pretending to have', () => {
    const row = stubRow();
    makeRowInteractive(row, () => {});
    expect(row.attributes.role).toBe('button');
    expect(row.tabIndex).toBe(0);
  });

  it('activates on click, Enter and Space', () => {
    for (const [type, evt] of [['click', {}], ['keydown', { key: 'Enter' }], ['keydown', { key: ' ' }]]) {
      let fired = 0;
      const row = stubRow();
      makeRowInteractive(row, () => fired++);
      row.fire(type, { ...evt, preventDefault() {} });
      expect(fired).toBe(1);
    }
  });

  it('ignores other keys, so typing in a row does not select it', () => {
    let fired = 0;
    const row = stubRow();
    makeRowInteractive(row, () => fired++);
    for (const key of ['a', 'Tab', 'ArrowDown', 'Escape']) {
      row.fire('keydown', { key, preventDefault() {} });
    }
    expect(fired).toBe(0);
  });

  it('preventDefaults Space, which would otherwise scroll the sheet', () => {
    let prevented = false;
    const row = stubRow();
    makeRowInteractive(row, () => {});
    row.fire('keydown', { key: ' ', preventDefault() { prevented = true; } });
    expect(prevented).toBe(true);
  });
});
