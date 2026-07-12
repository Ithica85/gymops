// escapeHTML guards every innerHTML interpolation of user-entered text
// (plan names, objectives, custom exercise names).
import { describe, it, expect } from 'vitest';
import { escapeHTML } from '../js/ui.js';

describe('escapeHTML', () => {
  it('neutralises HTML metacharacters', () => {
    expect(escapeHTML('<img src=x onerror=alert(1)>'))
      .toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHTML(`"quoted" & 'single'`)).toBe('&quot;quoted&quot; &amp; &#39;single&#39;');
  });

  it('leaves normal exercise names untouched', () => {
    expect(escapeHTML('Chest Press')).toBe('Chest Press');
    expect(escapeHTML('3×8 Squats — heavy')).toBe('3×8 Squats — heavy');
  });
});
