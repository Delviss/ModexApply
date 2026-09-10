# Red Velvet + White

The design system for Modex Apply. Deep warm crimson against generous white,
built to read as *institutional trust* rather than as a retail promotion.

Source of truth: [`packages/ui/src/tokens/palette.ts`](../packages/ui/src/tokens/palette.ts).
`tokens.css` is **generated** from it — never hand-edit the CSS.

```bash
pnpm --filter @modex/ui build:tokens   # regenerate tokens.css
pnpm test:contrast                     # measure every approved pairing
pnpm check:vendor-hex                  # catch un-re-themed vendor colours
```

---

## 1. The rule that shapes everything else

Red is an accent for **action and identity**. It is never a background wash,
never an error state, and never used to make an ineligible programme or an
unverified offer look approved.

Three consequences run through the whole system:

- `--mx-danger` is deliberately orange-shifted (`#D64B2A`) so it cannot be
  mistaken for brand crimson.
- Verification state is **never** conveyed by colour alone. Every state carries
  an icon and a text label, and the label survives greyscale, colour blindness
  and a screen reader.
- On the public catalogue surfaces, brand crimson is reserved for the primary
  apply action and the active nav item. Nothing else competes for it — the
  evidence disclosure on `<VerificationBadge>` is a muted text control for
  exactly this reason.

---

## 2. Three findings against the palette as specified

Issue #2 §1 specifies the palette. Measuring it produced three results that
differ from what the issue states. All three are resolved in code; none of them
changes the brand.

### 2.1 `--mx-brand-600` on `--mx-surface` measures 6.98:1, not 7.4:1

The issue's contrast budget states 7.4:1. The WCAG 2.x relative-luminance
formula gives **6.98:1** for `#A72740` on `#FFFFFF`.

This does not change anything substantive: the accompanying claim — "passes AA
body, AAA large" — holds at 6.98:1, comfortably above the 4.5:1 AA body
threshold. The figure in the issue is simply not what the pair computes to.

### 2.2 `--mx-warning` and `--mx-danger` fail AA as body text

| Token | Hex | On white | AA body (4.5:1) |
|---|---|---|---|
| `--mx-warning` | `#B5791C` | 3.67:1 | ✗ |
| `--mx-danger` | `#D64B2A` | 4.29:1 | ✗ |

Both pass the 3:1 non-text minimum (WCAG 2.2 §1.4.11), so they remain correct as
**fill, icon and border** colours — which is most of what a semantic colour does.

Body copy in those states uses a darker sibling:

| Token | Hex | On white |
|---|---|---|
| `--mx-warning-text` | `#8A5A0F` | 5.92:1 |
| `--mx-danger-text` | `#B83C1E` | 5.67:1 |

`--mx-success` (5.32:1) and `--mx-info` (6.12:1) already pass as text, so their
`-text` variants are aliases. Having the variant exist for all four keeps call
sites uniform rather than making authors remember which two are special.

### 2.3 `--mx-border-strong` fails the control-boundary minimum

The issue assigns `--mx-border-strong` (`#C7BCBF`) to "input borders, table
outlines". It measures **1.85:1** against white, against a 3:1 requirement for
the visual boundary of an interactive control.

Resolved by splitting the two uses:

- `--mx-border-strong` keeps its specified value for **card and table outlines**
  — decorative structure that carries no state.
- `--mx-border-input` (`#8C7E82`, 3.87:1 on white) carries **control
  boundaries**, and is what every input, select and textarea uses.

---

## 3. The contrast budget is a CI gate, not a guideline

Every colour pairing the system ships is declared in
[`packages/ui/src/tokens/contrast.ts`](../packages/ui/src/tokens/contrast.ts)
with the WCAG 2.2 minimum for **that use**:

| Use | Minimum | What it covers |
|---|---|---|
| `body` | 4.5:1 | Normal text (1.4.3) |
| `large` | 3:1 | ≥24px, or ≥18.66px bold |
| `ui` | 3:1 | Component boundaries, icons (1.4.11) |

38 pairings are measured on every CI run, in both themes. A pairing that is not
in the registry is not an approved pairing — adding a combination to the
registry is how a designer asks for it, and the gate is what answers.

Three exclusions are documented in the same file, each with its reason. The list
is short on purpose.

---

## 4. Dark theme

Light is defined on bare `:root`. Dark redefines **only the tokens that change**,
twice: once under `@media (prefers-color-scheme: dark)` guarded as
`:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]` so
an explicit toggle wins in both directions.

Brand actions move **up** the scale on dark, because `--mx-brand-600` measures
2.5:1 against the dark surface and fails outright:

| Role | Light | Dark |
|---|---|---|
| `--mx-action` | `--mx-brand-600` | `--mx-brand-400` (5.31:1) |
| `--mx-link` | `--mx-brand-600` | `--mx-brand-300` (8.15:1) |
| `--mx-action-fg` | `--mx-surface` | dark ground (5.74:1) |

Semantic colours brighten too — `#4FBF87`, `#E0A93F`, `#F2795A`, `#6FA8E8` — all
measured in the gate.

---

## 5. Type, space, elevation, motion

- **Type** — one humanist sans (Inter, with a real fallback stack). Optional
  serif display face for marketing headlines only. Scale 12 / 14 / 16 / 18 / 20 /
  24 / 30 / 36 / 48; body 16px at 1.55 line-height.
