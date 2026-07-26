# GymOps — UI Reference

**Scope, read this first.** GymOps is a vanilla HTML/CSS/JS PWA — no framework, no build
step, no runtime dependencies. There is no importable component library here and no
`_ds_bundle.js`: nothing in this project can be composed as a component. What it holds is
the real stylesheet plus verified preview cards. Build GymOps UI by **writing HTML and
applying these classes**, not by importing parts.

`css/style.css` in the GymOps repo is the source of truth. `styles.css` here is a verbatim
mirror; edits belong in the repo, then re-sync.

## Setup

No provider, no wrapper, no theme object. Link `styles.css` and the tokens are live — they
are plain custom properties on `:root`. Dark only; there is no light theme.

Screens are `<div class="screen">`, shown by adding `.active` (flex column, `100dvh`,
`max-width: 480px`, centred). `.hidden` is `display: none !important` and is how
everything else is toggled. **Design target is 375×667**, and on the active workout screen
all controls must stay above the fold.

## Tokens

`--bg` `#0d0d0d` · `--surface` `#181818` · `--surface2` `#222222` · `--border` `#2c2c2c`
· `--text` `#f0f0f0` · `--muted` `#777` · `--accent` `#c8ff57` (lime) · `--danger`
`#ff4040` · `--radius` `14px` · `--font` (system stack)

Surfaces stack `--bg` → `--surface` (cards, sheets) → `--surface2` (inputs, chips).
`--radius` is `14px`; dense repeated rows use `10px` and pills use `999px`.

## Styling idiom

Semantic component classes, **not** utilities — there is no `p-4` or `bg-surface-1`
vocabulary, and inventing one will not resolve. State is a `--` suffix on the base class
(`.picker-chip--active`, `.coverage-chip--hit`, `.week-day--trained`,
`.plan-week-chip--done`, `.unit-btn--active`, `.stat-value--timer`,
`.plan-view-item--current`, `.set-item--confirming`).

| Family | Classes |
| --- | --- |
| Buttons | `.btn-primary` `.btn-secondary` `.btn-danger` `.btn-text`; `.btn-large` (full width), `.btn-demoted` (primary in secondary colours), `.settings-danger-link` |
| Inputs | `.set-input` (the big numeric field), `.input-row` `.input-col` `.input-label` `.input-hint` `.input-error` `.weight-convert`; `.plan-text-input` `.notes-input` `.picker-search` |
| Chips | `.picker-chip` `.coverage-chip` `.plan-week-chip` `.day-chip` `.plan-chip` `.rest-adjust`; segmented `.unit-btn` `.picker-sort-btn` |
| Sheets | `.modal` > `.modal-backdrop` + `.modal-sheet` > `.modal-handle` `.modal-title` `.modal-body` `.modal-actions` `.modal-cancel` |
| Cards | `.week-strip` `.plan-card` `.history-stat` `.history-chart-card` `.set-item` |
| Banners | `.reminder-banner` `.plan-expiry-banner` `.plan-nudge-banner` `.persist-banner` `.toast` |

## Rules that are not obvious

- **Emphasis is colour-only.** A control never changes padding or size to signal state —
  `.btn-demoted` and `.quick-log-quiet` swap colours at identical geometry so nothing
  moves under a mid-tap finger.
- **Specificity trap.** `.exactly-one-class` rules declared *after* a descendant rule
  still lose to it. `.exercise-list li` is `(0,1,1)` and outranks `.picker-divider`
  `(0,1,0)` — three v6.4 bugs came from exactly this. Overriding a list-row style needs
  the compound form: `.exercise-list li.picker-divider`. Same reason
  `.btn-text.idle-link` exists.
- **1rem is the input floor.** Sub-16px fields trigger iOS focus auto-zoom. Narrow fields
  buy width from padding, never font-size (see `.plan-target-input`).
- **Sheets scroll internally.** A `flex: 1` list inside a `max-height: 72vh` sheet, so
  scrolling content never dismisses it. Give sibling rows `flex-shrink: 0` — a scroll
  container's flex `min-height` resolves to `0` and it will be crushed.
- **One banner at a time.** Expiry > nudge > reminder, never stacked.
- **Escape user text.** Plan names, objectives and custom exercise names go through
  `escapeHTML()` (`js/ui.js:105`) when interpolated into `innerHTML` — or use
  `textContent`.

## Known contrast gaps

`--muted` on `--surface` **4.0:1**, on `--surface2` **3.6:1**, on `--bg` **4.3:1**; `#fff`
on `--danger` (the `.btn-danger` label, 1rem/800 — not large text) **3.5:1**. All under
the 4.5:1 AA floor. Don't propagate these pairings into new work.

## Idiomatic snippet

```html
<div class="modal">
  <div class="modal-backdrop"></div>
  <div class="modal-sheet">
    <div class="modal-handle"></div>
    <h2 class="modal-title">Discard session?</h2>
    <p class="modal-body">You have an unfinished workout with 4 sets logged.</p>
    <div class="modal-actions">
      <button class="btn-danger btn-large">Discard &amp; Start New</button>
      <button class="btn-secondary btn-large">Keep Resuming</button>
    </div>
  </div>
</div>
```

Destructive action first, safe second, both full-width. Backdrop tap cancels.
