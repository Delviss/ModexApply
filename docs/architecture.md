# Architecture

A modular monolith with async workers and an adapter layer for university
application connectors. Microservices only later, only where scale or isolation
proves necessary — the connector layer is an adapter boundary from day one.

## Layout

```
apps/api      NestJS + Prisma. Modules map to bounded contexts, not to tables.
apps/web      Next.js App Router. Public catalogue pages are SSR for SEO.
packages/contracts   Domain vocabulary shared by both. No framework imports.
packages/ui          Red Velvet design system.
packages/config      Shared TypeScript and ESLint configuration.
infra                Terraform.
```

`packages/contracts` is the interesting one. It holds money, the error envelope,
pagination, roles and permissions, verification claims, provenance, requirement
rules and eligibility explanations — as **types with behaviour**, not as DTOs.
The API and the web app therefore cannot disagree about what "verified" means or
about whether a lapsed claim still counts, because both call the same function.

## The seven principles, and where each one lives in code

| Principle | Where it is enforced |
|---|---|
| University is the source of truth | Every catalogue write requires a `sourceRef`; every read carries provenance out |
| Student owns the application | Consent scopes are separate, revocable grants (`ConsentGrant`) |
| Every submission reproducible from a snapshot | Effective-dated `Program` versions; `supersede()` never overwrites |
| Every trust claim has evidence, an owner and a validity period | `VerificationClaim`; `<VerificationBadge>` takes a claim, not a boolean |
| No payment recipient hides behind "processing" | `<DisclosureNotice>` is required wherever ranking is shown |
| Universities are adapters, not conditionals | Connector boundary; lint rule bans university-specific imports in core |
| A submission succeeds only on university confirmation | Phase 4 (#6); the idempotency and audit spine it needs is built |

## Authorization

Four checks, all server-side, none of them optional:

1. **RBAC** — `@RequirePermissions(...)`, enforced by a global guard.
2. **Organisation boundary** — enforced in the *service*, against the loaded row.
   A guard runs before the row is read and therefore cannot know which
   institution it belongs to; a check that runs first is a check you can bypass
   by asking for a different row.
3. **Resource permission** — the row's own rules, in the same place.
4. **Consent scope** — `@RequireConsent(...)`. An authenticated student has not
   thereby agreed to share documents with a university.

Guards are registered globally, so the default is *denied unless marked public*.
A route added without a decorator is a route nobody can reach, which is the
failure mode you want.

MFA gates the whole session for staff roles rather than individual endpoints, so
no endpoint has to remember to re-check.

## Audit

`AuditEvent` is append-only. Three layers, because each alone is escapable:

1. The application has no update or delete path — `AuditService` exposes none.
2. The migration installs `BEFORE UPDATE`, `BEFORE DELETE` and
   `BEFORE TRUNCATE` triggers that raise. TRUNCATE needs its own statement
   trigger; it bypasses row triggers entirely.
3. Each event chains to its predecessor by hash, so a removal at the storage
   layer is *detectable* even though nothing in the stack can perform one.

That third layer is tamper **evidence**, not tamper prevention. Saying which one
you have is the point of the control.

Metadata is redacted before the write, not after: a secret that slips into a call
site never reaches storage in the first place. Actor IPs are hashed.

## Money

Integer minor units plus an ISO 4217 code, everywhere. There is no float
constructor to reach for, and `fromMajorString` parses decimal *text* — what a
CSV import or a form field actually carries — without going through a binary
float. It refuses to round precision away rather than silently accepting
`10.005` as `10.01`.

An ESLint rule bans `parseFloat`/`Number` on anything named like money, and the
database has no decimal column for it.

## Freshness

Every catalogue record carries `sourceUpdatedAt`, `verifiedAt`, `expiresAt` and
`syncState`. A sweeper flips records past their SLA to `stale`, and the
field-severity model decides what that means:

- **Blocking** (tuition, application fee, deposit, deadlines, requirements) —
  the record is pulled from the public site. A wrong price is worse than an
  absent one.
- **Warning** (description, duration, campus name) — the record stays visible
  with a warning provenance stamp.

A programme pulled for staleness answers a bookmarked link with "temporarily
unavailable", not with a 404: it has not been withdrawn, and telling a student it
no longer exists would be false.

## Observability

OpenTelemetry-shaped, with the exporter behind a `MetricSink` seam so the vendor
choice stays out of the call sites (issue #1 §7 lists cloud region and provider
as still-open decisions). Golden signals per service; correlation IDs thread user
action → API request → background job → connector call.

## Search

A `SearchIndex` port with a PostgreSQL adapter behind it. The TRD names
OpenSearch; the port is what makes that a deployment decision rather than a
rewrite, and a shared contract-test suite says what any adapter has to do.

Two properties are enforced rather than intended:

- **The index cannot surface a hidden programme.** `visible` is computed from
  `publicVisibility` when the document is built, not at query time, so a query
  that forgets to filter still finds nothing. Reindexing is enqueued from every
  catalogue mutation *and* from both freshness sweep and confirmation — the two
  places visibility changes with no user request behind it.
- **Sponsorship cannot buy a rank.** It is a tie-break capped below the smallest
  substantive weight, applied after them, so it can only order rows already
  equal on merit. Eligibility is a different subsystem and ranking never sees
  it, which is what makes "sponsored placement can never bypass a hard rule"
  structural rather than a policy someone has to remember.

## Eligibility

A separate module from ranking, deliberately: "may I apply?" and "what should I
look at first?" are different questions, and fusing them is how a platform ends
up hiding programmes a student was eligible for.

The engine returns an explanation, never a boolean, and three invariants hold
across all nine rule evaluators: an unparseable rule is `unknown` and never a
pass, missing data is `missing_data` with a remedy naming the next action, and
nothing throws — one evaluator failing must not cost the student the other rows.
Grade conversion refuses rather than interpolating, because a conversion nobody
published is a judgement nobody can contest.

## The document vault

The order is the security property: the version row is written **before** the
upload, so an interrupted upload leaves a record rather than an orphan object;
the checksum is verified before the scan is queued, so the scanner sees the
bytes that were actually stored; and `isConnectorEligible` — the one predicate
naming the single state that passes — is enforced in the service method the
connector calls, not in a controller or the UI, because a connector goes through
neither.

Scanning is a port. The default with nothing configured is `NoScanner`, which
reports `pending` forever: an unconfigured deployment holds every document
rather than sending unscanned ones.

## The guide network

Three properties, each enforced where it cannot be forgotten.

**A guide is a link to current-student evidence.** `institutionId` is not
nullable, activation reads the verified evidence back from the database rather
than trusting a request body, and the evidence's expiry is mirrored onto the
guide so one indexed scan finds everyone the clock is about to act on. Changing
which university you study at is not a profile edit: it is recorded as an
identity change and drops the guide to `pending`, because the evidence proved
something about somewhere else.

**Expiry acts on its own.** `guideLifecycleDecision` is a pure function with
`now` injected; `ReverificationService` carries out its verdict and does nothing
else. Notify at 30 days, restrict at expiry, suspend 14 days later. No human
step, and the audit events prove it: every one carries `actorType: system`.

**The scan runs on the send path, and evidence is written before any action.**
`MessagingService.send` authorises, rate-limits, scans, then writes the message,
the flags and the trust case in one transaction — and only then, after the
commit, suspends. `message_flags` is append-only at the database (the same
trigger pattern as `audit_events`) and holds no foreign key to `messages` or
`trust_cases`, because evidence must outlive the row it is evidence of.

Rewards are the fourth property, and it is a negative one: `rewardStateForSession`
throws if handed an application status, and there is no column on a session or a
ledger entry that names an application to join against.

## What is deliberately not here

- A WebSocket gateway for messaging. The API is the same either way; the web
  client polls the thread. See the Phase 3 notes in `docs/phases.md`.
- The connector adapter implementations — Phase 4 (#6). The idempotency,
  snapshot and audit spine they need is built, and
  `DocumentsService.resolveForConnector` is the boundary they must call.
- A scheduler. The freshness sweep and the document-expiry reminders both need
  one; the queues and workers exist, nothing fires them periodically yet.
