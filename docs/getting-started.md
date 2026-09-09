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

The seed walks the real verification pipeline rather than inserting a row with
`verificationState: 'verified'`. If the state machine gains a stage, the seed
breaks — which is a much cheaper signal than a staging environment full of
institutions that could never have been verified in production.

## The checks

```bash
pnpm verify              # everything CI runs
pnpm test                # unit tests
make test-integration    # integration tests against a real PostgreSQL
```

`pnpm verify` runs lint, typecheck, unit tests, the contrast budget, the
vendor-colour gate, migration safety and the secret scan. All of them block
merge.

The integration tests need a real database, because what they check is enforced
by the database rather than by the application: the append-only audit triggers,
the revocation cascade, and the effective-dated timeline under a real
transaction.

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
catalogue and institution surfaces work without them.
