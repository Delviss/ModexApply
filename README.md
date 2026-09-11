# Modex Apply

**Apply direct. Ask students. Save more.**

Modex Apply removes the education agent from the middle of international student
recruitment. Three jobs that are normally bundled into one commercial
relationship get separated:

| Job | Owner |
|---|---|
| Finding the right programme | Platform (rule-based, explainable matching) |
| Completing a correct application | Student, with an immutable submission record |
| Practical answers about life at the university | Verified current students ("Student Guides") |

See [issue #1](https://github.com/Delviss/ModexApply/issues/1) for the delivery epic.

## Repository layout

```
apps/
  api/           NestJS + Prisma — platform core, catalogue, search, vault,
                 eligibility, the guide network, the anti-scam pipeline,
                 applications, the university connector layer, offers, the four
                 admin consoles, rate limiting and the privacy workflows
  web/           Next.js — public pages, student workspace, guide directory,
                 messaging, the public Q&A, the application wizard, the
                 submission tracker, the price panel, the four admin consoles
                 and the "who has my data" view
packages/
  contracts/     Shared domain contracts (money, errors, access, provenance…)
  ui/            Red Velvet design system — tokens, blocks, signature components
  config/        Shared TypeScript and ESLint configuration
infra/           Terraform, and the alert definitions
scripts/         CI gates: contrast, vendor colour, migration safety, secrets,
                 and "every alert has a runbook"
docs/            Architecture, design system, phase notes, security, privacy,
                 incident response, runbooks and the go/no-go checklist
```

## Getting started

```bash
make dev        # docker services + api + web, from a clean clone
```

Full instructions, including the 15-minute cold-start path, are in
[docs/getting-started.md](docs/getting-started.md).

## The checks that matter

```bash
pnpm verify     # lint, typecheck, test, contrast, vendor colour, migrations,
                # secrets, runbooks, build
```

Three of those gates are unusual and deliberate:

- **`pnpm test:contrast`** measures every approved colour pairing against its
  WCAG 2.2 minimum. Colour combinations are declared in
  `packages/ui/src/tokens/contrast.ts`; anything not declared is not approved.
- **`pnpm check:vendor-hex`** greps the design system and the web app for literal
  colours. Every component sourced from 21st.dev arrives carrying its author's
  palette, and this is what proves the re-theme was finished rather than started.
- **`pnpm check:runbooks`** refuses an alert with no owner, no runbook, a
  runbook missing a section, or a metric nothing in the API records. An alert
  that can never fire is worse than no alert, because the dashboard looks
  covered.

Two more run in CI against a real stack:

- **`pnpm --filter @modex/api test:integration`** — the guarantees the
  *database* enforces: the append-only audit trail, the revocation cascade, the
  effective-dated timeline, and a security suite written as attacks rather than
  as features.
- **`pnpm --filter @modex/web test:e2e`** — a real Chromium through every core
  journey and all four admin consoles, with axe checking WCAG 2.2 AA on each
  page.

## Status

All seven phases of the epic. [docs/phases.md](docs/phases.md) covers 0–2 and
[docs/phases-6-7.md](docs/phases-6-7.md) covers the admin consoles and the
hardening phase — including, in each case, what is *not* proven and why.

The short version of what is not done: everything that needs a deployed
environment. Dashboards, backup-restore and connector-outage drills,
blue/green rollback and DAST are built for or scripted, and none has been run
against real infrastructure, because the cloud region is still an open decision
(issue #1 §7). The manual accessibility audit with an assistive-technology user
and the penetration test are booked as go/no-go items rather than implied as
done. See [docs/go-live.md](docs/go-live.md), which carries today's honest
status per line.

Phase 4 is the core of the product: an application goes out through a
university-approved route, and what was sent is frozen as a reproducible,
hash-verifiable snapshot. One rule shapes all of it —

> A submission is not successful because Modex generated a payload. It is
> successful only after the university confirms receipt and returns a durable
> reference.

— which is why there is a `submitted_pending` state, why it never renders the
word "Submitted", and why the only route to `submitted` runs through a
reference the university gave us.

Phase 5 does the same thing to money. An offer is a structured object with a
value in integer minor units, machine-readable conditions run through the *same*
rule engine as programme eligibility, and exclusions as rows rather than as
sentences in a terms page —

> Show the real price after a discount **only when the eligibility rules are
> satisfied.**

— which is why an offer a student has not been checked against shows the gross
price, why an offer that cannot be verified cannot be published, and why a
displayed net price traces line by line to an offer *version* and its source.

Phase 6 puts four consoles behind one permission model, and the rule that
shapes them is that an elevated moment is not the same as an elevated person —

> Step-up authentication is required for console entry, evidence viewing and
> sanctions.

— which is why elevation is stamped on the *session* and compared against a
clock, why viewing verification evidence writes an audit event before the rows
are returned, and why one actor cannot both start and approve a high-value
payout.

Phase 7 ships no features. It rate-limits the routes worth attacking, tests the
platform as an attacker would, and turns privacy into three workflows a student
can run themselves —

> Access, export and deletion workflows implemented and tested against lawful
> retention obligations.

— which is why the data map lives in code rather than in a document, why
erasure says what it cannot delete *before* the student confirms, and why the
one record it never removes is the log of every time somebody from Modex looked
at their account.
