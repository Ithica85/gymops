// ═══════════════════════════════════════════════════════
// GymOps — Exercise history: list screen, per-exercise detail, inline SVG chart
// ═══════════════════════════════════════════════════════

import { dbGetExercise, dbGetExerciseSessionHistory, dbGetExercisesWithHistory, dbRenameExercise } from './db.js';
import { convertWeight, getWeightUnit, state } from './state.js';
import { onScreenShow, showScreen, showToast } from './ui.js';

// Formats a date for history displays: "2 Jul", with the year appended
// only when it differs from the current year ("2 Jul 2025").
function fmtHistDate(d) {
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

// Renders the exercise list on the History screen, most recently used first.
// Rows are built via DOM APIs (not innerHTML) because custom "Other" exercise
// names are user-entered free text.
function renderHistoryScreen() {
  const list  = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  const rows  = dbGetExercisesWithHistory();

  list.innerHTML = '';
  empty.classList.toggle('hidden', rows.length > 0);

  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'history-row';

    const name = document.createElement('span');
    name.className = 'history-row-name';
    name.textContent = r.exercise;

    const meta = document.createElement('span');
    meta.className = 'history-row-meta';
    meta.textContent =
      `${r.session_count} session${r.session_count !== 1 ? 's' : ''} · ${fmtHistDate(new Date(r.last_used))}`;

    const arrow = document.createElement('span');
    arrow.className = 'history-row-arrow';
    arrow.textContent = '›';

    row.append(name, meta, arrow);
    row.addEventListener('click', () => openExerciseHistory(r.exercise));
    list.appendChild(row);
  });
}

onScreenShow('history', renderHistoryScreen);

// Chart layout state for the pointer/tooltip handler. Rebuilt on every render.
// px is each point's x coordinate in viewBox units; the handler rescales
// pointer offsets by (viewBox width / rendered width) to find the nearest point.
let _histChart = null;

const HIST_W   = 320;

const HIST_H   = 190;

const HIST_PAD = { top: 18, right: 14, bottom: 22, left: 40 };

// Picks a "nice" gridline step (1/2/5 × power of 10) close to rawStep.
function _niceStep(rawStep) {
  const pow  = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const frac = rawStep / pow;
  if (frac <= 1) return pow;
  if (frac <= 2) return 2 * pow;
  if (frac <= 5) return 5 * pow;
  return 10 * pow;
}

