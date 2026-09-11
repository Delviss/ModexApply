# Incident response

Severity, ownership, containment and what has to be told to whom. Written
before it is needed, because the middle of an incident is the worst possible
time to decide who is allowed to disable a partner connector.

## Severity

| Severity | Meaning | Response | Examples |
|---|---|---|---|
| **sev1** | Students or partners cannot do the thing the platform is for, or personal data may be exposed | Page immediately, 24/7 | Submissions failing, API down, suspected data breach, a document reachable by the wrong person |
| **sev2** | A path is degraded, or a safety control is not running | Page during hours, ticket overnight | Scanner down (vault fails closed), report spike, authentication anomalies, one partner's connector down |
| **sev3** | Needs a human today, not now | Ticket | Moderation backlog, stale catalogue, search lag |

Anything involving **personal data leaving the people entitled to see it** is
sev1 regardless of volume. One document reaching one wrong student is a sev1.

## Who owns what

| Rota | Owns |
|---|---|
| `platform-oncall` | API, connectors, queues, search, the document vault |
| `trust-oncall` | Reports, risk signals, moderation, sanctions |
| `security-oncall` | Authentication anomalies, rate limits, suspected compromise |
| `finance-oncall` | Payouts and refunds. Business hours |

The first responder owns the incident until they hand it over explicitly. "I
assumed somebody else had it" is the failure mode this sentence exists to
prevent.

## Containment playbook

1. **Stop the bleeding before diagnosing.** Disable the connector, revoke the
   session family, suspend the guide. Every one of those is reversible and
   audited; a diagnosis while the harm continues is not.
2. **Preserve evidence.** Do not delete rows, do not edit states by hand, do
   not clear queues to make dashboards look better. The audit log is
   append-only and `message_flags` cannot be truncated — keep it that way.
3. **Record the correlation id** of the first affected request. It ties a user
   report to audit events to connector calls, and it is the single most useful
   thing to have written down an hour later.
4. **Name the incident channel** and put the sev in its title.
5. **Only then** diagnose, using the runbook for whichever alert fired.

## Notification obligations

| Who | When | By whom |
|---|---|---|
| Affected students | Personal data exposure: without undue delay, and in plain language naming what was exposed | Trust, with legal review |
| Supervisory authority | Personal data breach: within 72 hours of becoming aware, per the launch market's regime | Legal |
| Partner institution | Anything affecting their applicants or their data | Partnerships, not engineering |
| Payment processor | Suspected fraud against Modex service payments | Finance |

The launch market determines the exact regime, and the cross-border position is
still open (issue #1 §7, decision 3). **The 72-hour clock starts at
awareness, not at confirmation** — that distinction is what turns a well-handled
incident into a reportable failure.

## Postmortem template

Within five working days, blameless, and published internally in full.

```markdown
# <date> — <one line, what the user experienced>

**Severity:** sevN   **Duration:** HH:MM   **Owner:** <name>

## What people experienced
Not "the API returned 500s". What a student or a partner could not do.

## Timeline
Times in UTC, from the first signal — not from when we noticed.

## What actually happened
The mechanism. Plainly enough that somebody who has never seen this subsystem
can follow it.

## Why it was not caught sooner
The gap in monitoring, tests or review. This section is the point of the
document.

## What we are changing
Each item with an owner and a date. "Be more careful" is not an item.

## What we are not changing, and why
The tempting fix that would make things worse.
```

## Drills

At least one live incident drill before pilot go-live, and quarterly after.

A drill is not a tabletop. It uses the real alerting path, the real runbook and
the real staging environment, and it measures three things: **time to
acknowledge**, **time to contain**, and **whether the runbook was enough**.

The drill scenarios to run first, because each exercises a different control:

1. **Partner connector outage.** Simulated by disabling the partner's staging
   endpoint. Exercises [connector-down](./runbooks/connector-down.md) and the
   exceptions queue.
2. **Backup restore.** Restore the previous night's snapshot into a scratch
   environment and measure RTO and RPO against the 99.9% target. The measured
   figures go in `docs/go-live.md`, not in somebody's memory.
3. **Fake guide demanding payment.** A scripted conversation on staging that
   should trip the anti-scam engine, open a case and suspend the guide with no
   human step. Exercises trust's side end to end.
4. **Stolen staff laptop.** Revoke a staff session family, confirm step-up
   refuses, confirm the audit trail reconstructs what they did.

Each drill produces a postmortem in the same template. A drill with no written
outcome did not happen.
