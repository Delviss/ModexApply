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

## What is deliberately not here

- Catalogue search and the eligibility engine — Phase 2 (#4). The contracts and
  the `<EligibilityExplanation>` component that render its output exist.
- Guide messaging and scheduling — Phase 3 (#5).
- The connector adapter implementations — Phase 4 (#6). The idempotency,
  snapshot and audit spine they need is built.
