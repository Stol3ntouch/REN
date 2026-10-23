import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Контраст пар «текст/фон» из CSS-переменных темы (WCAG 2.x): обычный текст ≥ 4.5, элементы интерфейса (фокус) ≥ 3. */
const css = readFileSync(join(process.cwd(), 'src', 'ui', 'theme.css'), 'utf8');
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
const vars = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2] as string]));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ['color-text', 'color-bg'],
  ['color-text', 'color-surface'],
  ['color-muted', 'color-bg'],
  ['color-muted', 'color-surface'],
  ['color-primary', 'color-bg'],
  ['color-primary-hover', 'color-bg'],
  ['color-on-primary', 'color-primary'],
  ['color-on-primary', 'color-primary-hover'],
  ['color-on-dark', 'color-dark'],
  ['color-on-dark-muted', 'color-dark'],
  ['color-accent-on-dark', 'color-dark'],
  ['color-error', 'color-bg'],
  ['color-success', 'color-bg'],
  ['color-placeholder-text', 'color-placeholder-bg'],
];

describe('контраст темы', () => {
  it('переменные темы прочитаны', () => {
    expect(Object.keys(vars).length).toBeGreaterThan(15);
  });
  for (const [fg, bg] of TEXT_PAIRS) {
    it(`${fg} на ${bg} ≥ 4.5:1`, () => {
      expect(vars[fg], fg).toBeDefined();
      expect(vars[bg], bg).toBeDefined();
      expect(ratio(vars[fg] as string, vars[bg] as string)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('кольцо фокуса на белом и на светлой поверхности ≥ 3:1', () => {
    expect(ratio(vars['color-focus'] as string, vars['color-bg'] as string)).toBeGreaterThanOrEqual(3);
    expect(ratio(vars['color-focus'] as string, vars['color-surface'] as string)).toBeGreaterThanOrEqual(3);
  });
});

describe('фокус на тёмном фоне', () => {
  const layout = readFileSync(join(process.cwd(), 'src', 'ui', 'layout', 'layout.css'), 'utf8');
  it('кольцо фокуса синим на тёмном подвале даёт < 3:1, поэтому в подвале оно светлое (≥ 3:1)', () => {
    expect(ratio(vars['color-focus'] as string, vars['color-dark'] as string)).toBeLessThan(3);
    const rule = layout.match(/\.site-footer\s+:focus-visible\s*\{([^}]*)\}/);
    expect(rule, 'нет правила .site-footer :focus-visible').not.toBeNull();
    expect(rule?.[1]).toContain('var(--color-accent-on-dark)');
    expect(ratio(vars['color-accent-on-dark'] as string, vars['color-dark'] as string)).toBeGreaterThanOrEqual(3);
  });
});
