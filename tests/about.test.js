// Phase 6.7 — about / landing page guards.
//
// Like the 6.3 guards these assert against source files, because everything
// here fails silently: a page that stops scrolling because the app's stylesheet
// changed under it, a new file missing from the SW precache, a link-preview
// card whose image 404s in someone else's Slack, a hardcoded number that has
// quietly stopped being true.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EXERCISES } from '../js/state.js';

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..');
const about = readFileSync(join(ROOT, 'about.html'), 'utf8');
const css   = readFileSync(join(ROOT, 'css/about.css'), 'utf8');
const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
const sw    = readFileSync(join(ROOT, 'sw.js'), 'utf8');

describe('about page ↔ app stylesheet coupling', () => {
  // The page borrows tokens, buttons and the focus ring from the app's sheet
  // rather than restating them. Order matters: about.css has to come second to
  // override anything it needs to.
  it('loads style.css first, then about.css', () => {
    const a = about.indexOf('css/style.css');
    const b = about.indexOf('css/about.css');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });

  // style.css sets `body { height: 100%; overflow: hidden }` so the app can own
  // the viewport. Inherited unchanged, that makes a document unscrollable below
  // the fold — the single worst way this page could break, and it looks fine in
  // a screenshot of the top of it.
  it('re-enables document scrolling for the about body', () => {
    const rule = css.match(/body\.about-page\s*\{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule[1]).toMatch(/height:\s*auto/);
    expect(rule[1]).toMatch(/overflow:\s*visible/);
  });

  it('applies that class to the body element', () => {
    expect(about).toMatch(/<body[^>]*class="[^"]*about-page/);
  });
});

describe('offline + assets', () => {
  // CLAUDE.md's standing rule: a new file that isn't in ASSETS breaks offline.
  it.each(['/about.html', '/css/about.css'])('%s is in the SW precache', path => {
    expect(sw).toContain(`'${path}'`);
  });

  // Only a social crawler ever asks for the OG card; precaching 37KB no user
  // sees would be waste.
  it('the OG card is deliberately NOT precached', () => {
    expect(sw).not.toContain('og-card.png\'');
  });

  it('every asset the page references exists on disk', () => {
    const refs = [...about.matchAll(/(?:src|href|content)="((?:icons|css|js)\/[^"]+)"/g)].map(m => m[1]);
    expect(refs.length).toBeGreaterThan(3);
    for (const ref of refs) expect(existsSync(join(ROOT, ref)), ref).toBe(true);
  });

  // og:image must be absolute — a relative one resolves against the crawler,
  // not the site, and the preview silently renders with no image.
  it('the link-preview image is absolute and present', () => {
    const m = about.match(/property="og:image"\s+content="([^"]+)"/);
    expect(m).toBeTruthy();
    expect(m[1]).toMatch(/^https:\/\//);
    expect(existsSync(join(ROOT, 'icons/og-card.png'))).toBe(true);
  });
});

describe('discoverability', () => {
  it('declares the meta a shared link needs', () => {
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card']) {
      expect(about, tag).toContain(tag);
    }
    expect(about).toMatch(/<meta name="description" content="[^"]{40,}"/);
    expect(about).toMatch(/<link rel="canonical"/);
  });

  it('is reachable from Settings', () => {
    expect(index).toMatch(/href="about\.html"/);
  });

  it('offers a way back into the app', () => {
    expect(about).toMatch(/href="\/"/);
  });
});

describe('page structure', () => {
  it('has exactly one h1', () => {
    expect(about.match(/<h1[\s>]/g)?.length).toBe(1);
  });

  // Screenshots carry the whole "what does it look like" argument, so an empty
  // alt would leave a screen-reader user with nothing — and they're also what
  // renders when the (deliberately uncached) images are unavailable offline.
  it('every image has a meaningful alt', () => {
    const imgs = [...about.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      const alt = img.match(/alt="([^"]*)"/);
      expect(alt, img.slice(0, 60)).toBeTruthy();
      expect(alt[1].length).toBeGreaterThan(20);
    }
  });

  // A landing page has no business booting sql.js. The inline module reads two
  // constants; importing anything that reaches db.js would pull the whole
  // storage layer onto a page that must stay a document.
  it('imports nothing beyond state.js', () => {
    const imports = [...about.matchAll(/import\s+[^;]*?from\s+'([^']+)'/g)].map(m => m[1]);
    expect(imports).toEqual(['./js/state.js']);
  });
});

describe('numbers that would otherwise rot', () => {
  // The page shows the catalogue size live, but the static fallback in the
  // markup is what a crawler (and a no-JS visitor) sees, so it has to be true.
  it('the hardcoded exercise count matches the catalogue', () => {
    const real = EXERCISES.filter(e => e.muscleGroup).length;
    const shown = about.match(/id="about-exercise-count">(\d+) exercises/);
    expect(shown).toBeTruthy();
    expect(Number(shown[1])).toBe(real);
  });
});
