import type { CSSProperties } from 'react';
import type { GymSettings, PreferenceValues } from './personalization';

function channels(hex: string): number[] { return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)); }
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(value => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a), y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function mixColor(color: string, target: string, amount: number): string {
  const t = channels(target);
  return '#' + channels(color).map((c, i) => Math.round(c + (t[i] - c) * amount).toString(16).padStart(2, '0')).join('');
}
/** Preserve the chosen hue by mixing toward white/black until all supplied surfaces meet contrast. */
export function readableAccent(accent: string, surfaces: string[], target = 4.5): string {
  if (surfaces.every(surface => contrastRatio(accent, surface) >= target)) return accent;
  let best = accent, bestRatio = Math.min(...surfaces.map(surface => contrastRatio(accent, surface)));
  for (const end of ['#000000', '#ffffff']) {
    for (let step = 1; step <= 100; step++) {
      const candidate = mixColor(accent, end, step / 100);
      const ratio = Math.min(...surfaces.map(surface => contrastRatio(candidate, surface)));
      if (ratio >= target) return candidate;
      if (ratio > bestRatio) { best = candidate; bestRatio = ratio; }
    }
  }
  return best;
}
export function buildTheme(settings: GymSettings, preferences: PreferenceValues, systemDark: boolean): { style: CSSProperties; mode: 'dark' | 'light'; accentContrast: number; accentAdjusted: boolean } {
  const mode = preferences.themeMode === 'system' ? (systemDark ? 'dark' : 'light') : preferences.themeMode;
  const dark = mode === 'dark';
  // The chosen canvas is softly mixed with a stable base, preserving readability even at extreme colors.
  const canvas = dark ? settings.backgroundColor : settings.lightBackgroundColor;
  const background = mixColor(canvas, dark ? '#101211' : '#f3f5f4', 0.85);
  const surface = dark ? '#181b19' : '#ffffff';
  const raised = dark ? '#1e221f' : '#e8eeea';
  const input = dark ? '#121512' : '#ffffff';
  const hover = dark ? '#2a302a' : '#e0e8e2';
  const sidebar = dark ? '#141715' : '#f8faf9';
  const surfaces = [background, surface, raised, input, hover, sidebar];
  const accentVisible = readableAccent(settings.accentColor, surfaces);
  const onAccent = contrastRatio(settings.accentColor, '#101211') >= 4.5 ? '#101211' : contrastRatio(settings.accentColor, '#ffffff') >= 4.5 ? '#ffffff' : '#000000';
  const font = preferences.font === 'system' ? 'system-ui, sans-serif' : preferences.font === 'inter' ? 'Inter, system-ui, sans-serif' : 'Manrope, system-ui, sans-serif';
  const style = {
    colorScheme: mode, '--accent': settings.accentColor, '--accent-text': onAccent, '--accent-visible': accentVisible,
    '--accent-on-photo': readableAccent(settings.accentColor, ['#283027']),
    '--bg': background, '--background': background, '--canvas-color': canvas, '--surface': surface, '--surface-raised': raised, '--surface-hover': hover,
    '--sidebar-bg': sidebar, '--input': input, '--text': dark ? '#eef2eb' : '#19271e', '--muted': dark ? '#b1bcb0' : '#455449',
    '--border': dark ? '#374139' : '#c5d0c9', '--border-strong': dark ? '#768572' : '#6a7b6e',
    '--danger': dark ? '#ffaaaa' : '#a92332', '--danger-surface': dark ? '#3d2226' : '#ffedf0',
    '--warning': dark ? '#f7ce81' : '#77510a', '--warning-surface': dark ? '#382e1d' : '#fff1cf',
    '--success': dark ? '#a6d994' : '#285f30', '--success-surface': dark ? '#233120' : '#e3f2e2',
    '--info': dark ? '#afcffa' : '#245d99', '--info-surface': dark ? '#202d40' : '#e9f2ff',
    '--scroll-thumb': dark ? '#697965' : '#819386', '--scroll-track': sidebar, '--scroll-hover': dark ? '#9aaa95' : '#506a58',
    '--font-body': font, '--text-scale': preferences.textScale / 100,
    '--radius-control': settings.cornerStyle === 'square' ? '3px' : '8px',
    '--radius-panel': settings.cornerStyle === 'square' ? '5px' : '14px',
    '--radius-dialog': settings.cornerStyle === 'square' ? '6px' : '18px',
    '--wallpaper-shield': dark ? '#101211d9' : '#f3f5f4e8',
    '--chart-grid': dark ? '#364136' : '#c5d0c9', '--chart-neutral': dark ? '#a0b49a' : '#5b715e',
  } as CSSProperties;
  return { style, mode, accentContrast: Math.min(...surfaces.map(s => contrastRatio(accentVisible, s))), accentAdjusted: accentVisible.toLowerCase() !== settings.accentColor.toLowerCase() };
}