// Builds the progression line chart as inline SVG.
// points: [{ date: Date, value: Number, detail: String }] in ascending date order,
// values already converted to the display unit. Single series — the screen title
// names it, so there is no legend. Numbers/dates only go through innerHTML;
// user-entered text never enters this string.
function renderHistoryChart(points, unitLabel) {
  const wrap = document.getElementById('history-chart');
  const note = document.getElementById('history-chart-note');
  wrap.innerHTML = '';
  _histChart = null;
  hideHistoryTooltip();

  if (points.length < 2) {
    note.textContent = points.length === 1
      ? 'Your trend line appears from the second session.'
      : 'No data for this exercise yet.';
    note.classList.remove('hidden');
    if (!points.length) return;
  } else {
    note.classList.add('hidden');
  }

  const innerW = HIST_W - HIST_PAD.left - HIST_PAD.right;
  const innerH = HIST_H - HIST_PAD.top - HIST_PAD.bottom;
  const baseY  = HIST_H - HIST_PAD.bottom;

  // Y domain with ~10% headroom either side; never below zero
  const values = points.map(p => p.value);
  const vMin   = Math.min(...values);
  const vMax   = Math.max(...values);
  const spread = (vMax - vMin) || Math.max(vMax * 0.1, 1);
  const yMin   = Math.max(0, vMin - spread * 0.15);
  const yMax   = vMax + spread * 0.15;

  const x = i => points.length === 1
    ? HIST_PAD.left + innerW / 2
    : HIST_PAD.left + (i / (points.length - 1)) * innerW;
  const y = v => baseY - ((v - yMin) / (yMax - yMin)) * innerH;

  const px  = points.map((_, i) => x(i));
  const pts = points.map((p, i) => `${px[i].toFixed(1)},${y(p.value).toFixed(1)}`);

  // Horizontal gridlines at ~3 clean-number ticks, hairline, recessive
  const step = _niceStep((yMax - yMin) / 3);
  let grid = '';
  for (let t = Math.ceil(yMin / step) * step; t <= yMax; t += step) {
    const gy = y(t).toFixed(1);
    grid += `<line x1="${HIST_PAD.left}" x2="${HIST_W - HIST_PAD.right}" y1="${gy}" y2="${gy}" stroke="#2c2c2c" stroke-width="1"/>`;
    grid += `<text x="${HIST_PAD.left - 6}" y="${+gy + 3}" text-anchor="end" font-size="10" fill="#777">${Math.round(t * 10) / 10}</text>`;
  }

  // Area wash under the line (skip for a single point)
  const area = points.length > 1
    ? `<path d="M ${pts[0]} L ${pts.join(' L ')} L ${px[px.length - 1].toFixed(1)},${baseY} L ${px[0].toFixed(1)},${baseY} Z" fill="#c8ff57" opacity="0.08"/>`
    : '';

  const line = points.length > 1
    ? `<polyline points="${pts.join(' ')}" fill="none" stroke="#c8ff57" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    : '';

  // Dots: series fill with a 2px surface ring so they read where they cross the line
  const dots = points.map((p, i) =>
    `<circle cx="${px[i].toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" fill="#c8ff57" stroke="#181818" stroke-width="2"/>`
  ).join('');

  // Selective direct label: endpoint value only, in text ink (never the series color)
  const last   = points[points.length - 1];
  const lastX  = Math.min(px[px.length - 1], HIST_W - HIST_PAD.right - 2);
  const endLbl = `<text x="${lastX.toFixed(1)}" y="${(y(last.value) - 9).toFixed(1)}" text-anchor="end" font-size="11" font-weight="600" fill="#f0f0f0">${Math.round(last.value * 10) / 10} ${unitLabel}</text>`;

  // X labels: first and last session dates
  let xLbls = `<text x="${HIST_PAD.left}" y="${HIST_H - 6}" text-anchor="start" font-size="10" fill="#777">${fmtHistDate(points[0].date)}</text>`;
  if (points.length > 1) {
    xLbls += `<text x="${HIST_W - HIST_PAD.right}" y="${HIST_H - 6}" text-anchor="end" font-size="10" fill="#777">${fmtHistDate(last.date)}</text>`;
  }

  const crosshair = `<line id="hist-crosshair" x1="0" x2="0" y1="${HIST_PAD.top}" y2="${baseY}" stroke="#444" stroke-width="1" visibility="hidden"/>`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${HIST_W} ${HIST_H}`);
  svg.innerHTML = grid + area + crosshair + line + dots + endLbl + xLbls;
  wrap.appendChild(svg);

  _histChart = { points, px, unitLabel, svg };

  // Crosshair + tooltip: snap to the nearest session by X. pan-y touch-action
  // (in CSS) keeps vertical page scroll working while horizontal drags scrub.
  svg.addEventListener('pointermove', _histPointerMove);
  svg.addEventListener('pointerdown', _histPointerMove);
  svg.addEventListener('pointerleave', hideHistoryTooltip);
}

function _histPointerMove(e) {
  if (!_histChart) return;
  const rect  = _histChart.svg.getBoundingClientRect();
  const vx    = ((e.clientX - rect.left) / rect.width) * HIST_W; // viewBox units
  let nearest = 0;
  _histChart.px.forEach((p, i) => {
    if (Math.abs(p - vx) < Math.abs(_histChart.px[nearest] - vx)) nearest = i;
  });

  const point = _histChart.points[nearest];
  const cross = document.getElementById('hist-crosshair');
  if (cross) {
    cross.setAttribute('x1', _histChart.px[nearest]);
    cross.setAttribute('x2', _histChart.px[nearest]);
    cross.setAttribute('visibility', 'visible');
  }

  const tip = document.getElementById('history-tooltip');
  document.getElementById('history-tooltip-value').textContent =
    `${Math.round(point.value * 10) / 10} ${_histChart.unitLabel}${point.detail ? ` ${point.detail}` : ''}`;
  document.getElementById('history-tooltip-date').textContent = fmtHistDate(point.date);
  tip.classList.remove('hidden');

  // Position over the hovered point, clamped inside the card
  const card    = tip.parentElement;
  const cardW   = card.clientWidth;
  const pointPx = rect.left - card.getBoundingClientRect().left + (_histChart.px[nearest] / HIST_W) * rect.width;
  const half    = tip.offsetWidth / 2;
  tip.style.left = `${Math.max(half + 4, Math.min(cardW - half - 4, pointPx))}px`;
}

function hideHistoryTooltip() {
  document.getElementById('history-tooltip').classList.add('hidden');
  const cross = document.getElementById('hist-crosshair');
  if (cross) cross.setAttribute('visibility', 'hidden');
}

