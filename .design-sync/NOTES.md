# design-sync notes — GymOps

## Why this repo is off the converter path

The `/design-sync` skill converts a **compiled component library** (`dist/` → `_ds_bundle.js`)
so Claude Design's agent can build screens from real components. GymOps has none of that
and never will by design: vanilla HTML/CSS/JS, no build step, no runtime deps, no React.
UI is CSS classes applied to DOM that `js/*.js` constructs imperatively.

Shape detection on 2026-07-26 found: no `.storybook/`, no `*.stories.*`, no `dist/`,
`package.json` private with test-only devDeps. Both `shape` values (`storybook`,
`package`) are wrong for this repo — recorded as `"hand-authored"` instead.

**Do not "fix" this by generating React wrappers.** The skill's own core principle is
"ship what the customer already built — never a reimplementation", and wrappers would
become a second source of truth that drifts from `css/style.css` on the first edit.
Decision made explicitly with the user on 2026-07-26.

## What ships instead

A card catalogue: 10 preview HTML files with `@dsCard` first-line markers (the format the
Design System pane indexes), laid out as `components/<Group>/<Name>/<Name>.html`, plus
`styles.css` as a verbatim mirror of `css/style.css` and `README.md` built from
`.design-sync/conventions.md`.

Consequence to be honest about: the design agent can **read** the conventions and styles,
but cannot **compose** GymOps components. There are none to compose.

## Sync mechanics for this shape

- Bundle is assembled in a scratch dir, not the repo — `ds-bundle/` is a publish artifact,
  not a project asset. Only `.design-sync/` is version-controlled.
- `_ds_sync.json` is **deliberately omitted**. Its hash recipe needs build facts this shape
  has no equivalent of; omitting it is the documented honest choice. Every re-sync
  therefore re-verifies everything from scratch, which is correct here (10 hand-authored
  files, cheap to re-check).
- Upload order that matters: sentinel `_ds_needs_recompile` → content → sentinel again.
  The app clears the sentinel when the project is opened; re-arming is what makes it
  rebuild the card index.

## Re-sync checklist

1. Re-copy `css/style.css` → `styles.css` (add the provenance header).
2. Re-check every class/token named in `conventions.md` still exists — that file is
   human-editable and **must never be rewritten wholesale**, only corrected.
3. Rebuild the 10 cards from the current stylesheet; verify in a browser at 375×667
   before uploading. Cards inline their own `:root`, so a token change means touching
   every card.
4. `finalize_plan` with the same globs, then write → reconcile deletes → sentinel.

## Verification gotcha (cost a cycle on 2026-07-26)

When probing the real stylesheet from a local server, **cache-bust the href** (`?v=x`).
Chrome serves the previously-cached `css/style.css` on the same origin and a correct fix
reads as a failure. See `project_dev_gotchas` in memory.
