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