// Renders the per-session breakdown list, newest first. This is the chart's
// table view — every plotted value is readable here without touching the chart.
function renderHistorySessions(rows, weighted, unit) {
  const container = document.getElementById('history-sessions');
  container.innerHTML = '';

  [...rows].reverse().forEach(r => {
    const row = document.createElement('div');
    row.className = 'history-session-row';

    const date = document.createElement('span');
    date.className = 'history-session-date';
    date.textContent = fmtHistDate(new Date(r.start_time));

    const main = document.createElement('span');
    main.className = 'history-session-main';
    if (weighted && r.best_weight_kg != null) {
      const w = convertWeight(r.best_weight_kg, 'kg', unit);
      main.textContent = `${w} ${unit}${r.reps_at_best != null ? ` × ${r.reps_at_best}` : ''}`;
    } else if (r.total_mins != null) {
      main.textContent = `${Math.round(r.total_mins * 10) / 10} min${r.total_cals ? ` · ${r.total_cals} cal` : ''}`;
    } else {
      main.textContent = '—';
    }

    const sets = document.createElement('span');
    sets.className = 'history-session-sets';
    sets.textContent = `${r.set_count} set${r.set_count !== 1 ? 's' : ''}`;

    row.append(date, main, sets);
    container.appendChild(row);
  });
}

// Name of the exercise currently shown on the detail screen — the rename
// modal's only source of truth for which identity it's editing (5.7).
let _currentExercise = null;

// Opens the detail screen for one exercise: stat tiles, chart, session list.
// An exercise charts weight when any session has weight data, otherwise duration —
// data presence decides, so custom "Other" cardio names chart correctly too.
function openExerciseHistory(exercise) {
  _currentExercise = exercise;
  document.getElementById('exercise-history-title').textContent = exercise;

  const rows     = dbGetExerciseSessionHistory(exercise);
  const unit     = getWeightUnit();
  const weighted = rows.some(r => r.best_weight_kg != null);

  const points = weighted
    ? rows.filter(r => r.best_weight_kg != null).map(r => ({
        date:   new Date(r.start_time),
        value:  convertWeight(r.best_weight_kg, 'kg', unit),
        detail: r.reps_at_best != null ? `× ${r.reps_at_best}` : '',
      }))
    : rows.filter(r => r.total_mins != null).map(r => ({
        date:   new Date(r.start_time),
        value:  Math.round(r.total_mins * 10) / 10,
        detail: r.total_cals ? `· ${r.total_cals} cal` : '',
      }));

  const unitLabel = weighted ? unit : 'min';
  const fmtVal    = v => `${Math.round(v * 10) / 10} ${unitLabel}`;

  const bestEl   = document.getElementById('hist-stat-best');
  const lastEl   = document.getElementById('hist-stat-last');
  const changeEl = document.getElementById('hist-stat-change');

  if (points.length) {
    bestEl.textContent = fmtVal(Math.max(...points.map(p => p.value)));
    lastEl.textContent = fmtVal(points[points.length - 1].value);
  } else {
    bestEl.textContent = '—';
    lastEl.textContent = '—';
  }

  changeEl.classList.remove('positive', 'negative');
  if (points.length >= 2) {
    const delta = Math.round((points[points.length - 1].value - points[0].value) * 10) / 10;
    changeEl.textContent = `${delta > 0 ? '+' : ''}${delta} ${unitLabel}`;
    if (delta > 0) changeEl.classList.add('positive');
    if (delta < 0) changeEl.classList.add('negative');
  } else {
    changeEl.textContent = '—';
  }

  renderHistoryChart(points, unitLabel);
  renderHistorySessions(rows, weighted, unit);
  showScreen('exercise-history');
}

// ── Rename (5.7) ──────────────────────────────────────
// `dbRenameExercise` throws on a name clash or empty input; both are shown
// inline in the modal rather than as a toast, since the user is actively
// mid-edit. Success re-runs openExerciseHistory under the new name — history
// follows through the denormalised exercise column dbRenameExercise updated,
// so the detail screen and its chart are already correct.

export function openRenameExercise() {
  if (!_currentExercise) return;
  document.getElementById('rename-exercise-input').value = _currentExercise;
  document.getElementById('rename-exercise-error').classList.add('hidden');
  document.getElementById('rename-exercise-modal').classList.remove('hidden');
}

export function closeRenameExercise() {
  document.getElementById('rename-exercise-modal').classList.add('hidden');
}

export function confirmRenameExercise() {
  const input   = document.getElementById('rename-exercise-input');
  const errorEl = document.getElementById('rename-exercise-error');
  const current = dbGetExercise(_currentExercise);
  if (!current) { closeRenameExercise(); return; }

  let newName;
  try {
    newName = String(input.value ?? '').trim();
    dbRenameExercise(current.exercise_id, newName);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    return;
  }

  closeRenameExercise();
  showToast(`Renamed to "${newName}"`);
  openExerciseHistory(newName);
}

// ── AI Session Summary ────────────────────────────────
