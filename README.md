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
                 applications, the university connector layer and offers
  web/           Next.js — public pages, catalogue admin, student workspace,
                 guide directory, messaging, the public Q&A, the application
                 wizard, the submission tracker, the price panel and savings
packages/
  contracts/     Shared domain contracts (money, errors, access, provenance…)
  ui/            Red Velvet design system — tokens, blocks, signature components
  config/        Shared TypeScript and ESLint configuration
infra/           Terraform
scripts/         CI gates: contrast, vendor colour, migration safety, secrets
docs/            Architecture, design system, phase notes
```

## Getting started

```bash
make dev        # docker services + api + web, from a clean clone
```

Full instructions, including the 15-minute cold-start path, are in
[docs/getting-started.md](docs/getting-started.md).

## The checks that matter

```bash
pnpm verify     # lint, typecheck, test, contrast, vendor colour, migrations, secrets
```

Two of those gates are unusual and deliberate:

- **`pnpm test:contrast`** measures every approved colour pairing against its
  WCAG 2.2 minimum. Colour combinations are declared in
  `packages/ui/src/tokens/contrast.ts`; anything not declared is not approved.
- **`pnpm check:vendor-hex`** greps the design system and the web app for literal
  colours. Every component sourced from 21st.dev arrives carrying its author's
  palette, and this is what proves the re-theme was finished rather than started.

## Status

Phases 0 to 5 of the epic. See [docs/phases.md](docs/phases.md) for what is
built, what is deliberately deferred, and why.

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
