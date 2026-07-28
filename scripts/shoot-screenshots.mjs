// Captures the manifest screenshots for 6.5 at an exact narrow viewport.
//
// Uses the project's established CDP harness pattern (Node 22 built-in
// WebSocket, no dependencies). A plain `--screenshot` run can't do this: the
// install UI wants a populated app, and a fresh headless profile boots to the
// first-run screen. So the DB is seeded through dbImportSessions — the 6.2
// write path, which is the only one that accepts explicit past dates.
//
// Requires the app on http://localhost:8080 —
//   python3 -m http.server 8080 --directory <repo>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = '/tmp/gymops-shot-profile';
const PORT = 9222;

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(`${REPO}/icons/screenshots`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--window-size=390,844',
  'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Fresh --user-data-dir every run, or the profile lock hangs the next one.
let targets = null;
for (let i = 0; i < 40 && !targets; i++) {
  await sleep(250);
  try {
    const r = await fetch(`http://localhost:${PORT}/json/list`);
    const list = await r.json();
    if (list.some(t => t.type === 'page')) targets = list;
  } catch (_) { /* not up yet */ }
}
if (!targets) { chrome.kill(); throw new Error('Chrome never exposed a page target'); }

const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(res => ws.addEventListener('open', res));

let msgId = 0;
const pending = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise(res => pending.set(id, res));
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
// deviceScaleFactor 2 → 780x1688 output. Declared in the manifest as that
// pixel size, which is what Chrome matches against.
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
});

async function goto(url) {
  await send('Page.navigate', { url });
  await sleep(1800);
}

await goto('http://localhost:8080/index.html');

// ── Seed a plausible three weeks of training ──────────────
const seeded = await evaluate(`(async () => {
  const db = await import('/js/db.js');
  const day = n => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(18, 30, 0, 0); return d; };
  const end = d => new Date(d.getTime() + 52 * 60000);

  const push = w => [
    { exercise: 'Barbell Bench Press', setNumber: 1, weight: w - 10, reps: 8, unit: 'kg' },
    { exercise: 'Barbell Bench Press', setNumber: 2, weight: w,      reps: 6, unit: 'kg' },
    { exercise: 'Barbell Bench Press', setNumber: 3, weight: w,      reps: 5, unit: 'kg' },
    { exercise: 'Overhead Press',      setNumber: 1, weight: 40,     reps: 8, unit: 'kg' },
    { exercise: 'Overhead Press',      setNumber: 2, weight: 42.5,   reps: 6, unit: 'kg' },
    { exercise: 'Cable Fly',           setNumber: 1, weight: 20,     reps: 12, unit: 'kg' },
  ];
  const pull = w => [
    { exercise: 'Barbell Row',   setNumber: 1, weight: w,  reps: 8, unit: 'kg' },
    { exercise: 'Barbell Row',   setNumber: 2, weight: w,  reps: 8, unit: 'kg' },
    { exercise: 'Lat Pulldown',  setNumber: 1, weight: 55, reps: 10, unit: 'kg' },
    { exercise: 'Barbell Curl',  setNumber: 1, weight: 30, reps: 10, unit: 'kg' },
  ];

  // The last entry must land in the CURRENT calendar week or the week strip
  // and coverage chips render empty — the strip resets on Monday, so "2 days
  // ago" can easily still be last week.
  const plan = [[19, push(80)], [17, pull(70)], [14, push(82.5)], [12, pull(72.5)],
                [9, push(85)], [7, pull(75)], [4, push(87.5)], [2, pull(77.5)], [0, push(90)]];

  const sessions = plan.map(([ago, sets]) => ({
    startTime: day(ago), endTime: end(day(ago)), notes: null, sets,
  }));
  const res = db.dbImportSessions(sessions, { unit: 'kg' });

  const pid = db.dbCreatePlan('Upper / Lower', new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10), 8, null, 4);
  db.dbSavePlanExercises(pid, [
    { dayId: null, name: 'Push', exercises: [
      { exercise: 'Barbell Bench Press', targetSets: 3, targetReps: 6 },
      { exercise: 'Overhead Press', targetSets: 3, targetReps: 8 },
      { exercise: 'Cable Fly', targetSets: 3, targetReps: 12 } ] },
    { dayId: null, name: 'Pull', exercises: [
      { exercise: 'Barbell Row', targetSets: 3, targetReps: 8 },
      { exercise: 'Lat Pulldown', targetSets: 3, targetReps: 10 },
      { exercise: 'Barbell Curl', targetSets: 3, targetReps: 10 } ] },
  ]);
  return JSON.stringify(res);
})()`);
console.log('seeded:', seeded);

await goto('http://localhost:8080/index.html');
// Dismiss the install card — it advertises the very thing this screenshot
// appears inside, and it would date the image.
await evaluate(`localStorage.setItem('gymops_install_dismissed', Date.now().toString());
  localStorage.setItem('gymops_first_run_dismissed', '1'); true`);
await goto('http://localhost:8080/index.html');
await sleep(1200);

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${REPO}/icons/screenshots/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('wrote', name);
}

await shot('01-home');

// ── Active workout screen ─────────────────────────────────
await evaluate(`document.getElementById('btn-start').click(); true`);
await sleep(900);
await evaluate(`(() => {
  const w = document.getElementById('input-weight'), r = document.getElementById('input-reps');
  // Match today's seeded best (90) rather than beating it: a higher number
  // fires the PR overlay, which would cover the screen we're photographing,
  // and a lower one renders "Slight drop from last session".
  w.value = '90'; r.value = '6';
  document.getElementById('btn-log-set').click();
  return true;
})()`);
await sleep(900);
// The rest countdown auto-starts after a logged set; let it settle so the bar
// shows a sensible number rather than a mid-tick blur.
await sleep(1500);
await shot('02-workout');

// ── Progress chart ────────────────────────────────────────
await evaluate(`document.querySelectorAll('#screen-active .modal').forEach(m => m.classList.add('hidden')); true`);
await goto('http://localhost:8080/index.html');
await evaluate(`document.getElementById('btn-history-idle').click(); true`);
await sleep(700);
await evaluate(`(() => {
  const row = [...document.querySelectorAll('#history-list .history-row')]
    .find(r => r.textContent.includes('Barbell Bench Press'));
  row.click(); return true;
})()`);
await sleep(1200);
await shot('03-progress');

ws.close();
chrome.kill();
console.log('done');
