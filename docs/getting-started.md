# Getting started

The Phase 0 acceptance criterion is that a new developer can clone, run one
command, and reach a working web + API + database + queue + storage stack in
under fifteen minutes.

```bash
git clone https://github.com/Delviss/ModexApply.git
cd ModexApply
make dev
```

`make dev` installs dependencies, starts PostgreSQL, Redis and MinIO, copies
`.env.example` to `.env` if you have no `.env`, applies migrations, seeds
fixtures, and runs the API and web app together.

| Service | URL |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:3001/v1 |
| OpenAPI | http://localhost:3001/v1/openapi |
| MinIO console | http://localhost:9001 |

## What the seed gives you

- **University of Example** — fully verified, active partnership, two campuses,
  two published programmes.
- **MSc Data Science** — complete provenance, three requirements each with both a
  machine rule and a human summary, tuition in integer minor units.
- **BSc Computer Science** — deliberately left *stale* on a warning-severity
  field, so the provenance warning state is visible without waiting a month for
  an SLA to lapse.
- **Northern Institute of Technology** — mid-onboarding, so the verification
  pipeline view has something part-way through to render.
- **Three student guides** — active, evidence expiring inside the warning
  window, and already restricted. The directory shows exactly one of them.
- **Four verified offers** — one the seeded student qualifies for, one they do
  not, one non-combinable, one a benefit with no cash value.
- **Accounts that can actually sign in**, including six staff accounts across
  the four admin consoles.

The seed walks the real verification pipeline rather than inserting a row with
`verificationState: 'verified'`. If the state machine gains a stage, the seed
breaks — which is a much cheaper signal than a staging environment full of
institutions that could never have been verified in production.

## Signing in

Every seeded account uses the same development password, and every staff
account shares one TOTP secret. Both are printed at the end of the seed, and
both are useless anywhere real — the secret is sealed with `MFA_SECRET_KEY`,
and no deployed environment shares the local development key.

```
password:     ModexDev!Passw0rd
TOTP secret:  JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
```

Generate a code with any authenticator, or from the command line:

```bash
oathtool --totp -b JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
```

| Account | Role | Where it lands |
|---|---|---|
| `ada@example.com` | student | `/dashboard`, `/privacy` |
| `admin@example.ac.uk` | university_admin | `/admin/university` |
| `admissions@example.ac.uk` | university_staff | `/admin/university` |
| `trust@modex.test` | trust_agent | `/admin/trust` |
| `ops@modex.test` | ops | `/admin/ops` |
| `finance1@modex.test`, `finance2@modex.test` | finance | `/admin/finance` |

**Staff accounts ask for the code twice**: once at sign-in (the second factor),
and again on entering a console (step-up). They are different controls — the
first proves who started the session, the second proves who is at the keyboard
now — and the second expires after fifteen minutes.

Two accounts in finance is not an accident. A high-value payout cannot be
approved by whoever started it, so seeing that rule work needs two people:
start the payout as `finance1`, watch the approve button refuse you, approve as
`finance2`.

## Trying the whole thing

A ten-minute pass that touches every phase:

1. **Search** as a signed-out visitor: `/programmes`. Note the stale record
   carrying a provenance warning rather than a wrong price.
2. **Sign in as Ada**, look at `/dashboard`, then `/privacy` — the second one
   lists what Modex holds and, once you have done step 6, who looked at it.
3. **Open a guide** from `/guides` and start a conversation. Try sending
   `pay me the deposit and your place is guaranteed` as the guide
   (`amara@example.ac.uk`) and watch the anti-scam engine suspend the account
   and open a case, with no human step.
4. **As `trust@modex.test`**, work `/admin/trust`: the case is there, the risk
   signal is counted, and opening verification evidence writes an audit event
   naming you.
5. **As `admin@example.ac.uk`**, open `/admin/university`: applications,
   funnel, guides, and a requirement you can override — the before and after
   values land in the audit trail.
6. **As `ops@modex.test`**, open `/admin/ops`: connector health, the exceptions
   queue with a remediation per row, and a support session into Ada's account
   (she granted `support_access` in the seed). Ada sees it on `/privacy`
   afterwards.
7. **As `finance1@modex.test`**, start the payout for the seeded completed
   session, then approve it as `finance2@modex.test`.

## The checks

```bash
pnpm verify                       # everything CI runs
pnpm test                         # unit tests
make test-integration             # integration tests against a real PostgreSQL
pnpm --filter @modex/web test:e2e # a real browser through every journey, with axe
```

`pnpm verify` runs lint, typecheck, unit tests, the contrast budget, the
vendor-colour gate, migration safety, the secret scan, the runbook gate and the
build. All of them block merge.

The integration tests need a real database, because what they check is enforced
by the database rather than by the application: the append-only audit triggers,
the revocation cascade, the effective-dated timeline under a real transaction,
and a security suite written as attacks rather than as features.

> **They also truncate.** `make test-integration` points at `modex_test`; if you
> run vitest by hand with a sourced `.env`, it will happily empty your
> development database and take the seed with it. Set `DATABASE_URL` explicitly:
>
> ```bash
> DATABASE_URL=postgresql://modex:modex@localhost:5432/modex_test \
>   pnpm --filter @modex/api test:integration
> ```

The browser journeys need the stack running (`make dev`) and a seeded database.
They walk every core journey and all four admin consoles, running axe against
WCAG 2.2 AA on each page, and fail on any serious or critical violation. Set
`E2E_SCREENSHOT_DIR` to keep a full-page screenshot of each.

## Environments

| Environment | Data |
|---|---|
| Local | Fixtures |
| Development | Synthetic only |
| Staging | Synthetic or masked; doubles as the partner sandbox |
| Production | Real data, strict access |

## Without Docker

If you have a PostgreSQL to hand, point `DATABASE_URL` at it and run the steps
individually:

```bash
pnpm install
pnpm --filter @modex/api prisma:generate
pnpm --filter @modex/api prisma:migrate
pnpm --filter @modex/api seed
pnpm dev
```

Redis and MinIO are only needed for the queue and document-upload paths; the
catalogue and institution surfaces work without them. Without Redis the rate
limiter falls back to an in-process counter and says so in the log — correct
per instance, and not a limit across several.

`MALWARE_SCANNER=none` is the fail-closed setting: with no scanner every
uploaded version stays `pending`, which means it cannot be attached to an
application *and* cannot be downloaded again. That is deliberate, and it is why
`make dev` starts ClamAV.
