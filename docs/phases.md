# Phase 0 and Phase 1 — what is built, and what is not

Tracks issues [#2](https://github.com/Delviss/ModexApply/issues/2) and
[#3](https://github.com/Delviss/ModexApply/issues/3).

---

## Phase 0 acceptance criteria

| Criterion | State |
|---|---|
| `packages/ui` exports every component in §2, re-themed onto the tokens | **Partial** — every §2 pick in scope for Phases 0–1 is implemented and re-themed; the messaging (§2.5) and scheduling (§2.6) picks are deferred to Phase 3, recorded in `registry.ts` with the reason |
| Storybook with light + dark + keyboard states | **Not done** — see *Gaps* below |
| CI greps `packages/ui` for raw hex and fails on vendor colour | **Done** — `pnpm check:vendor-hex`, 42 files scanned, also covers `apps/web` |
| Automated contrast check fails on any AA violation | **Done** — `pnpm test:contrast`, 38 pairings across both themes |
| The four signature components render every state, including `expired` and `unverified` | **Done** — 20 tests in `packages/ui/test/signature.test.tsx` |
| Clone → `make dev` → working stack in under 15 minutes | **Done** — `make dev`; verified by hand against a real PostgreSQL |
| A protected endpoint rejects unauthenticated, under-privileged and cross-organisation requests, each covered by a test | **Done** — `apps/api/test/access-control.test.ts`, plus an end-to-end cross-organisation test against the database |
| Every sensitive auth action writes an immutable audit event; a test proves the table rejects update and delete | **Done** — `apps/api/test/integration/audit.test.ts`, against real PostgreSQL, as the table owner |
| CI blocks merge on lint, type, test, SAST, dependency and secret-scan failure | **Done** — `.github/workflows/ci.yml`; SAST is CodeQL |
| Deploy to staging and roll back with a migration, without data loss | **Not verifiable here** — the migration-safety gate that makes it possible is built; the deploy itself needs infrastructure |

## Phase 1 acceptance criteria

| Criterion | State |
|---|---|
| An institution cannot reach `verified` without a confirmed domain and a stored contract; a test proves the state machine rejects the shortcut | **Done** — 12 unit tests, plus an end-to-end test that the evidence is read from the database so a caller cannot assert it |
| Publishing requires an active partnership and an intake with a future deadline | **Done** — `canPublishProgram`, tested against the database |
| Editing a live programme creates a new effective-dated record; the prior version stays readable and snapshots are unaffected | **Done** — `supersede()`, timeline validation, and an integration test that reads the old version back after an edit |
| A sync failure past SLA flips records to `stale`, surfaces the warning on public pages, and alerts ops — verified end to end | **Done** — freshness sweeper, integration tests, and the public page states verified against a running stack |
| Revoking a partnership unpublishes programmes and suspends guides within one job cycle | **Partial** — programme unpublish is inline and transactional (it must not wait on a queue); the guide-roster suspension is enqueued, and the guide roster itself is Phase 3 |
| Every requirement has both a machine rule and a human summary; CI fails on a record missing either | **Done** — enforced at write time by `validateRequirement`; an unparseable rule is rejected, never stored |
| Institution and programme pages pass WCAG 2.2 AA and render in light and dark | **Partial** — the contrast budget is enforced in CI and both themes were checked by hand; no automated axe run in CI yet |

---

## Gaps, and why

### Storybook

Not set up. The acceptance criterion asks for per-branch Storybook with light,
dark and keyboard states.

What exists instead: 70 component tests covering state rendering including the
awkward ones (`expired`, `unverified`, `revoked`, `missing_data`), the contrast
budget enforced over both themes in CI, and the vendor-colour gate. Those cover
the *correctness* half of what Storybook is for. The review-surface half — a
designer opening a URL and looking at every state — is genuinely missing, and
should be the first thing added.

### 21st.dev blocks were rebuilt, not installed

`API_KEY_21ST` is not available in this environment, so the registry could not
be reached. Every block was built to the archetype the issue describes and
themed onto the tokens directly.

`packages/ui/src/registry.ts` records all 36 blocks from issue #2 §2 with their
registry paths, so installing the real sources later is a diff against a named
component rather than an archaeology exercise. The vendor-colour gate is what
will prove the re-theme was finished when that happens.

### Automated accessibility testing

The contrast budget is enforced. Keyboard operability is built (focus rings are
never removed, the wizard is arrow-key navigable, the dropzone is a real button,
the palette is a proper dialog) and covered by assertions on ARIA state. What is
missing is an axe run over the rendered pages in CI.

### The deploy path

`infra/` holds the Terraform skeleton and the migration-safety gate exists, but
no environment has been stood up, so blue/green and rollback are unproven.

---

## Two bugs found while testing, and one design gap closed

**Ambiguous dates in the bulk importer.** `Date.parse` accepts `01/08/2026`,
which is 1 August to the partner who typed it and 8 January to the runtime. On a
platform whose subject is application deadlines, a date silently off by seven
months is a missed intake. Dates are now ISO 8601 only, and an ambiguous format
is refused rather than guessed.

**A pulled programme answered with a 404.** When the freshness sweep took a
programme down for a stale tuition figure, the public page said "we could not
find that page" — telling a student the programme no longer exists, when the
truth is that we are re-confirming a number. Withdrawn and
temporarily-unavailable are now distinguished, and the latter says which fields
are being confirmed and that the programme has not been withdrawn.

**A one-minute window on a pulled price.** ISR caching meant a programme hidden
for a stale blocking field stayed servable at the edge with its old price for up
to 60 seconds. Pages carrying money now use a 15-second window
(`MONEY_REVALIDATE_SECONDS`), which is a documented trade-off rather than an
inherited default.

---

## Four design issues found by looking at the rendered pages

Worth recording, because none of them would have failed a test:

1. **Anchors were never styled**, so links fell back to browser blue and visited
   purple — outside the palette and outside the measured contrast budget. Fixed
   with a zero-specificity `:where()` rule scoped to unclassed anchors, after a
   first attempt turned every sidebar nav item crimson.
2. **Badges stretched vertically** to match a taller flex sibling, turning pills
   into ovals. `align-self: flex-start` on `.mx-badge`.
3. **"What was checked?" rendered in brand crimson**, competing with the apply
   action on the same page — against the Phase 1 rule reserving crimson for the
   primary action and the active nav item. Now a muted text control.
4. **"Modex Trust (Modex Trust)"** — the verifier qualifier was appended
   unconditionally.

---

## What the next phases need from this one

- **Phase 2 (#4)** — catalogue search and the eligibility engine. The
  `EligibilityExplanation` contract and component are built and tested; the
  engine that produces one is not.
- **Phase 3 (#5)** — guide network. The messaging and scheduling blocks are
  deferred here, and the consent model (`guide_access`) is already in place.
- **Phase 4 (#6)** — applications and connectors. Idempotency keys, the audit
  spine, effective-dated snapshots and the adapter boundary are all built for it.
