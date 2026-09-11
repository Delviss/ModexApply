# Go / no-go for the pilot

Signed by four parties: **engineering**, **trust**, **legal**, and the
**partner institution**. Every line is either done or it is not; there is no
"in progress" column, because a checklist with one is a checklist that ships
half-finished work.

Status below reflects what is true in this repository today. Items marked
**needs an environment** are built but unproven, and the thing they need is a
deployed staging environment — which needs the infrastructure decision in issue
#1 §7.

## Engineering

| # | Item | State |
|---|---|---|
| E1 | Lint, typecheck, unit and integration tests green in CI | Done |
| E2 | Every route behind RBAC + organisation boundary + consent, proven by test | Done |
| E3 | MFA enforced for every staff role, with a working enrolment path | Done |
| E4 | Step-up required for console entry, evidence viewing and sanctions | Done |
| E5 | Rate limits on authentication, uploads, search, reports and submissions | Done |
| E6 | Malware scanning fails closed on both the connector and download paths | Done |
| E7 | Webhook signatures verified; replays refused | Done |
| E8 | p95 catalogue search < 500 ms, enforced in CI | Done |
| E9 | Correlation id traceable from click to connector call | Done |
| E10 | Every alert has an owner and a runbook, enforced in CI | Done |
| E11 | Dashboards live for API golden signals, connectors, search freshness, scan failures, moderation depth | Needs an environment |
| E12 | Backup restore rehearsed; RTO and RPO measured | Needs an environment |
| E13 | Connector outage simulated end to end against a partner sandbox | Needs an environment |
| E14 | Blue/green deploy and rollback demonstrated with a migration | Needs an environment |
| E15 | DAST against staging for the critical surfaces | Needs an environment |

## Trust and safety

| # | Item | State |
|---|---|---|
| T1 | Every TRD §23 fraud scenario caught, evidenced by a test | Done |
| T2 | Evidence viewing audited; no delete path for any role | Done |
| T3 | Sanctions carry a reason code, an actor and a reversal path | Done |
| T4 | A suspended guide loses directory presence and messaging in one transaction | Done |
| T5 | Support impersonation is consented, time-boxed, visible to the student and audited | Done |
| T6 | Guide onboarding and safety materials published, with the out-of-scope topic list | Done — [docs/guide-safety.md](./guide-safety.md) |
| T7 | Trust rota staffed with an escalation path | Needs people |
| T8 | Live incident drill run start to finish, with a written postmortem | Needs an environment |

## Legal and privacy

| # | Item | State |
|---|---|---|
| L1 | Data map maintained in code and rendered to students | Done |
| L2 | Access, export and deletion demonstrated end to end on a real account | Done |
| L3 | Consent records queryable and revocable, per scope | Done |
| L4 | Per-country retention configured for the launch market | Configurable; **the market is undecided** |
| L5 | Cross-border transfer position documented for the chosen region | **Blocked on issue #1 §7, decision 3** |
| L6 | Recruitment regulation reviewed for the launch market | Needs counsel |
| L7 | Advice boundaries reviewed — what a guide may and may not say | Needs counsel; the operative list is in [docs/guide-safety.md](./guide-safety.md) |
| L8 | Commercial disclosure reviewed — how Modex is paid, said plainly | Needs counsel |
| L9 | Penetration test complete, no open high or critical findings | Not booked |

## Partner institution

| # | Item | State |
|---|---|---|
| P1 | Official domain verified; portal access opens only after | Done |
| P2 | Partner sandbox exercised by their own staff | Needs an environment |
| P3 | Connector contract tests green against their sandbox | Needs their sandbox |
| P4 | Their admissions team trained on the applications queue | Needs people |
| P5 | Agreed turnaround for confirming receipt of a submission | Needs agreement |
| P6 | Named contact for connector incidents | Needs agreement |

## The rule

**Any unchecked item in Trust or Legal is a no-go.** Engineering items marked
"needs an environment" are a no-go for the *pilot* but not for a staging
rollout — that is the distinction the pilot exists to close.

## Sign-off

| Party | Name | Date | Decision |
|---|---|---|---|
| Engineering | | | |
| Trust | | | |
| Legal | | | |
| Partner institution | | | |
