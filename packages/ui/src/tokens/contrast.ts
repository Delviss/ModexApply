import { brand, dark, neutral, semantic } from './palette.js';

/**
 * The contrast budget (Phase 0 §1.5) as data, so CI can enforce it rather than
 * a reviewer eyeballing it.
 *
 * Every pairing the design system actually ships is listed with the WCAG 2.2
 * minimum that applies to *that use*: `body` (4.5:1, 1.4.3), `large` (3:1 for
 * ≥24px or ≥18.66px bold) and `ui` (3:1 for component boundaries and icons,
 * 1.4.11). A pairing that is not listed is not an approved pairing.
 */
export type ContrastUse = 'body' | 'large' | 'ui';

export const CONTRAST_MINIMUMS: Readonly<Record<ContrastUse, number>> = Object.freeze({
  body: 4.5,
  large: 3,
  ui: 3,
});

export interface ContrastPair {
  name: string;
  foreground: string;
  background: string;
  use: ContrastUse;
  note?: string;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = Object.freeze([
  // --- Light theme, the core budget --------------------------------------
  {
    name: 'brand-600 on surface (links, primary text actions)',
    foreground: brand[600],
    background: neutral.surface,
    use: 'body',
    note: 'Measures 6.98:1 — passes AA body and AAA large. The 7.4:1 figure in issue #2 §1.5 is not what this pair computes to.',
  },
  {
    name: 'surface on brand-600 (primary button label)',
    foreground: neutral.surface,
    background: brand[600],
    use: 'body',
  },
  { name: 'surface on brand-700 (primary button, hover)', foreground: neutral.surface, background: brand[700], use: 'body' },
  { name: 'ink-900 on canvas (body text)', foreground: neutral.ink900, background: neutral.canvas, use: 'body' },
  { name: 'ink-900 on surface (body text)', foreground: neutral.ink900, background: neutral.surface, use: 'body' },
  { name: 'ink-800 on surface (headings)', foreground: neutral.ink800, background: neutral.surface, use: 'body' },
  { name: 'ink-600 on canvas (secondary text, captions)', foreground: neutral.ink600, background: neutral.canvas, use: 'body' },
  { name: 'ink-600 on subtle (zebra rows)', foreground: neutral.ink600, background: neutral.subtle, use: 'body' },
  {
    name: 'ink-800 on subtle (system message in a thread)',
    foreground: neutral.ink800,
    background: neutral.subtle,
    use: 'body',
  },
  {
    name: 'danger text on subtle (suspension notice in a thread)',
    foreground: semantic.dangerText,
    background: neutral.subtle,
    use: 'body',
  },
  {
    name: 'ink-600 on brand-50 (text on a tinted/selected row)',
    foreground: neutral.ink600,
    background: brand[50],
    use: 'body',
  },
  { name: 'brand-700 on brand-50 (badge label on tinted fill)', foreground: brand[700], background: brand[50], use: 'body' },
  {
    name: 'ink-800 on brand-50 (safety banner text)',
    foreground: neutral.ink800,
    background: brand[50],
    use: 'body',
    note: 'Phase 3: the permanent safety banner in every conversation. Brand-tinted ground, ink text — attention without alarm.',
  },
  {
    name: 'brand-700 on brand-50 (safety banner rule and icon)',
    foreground: brand[700],
    background: brand[50],
    use: 'ui',
  },
  {
    name: 'ink-900 on brand-50 (own message bubble)',
    foreground: neutral.ink900,
    background: brand[50],
    use: 'body',
  },
  { name: 'brand-700 on brand-100 (badge label)', foreground: brand[700], background: brand[100], use: 'body' },

  // --- Semantics. Text uses the -text sibling; fills use the base token. ---
  { name: 'success text on surface', foreground: semantic.successText, background: neutral.surface, use: 'body' },
  { name: 'warning text on surface', foreground: semantic.warningText, background: neutral.surface, use: 'body' },
  { name: 'danger text on surface', foreground: semantic.dangerText, background: neutral.surface, use: 'body' },
  { name: 'info text on surface', foreground: semantic.infoText, background: neutral.surface, use: 'body' },
  {
    name: 'warning fill/icon on surface',
    foreground: semantic.warning,
    background: neutral.surface,
    use: 'ui',
    note: 'Non-text only (1.4.11). Body copy in a warning state uses --mx-warning-text.',
  },
  {
    name: 'danger fill/icon on surface',
    foreground: semantic.danger,
    background: neutral.surface,
    use: 'ui',
    note: 'Non-text only. Error copy uses --mx-danger-text.',
  },
  /**
   * The destructive button label.
   *
   * Declared against `dangerText` rather than `danger`, and as body text rather
   * than large: the button renders a 14px label, and measuring it as "large"
   * was how a 4.29:1 button passed this gate and failed an axe run on the page
   * it shipped to.
   */
  {
    name: 'surface on danger-text (destructive button label)',
    foreground: neutral.surface,
    background: semantic.dangerText,
    use: 'body',
  },

  // --- Boundaries and focus ---------------------------------------------
  { name: 'border-input on surface (control boundary)', foreground: neutral.borderInput, background: neutral.surface, use: 'ui' },
  { name: 'border-input on canvas (control boundary)', foreground: neutral.borderInput, background: neutral.canvas, use: 'ui' },
  { name: 'border-input on subtle (control boundary)', foreground: neutral.borderInput, background: neutral.subtle, use: 'ui' },
  { name: 'focus ring on surface', foreground: brand[600], background: neutral.surface, use: 'ui' },
  { name: 'focus ring on canvas', foreground: brand[600], background: neutral.canvas, use: 'ui' },
  { name: 'focus ring on brand-50', foreground: brand[600], background: brand[50], use: 'ui' },

  // --- Dark theme --------------------------------------------------------
  { name: 'dark ink-900 on dark surface', foreground: dark.ink900, background: dark.surface, use: 'body' },
  { name: 'dark ink-600 on dark surface', foreground: dark.ink600, background: dark.surface, use: 'body' },
  { name: 'dark brand action on dark surface', foreground: dark.brandAction, background: dark.surface, use: 'body' },
  { name: 'dark brand action on dark ground', foreground: dark.brandAction, background: dark.ground, use: 'body' },
  { name: 'dark brand link on dark surface', foreground: dark.brandLink, background: dark.surface, use: 'body' },
  { name: 'dark success on dark surface', foreground: dark.success, background: dark.surface, use: 'body' },
  { name: 'dark warning on dark surface', foreground: dark.warning, background: dark.surface, use: 'body' },
  { name: 'dark danger on dark surface', foreground: dark.danger, background: dark.surface, use: 'body' },
  { name: 'dark info on dark surface', foreground: dark.info, background: dark.surface, use: 'body' },
  { name: 'dark focus ring on dark surface', foreground: dark.brandAction, background: dark.surface, use: 'ui' },
  { name: 'dark border-input on dark surface', foreground: dark.borderInput, background: dark.surface, use: 'ui' },
  { name: 'dark border-input on dark ground', foreground: dark.borderInput, background: dark.ground, use: 'ui' },
  { name: 'dark border-input on dark elevated', foreground: dark.borderInput, background: dark.elevated, use: 'ui' },
  { name: 'dark ground on dark brand action (button label)', foreground: dark.ground, background: dark.brandAction, use: 'body' },

  // --- Phase 4: submission state, receipts and the timeline ---------------
  // The four submission states must stay distinguishable, and the ground under
  // two of them is `subtle` rather than `surface`. Every pairing that puts text
  // or a boundary on that ground is measured here rather than assumed from the
  // surface-based pairs above.
  {
    name: 'info on subtle (sending state boundary)',
    foreground: semantic.info,
    background: neutral.subtle,
    use: 'ui',
  },
  {
    name: 'danger on subtle (failed state boundary)',
    foreground: semantic.danger,
    background: neutral.subtle,
    use: 'ui',
  },
  {
    name: 'success on surface (confirmed state boundary)',
    foreground: semantic.success,
    background: neutral.surface,
    use: 'ui',
  },
  {
    name: 'ink-500 on surface (not-submitted boundary)',
    foreground: neutral.ink500,
    background: neutral.surface,
    use: 'ui',
    note: 'Boundary only, at the 3:1 non-text minimum. The words next to it are ink-900.',
  },
  {
    name: 'brand-600 on surface (current timeline node)',
    foreground: brand[600],
    background: neutral.surface,
    use: 'ui',
  },
  {
    name: 'border-input on surface (pending timeline node)',
    foreground: neutral.borderInput,
    background: neutral.surface,
    use: 'ui',
    note: 'A pending node is an unfilled ring, and a ring nobody can see is not a step nobody has taken. Uses --mx-border-input rather than --mx-border-strong for the same reason controls do: the decorative outline measures 1.85:1 and this has to carry meaning.',
  },
  { name: 'dark info on dark subtle (sending state)', foreground: dark.info, background: dark.subtle, use: 'ui' },
  { name: 'dark danger on dark subtle (failed state)', foreground: dark.danger, background: dark.subtle, use: 'ui' },
  { name: 'dark ink-900 on dark subtle (submission copy)', foreground: dark.ink900, background: dark.subtle, use: 'body' },
  { name: 'dark ink-600 on dark subtle (submission detail)', foreground: dark.ink600, background: dark.subtle, use: 'body' },

  // --- Phase 5: offers and the price panel -------------------------------
  //
  // The one rule worth restating here: the saving is `--mx-success`, never
  // brand red, and the ineligible card sits on `--mx-subtle` with its unmet
  // condition in `--mx-warning-text`. Both grounds are measured in both themes,
  // because an explanation a student cannot read is not an explanation.
  {
    name: 'success text on surface (a saving on the price panel)',
    foreground: semantic.successText,
    background: neutral.surface,
    use: 'body',
    note: 'Phase 5: green is for money saved. Brand crimson never carries a saving.',
  },
  {
    name: 'success text on subtle (a saving on a de-emphasised offer card)',
    foreground: semantic.successText,
    background: neutral.subtle,
    use: 'body',
  },
  {
    name: 'warning text on subtle (the unmet condition on an ineligible offer)',
    foreground: semantic.warningText,
    background: neutral.subtle,
    use: 'body',
  },
  {
    name: 'warning text on surface (an offer inside 14 days)',
    foreground: semantic.warningText,
    background: neutral.surface,
    use: 'body',
  },
  {
    name: 'danger text on surface (an offer inside 3 days)',
    foreground: semantic.dangerText,
    background: neutral.surface,
    use: 'body',
  },
  {
    name: 'ink-900 on surface (the net price, at the largest size)',
    foreground: neutral.ink900,
    background: neutral.surface,
    use: 'large',
  },
  { name: 'dark success on dark subtle (a saving on a de-emphasised offer card)', foreground: dark.success, background: dark.subtle, use: 'body' },
  { name: 'dark warning on dark subtle (an unmet offer condition)', foreground: dark.warning, background: dark.subtle, use: 'body' },
  { name: 'dark warning on dark surface (an offer inside 14 days)', foreground: dark.warning, background: dark.surface, use: 'body' },
  { name: 'dark danger on dark surface (an offer inside 3 days)', foreground: dark.danger, background: dark.surface, use: 'body' },
]);

/**
 * Pairs excluded from the gate, each with the reason. An exclusion is a
 * deliberate, reviewed decision — the list is short on purpose.
 */
export const CONTRAST_EXCLUSIONS: readonly { name: string; reason: string }[] = Object.freeze([
  {
    name: 'ink-500 on surface (3.87:1)',
    reason:
      'Disabled-control text only, which WCAG 2.2 1.4.3 exempts. Placeholders use --mx-ink-600, which passes.',
  },
  {
    name: 'border on surface (1.34:1)',
    reason:
      'Decorative hairline between two same-elevation surfaces; it carries no state and no information.',
  },
  {
    name: 'border-strong on surface (1.85:1)',
    reason:
      'Card and table outlines only — decorative structure, no state. Interactive controls use --mx-border-input, which is measured above.',
  },
]);
