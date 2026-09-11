/**
 * Red Velvet + White — the single source of truth for every colour on the
 * platform (Phase 0 §1).
 *
 * `tokens.css` is GENERATED from this file by `scripts/build-tokens.mjs`; do not
 * hand-edit it. Raw hex values are legal *here and only here* — the CI vendor-hex
 * gate greps the rest of `packages/ui` and fails on any literal colour, which is
 * how a 21st.dev block that still carries its author's palette gets caught.
 *
 * The brand is an accent for action and identity, never a background wash.
 */

export const brand = {
  50: '#FDF3F5',
  100: '#FAE3E8',
  200: '#F4C6CF',
  300: '#EA9BAB',
  400: '#DC6980',
  500: '#C63F5A',
  600: '#A72740',
  700: '#8A1E33',
  800: '#6E1828',
  900: '#55131F',
  950: '#300A11',
} as const;

/** Warm-tinted on purpose so white sits beside crimson without going clinical. */
export const neutral = {
  surface: '#FFFFFF',
  canvas: '#FBF9F9',
  subtle: '#F3EFF0',
  border: '#E4DDDF',
  borderStrong: '#C7BCBF',
  /**
   * The visual boundary of an interactive control. Separate from `borderStrong`
   * because WCAG 2.2 1.4.11 requires 3:1 for a control boundary and the
   * specified `borderStrong` (#C7BCBF) measures 1.85:1 against white. That value
   * stays as the decorative table/card outline it reads well as; controls use
   * this one.
   */
  borderInput: '#8C7E82',
  ink500: '#8C7E82',
  ink600: '#5A4F52',
  ink800: '#2E2629',
  ink900: '#1A1416',
} as const;

/**
 * Semantic colours.
 *
 * `danger` is deliberately orange-shifted so it never collides with brand
 * crimson. Brand red is never used to signal an error, and never used to make an
 * ineligible programme or unverified offer look approved.
 *
 * `warningText` and `dangerText` exist because the specified `warning` (3.67:1)
 * and `danger` (4.29:1) miss WCAG 2.2 AA for body text on white. The originals
 * stay as the fill/icon/border colour, where the 3:1 non-text minimum (1.4.11)
 * applies and both pass; text renders in the darker sibling. See
 * `docs/design-system.md`.
 */
export const semantic = {
  success: '#1F7A4D',
  successText: '#1F7A4D',
  warning: '#B5791C',
  warningText: '#8A5A0F',
  danger: '#D64B2A',
  dangerText: '#B83C1E',
  info: '#2563A8',
  infoText: '#2563A8',
} as const;

/** Dark theme. Brand shifts up the scale — 600 fails contrast on dark ground. */
export const dark = {
  ground: '#14100F',
  surface: '#1E1819',
  elevated: '#292122',
  subtle: '#241E1F',
  border: '#3A3032',
  borderStrong: '#544749',
  borderInput: '#7E7073',
  ink500: '#9A8D90',
  ink600: '#BCAFB2',
  ink800: '#E3DADC',
  ink900: '#F2EBEC',
  brandAction: brand[400],
  brandLink: brand[300],
  brandGround: brand[950],
  success: '#4FBF87',
  warning: '#E0A93F',
  danger: '#F2795A',
  info: '#6FA8E8',
} as const;

/**
 * Data-visualisation categorical palette (Phase 0 §2.10). Brand-anchored, not a
 * rainbow: legible on both themes, distinguishable in greyscale and under
 * deuteranopia. Never encode a value by red intensity alone where the value
 * could read as "bad".
 */
export const dataviz = {
  categorical: [brand[600], '#2563A8', '#1F7A4D', '#B5791C', '#6E4C8F', '#0F7C8A'],
  categoricalDark: [brand[400], '#6FA8E8', '#4FBF87', '#E0A93F', '#A98BC7', '#3FB6C4'],
  sequential: [brand[50], brand[200], brand[400], brand[600], brand[800]],
} as const;

export const typography = {
  fontSans:
    "'Inter var', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  /** Marketing headlines only — never product chrome. */
  fontDisplay: "'Source Serif 4', Georgia, 'Times New Roman', serif",
  fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  size: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    md: '1.125rem',
    lg: '1.25rem',
    xl: '1.5rem',
    '2xl': '1.875rem',
    '3xl': '2.25rem',
    '4xl': '3rem',
  },
  lineHeight: { tight: '1.2', snug: '1.35', body: '1.55', relaxed: '1.7' },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
} as const;

/** 4px base grid. */
export const space = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  6: '24px',
  8: '32px',
  12: '48px',
  16: '64px',
  24: '96px',
} as const;

export const radius = {
  control: '6px',
  card: '10px',
  sheet: '16px',
  pill: '9999px',
} as const;

/**
 * The scrim behind a modal (Phase 6).
 *
 * Warm-tinted like the shadows, and darker in the dark theme rather than
 * lighter: a scrim's job is to push the page behind it out of reading range,
 * and a dark surface needs more separation to do that, not less.
 */
export const scrim = {
  light: 'rgba(48, 10, 17, 0.45)',
  dark: 'rgba(0, 0, 0, 0.65)',
} as const;

/** Three levels only, warm-tinted — no pure-black shadows against a warm palette. */
export const elevation = {
  1: '0 1px 2px rgba(48, 10, 17, 0.06)',
  2: '0 4px 12px rgba(48, 10, 17, 0.10)',
  3: '0 16px 40px rgba(48, 10, 17, 0.16)',
} as const;

export const motion = {
  /** State changes. */
  fast: '150ms',
  /** Surfaces entering or leaving. */
  surface: '240ms',
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

/** 2px ring + 2px offset, never removed (Phase 0 §1.5). */
export const focus = {
  width: '2px',
  offset: '2px',
  color: brand[600],
  colorDark: brand[400],
} as const;
