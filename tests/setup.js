// Test environment globals for js/db.js, which expects the browser's
// localStorage and the initSqlJs global from the vendored lib/sql-wasm.js.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const initSqlJs = require('../lib/sql-wasm.js'); // UMD — CommonJS require, not import

const LIB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib');

// db.js calls initSqlJs({ locateFile: f => `lib/${f}` }) with a browser-relative
// path; override locateFile to resolve the .wasm against the repo's lib/ dir.
globalThis.initSqlJs = () => initSqlJs({ locateFile: f => path.join(LIB_DIR, f) });

// Minimal localStorage stub. Tests call localStorage.clear() + initDB() in
// beforeEach to get a fresh in-memory database per test.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

// Minimal DOM stub so js/app.js can be imported for its exported pure functions
// (it wires a DOMContentLoaded listener and looks up elements at module scope).
// Tests only exercise DOM-free compute* functions — the stub is never asserted on.
const elements = new Map();
function stubElement(id) {
  if (!elements.has(id)) {
    const classes = new Set(['hidden']);
    elements.set(id, {
      id, textContent: '', value: '', innerHTML: '', style: {}, dataset: {},
      classList: {
        add: c => classes.add(c), remove: c => classes.delete(c),
        toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)),
        contains: c => classes.has(c),
      },
      addEventListener: () => {}, focus: () => {}, blur: () => {},
      querySelectorAll: () => [], appendChild: () => {}, remove: () => {},
    });
  }
  return elements.get(id);
}
globalThis.document = {
  getElementById: stubElement,
  querySelector: () => stubElement('_q' + Math.random()),
  querySelectorAll: () => [],
  createElement: () => stubElement('_el' + Math.random()),
  addEventListener: () => {},
  body: stubElement('_body'),
  documentElement: stubElement('_root'),
};
globalThis.window = globalThis;
globalThis.navigator ??= {};