- **Space** — 4px base grid: 4, 8, 12, 16, 24, 32, 48, 64, 96.
- **Radius** — 6px controls, 10px cards, 16px sheets, full for pills.
- **Elevation** — three levels, warm-tinted (`rgba(48,10,17,…)`). No pure-black
  shadows against a warm palette.
- **Motion** — 150ms for state, 240ms for surfaces. `prefers-reduced-motion`
  collapses both to 1ms *in the token layer*, and every animated component also
  gates on `usePrefersReducedMotion`. Either alone would be enough; having both
  means a component that forgets still degrades safely.
- **Focus** — 2px `--mx-brand-600` ring with a 2px offset, on every focusable
  element, never removed.

---

## 6. Component sourcing and the re-theming rule

Base layer is shadcn/ui; blocks come from
[21st.dev/community/components](https://21st.dev/community/components) through
the shadcn registry:

```bash
npx shadcn@latest add "https://21st.dev/r/<author>/<component>?api_key=$API_KEY_21ST"
```

**Every block arrives carrying its author's palette.** Stripping it is the
easiest thing in the world to half-do, so `pnpm check:vendor-hex` greps
`packages/ui/src` and `apps/web/src` for hex, `rgb()`, `hsl()`, `oklch()` and
Tailwind vendor colour classes. Only `palette.ts` and the file it generates are
exempt. A literal colour anywhere else fails the build.

`API_KEY_21ST` was not available in this environment, so blocks were rebuilt to
the archetype rather than installed and diffed.
[`packages/ui/src/registry.ts`](../packages/ui/src/registry.ts) records all 36
blocks named in issue #2 §2 — the registry path, what each maps to here, and for
anything deferred, why. The messaging and scheduling picks are deferred because
their surfaces arrive in Phase 3; everything else in scope for Phases 0–1 is
implemented.

---

## 7. The signature components

These are Modex-specific and built rather than sourced. They encode product
rules, not visual patterns.

### `<VerificationBadge>`

Takes a **claim**, never a boolean. A claim carries who verified it, what was
checked and until when. The component recomputes the effective state on render,
so a claim that expired since it was written renders as `expired` rather than as
the stale `verified` sitting in the column.

There is no partial badge. `verified`, `pending`, `expired`, `unverified` and
`revoked` are the states; anything short of a full pass is not a verified badge.

### `<EligibilityExplanation>`

Renders pass / fail / **unknown** / **missing-data** rows, each with its source.
It never collapses to a boolean, and it never lets an absence read as a
rejection: a student who has not uploaded a transcript is unassessed, not
ineligible, and conflating the two is how a platform quietly steers people away
from programmes they would have got into.

Every row shows what was required, what the profile said, where the requirement
came from — so it can be contested — and for missing data, what to do about it.

### `<ProvenanceStamp>`

"Source updated · Verified · Expires" on every catalogue and offer record. Small,
permanent, and never behind a tooltip alone: a student deciding whether to trust
a tuition figure should not have to hover to learn it was last confirmed eight
months ago. Stale records render in `--mx-warning-text` with an icon.

### `<DisclosureNotice>`

Surfaces commercial relationships wherever ranking or recommendation is shown.
Modex exists because the agent model hides who is paying whom; a ranked list with
no disclosure is the same failure in a nicer interface. It is a landmark, never a
dismissible toast.

### `<SafetyBanner>` (Phase 3)

Permanent in every conversation surface. **There is no dismiss control and no
prop that adds one**: a warning that disappears after five seconds is designed
to be missed, and a warning a scammer can talk somebody into hiding is worse
than none. It is rendered by `ChatLayout` rather than by each page, so no
surface that shows a thread can omit it.

It is the one place brand colour carries a message rather than an action —
`--mx-brand-50` ground, `--mx-brand-700` left rule, `--mx-ink-800` text — and it
earns that by containing no primary action to compete with. Nothing has gone
wrong when it appears; it is the standing rule of the room, so it reads as
attention rather than alarm. Red would be a lie about what is happening, and
would also be the third red thing on a page that already has error states.

### `<RiskInterstitial>` (Phase 3)

What a flagged message looks like: a `--mx-warning` notice, the report action
inline, and **the message itself below it, unedited**.

Deleting it would be easier and worse. A student who sees "a message was
removed" learns nothing, cannot judge whether we were right, and will not
recognise the next attempt somewhere we are not watching. It is also the only
version that survives being wrong: a false positive over an innocent sentence
reads as a false positive, rather than as an invisible act of censorship.

### `<ExpiryCountdown>` (Phase 3)

A guide's verification clock, amber at 30 days and red at 7. Both thresholds are
imported from the contracts package — the same constants the reverification
sweep reads — so this component cannot say "plenty of time" while a job
restricts the account that evening. The number of days and what happens next are
in the text, never only in the colour.

---

## 8. Data visualisation

Brand-anchored categorical palette, not a rainbow:

```
--mx-viz-1  #A72740   (brand-600)
--mx-viz-2  #2563A8
--mx-viz-3  #1F7A4D
--mx-viz-4  #B5791C
--mx-viz-5  #6E4C8F
--mx-viz-6  #0F7C8A
```

Distinguishable in greyscale and under deuteranopia, with a brightened variant
for dark. Sequential ramps run `--mx-brand-50 → --mx-brand-800`. Never encode a
value by red intensity alone where the value could read as "bad".
