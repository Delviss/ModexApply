# Security

What is built, what is tested, and what still needs a human with a keyboard and
a contract.

## The controls

| Control | Where it lives | Proof |
|---|---|---|
| RBAC + organisation boundary + resource permission + consent | `packages/contracts/src/domain/access.ts`, checked server-side in every service | `test/access-control.test.ts`, `test/integration/security.test.ts` |
| MFA mandatory for every staff role | `MFA_MANDATORY_ROLES`, enforced in `AuthGuard` | `test/mfa.test.ts`, and a staff session cannot reach any route until the challenge clears |
| Step-up for console entry, evidence and sanctions | `StepUpGuard`, stamped on the session | `test/admin-rules.test.ts`, `test/integration/admin-consoles.test.ts` |
| Append-only audit | Database triggers plus revoked grants | `test/integration/audit.test.ts` — the table refuses UPDATE, DELETE and TRUNCATE even for the owner |
| Rate limiting | `RateLimitGuard` plus per-account budgets in `AuthService` | `test/rate-limit.test.ts` |
| Signed, short-lived object URLs | `StorageService`, TTL capped at 900s by the env schema | Documents never transit the API process |
| Fail-closed malware scanning | `DocumentsService`, both the connector path and the download path | `test/integration/security.test.ts` |
| Webhook signature + replay protection | `verifyWebhook` plus a unique constraint on `(connectorId, providerEventId)` | `test/integration/security.test.ts` |
| Secrets by reference only | `connector_configs` stores a *name*; `EnvSecretResolver` resolves it | `pnpm check:secrets`, and `redactAuditMetadata` before every audit write |
| Anti-scam engine | `packages/contracts/src/domain/trust.ts`, inline on the send path | Every TRD §23 fraud scenario in `test/integration/security.test.ts` |

## The test surface (TRD §23)

`apps/api/test/integration/security.test.ts` is written as attacks rather than
as features, because a test called "documents are owner-scoped" keeps passing
the day somebody adds an endpoint that forgets to scope.

- **IDOR** — another student's document, application, conversation; another
  institution's applications. Knowing the id is the premise, not the obstacle.
- **Auth bypass** — a token signed with another key; a correctly-signed token
  claiming `superadmin`; a revoked session; a suspended account; an expired
  token; an impersonation token after the grant closed.
- **Injection** — SQL metacharacters through the search path and stored as
  programme names.
- **Upload abuse** — path traversal in a display name, unscanned versions kept
  out of every downstream use, a quarantined version refused a download URL.
- **Webhook replay** — unsigned, forged, outside the tolerance window, and the
  same `providerEventId` twice.
- **Fraud** — payment solicitation, guarantee claims, impersonation,
  off-platform contact, and evasion by spacing and character substitution.

## Secure SDLC

Every gate below blocks merge (`.github/workflows/ci.yml`):

- Lint, typecheck, unit tests
- Secret scan over full history (`pnpm check:secrets`)
- Migration safety — destructive statements refused without a declared
  expand/contract (`pnpm check:migrations`)
- Dependency audit at `high`
- CodeQL (SAST)
- Integration tests against a real PostgreSQL
- Search latency budget (p95 < 500 ms)
- Contrast budget and vendor-colour gate
- Browser journeys with axe (WCAG 2.2 AA)
- Every alert has an owner and a runbook (`pnpm check:runbooks`)

**Not yet in CI, and named rather than implied:** DAST against staging. It
needs a staging environment, which needs the infrastructure decision in issue
#1 §7. The gate is written into the go/no-go checklist so it cannot be
forgotten rather than quietly skipped.

## Penetration test

Booked before pilot go-live, with no open high or critical findings as an
explicit go/no-go item.

**Scope, in priority order:**

1. The document vault — signed-URL handling, object-key predictability,
   scanner bypass, cross-tenant reads.
2. Authentication and session handling — token forgery, refresh rotation,
   step-up bypass, impersonation.
3. The four admin consoles — privilege escalation between roles and across the
   organisation boundary.
4. The connector layer — webhook forgery and replay, SSRF through partner
   endpoint configuration.
5. The anti-scam engine — evasion, and whether evasion is cheaper than the
   platform assumes.

**Out of scope:** denial of service against the shared infrastructure, and
social engineering of Modex staff, both by agreement rather than by oversight.

Findings are triaged into the same severity scale as
[incident response](./incident-response.md). A high or critical finding blocks
the pilot; a medium needs a dated plan before go-live.

## Reporting a vulnerability

Until a public policy exists, security reports go to the address in the
repository's `SECURITY.md`. A finding reported by a student or a partner is
treated as a sev2 until triaged, never as a support ticket.
