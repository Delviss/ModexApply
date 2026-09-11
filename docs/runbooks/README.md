# Runbooks

One file per alert in [`infra/observability/alerts.yaml`](../../infra/observability/alerts.yaml),
and `pnpm check:runbooks` refuses an alert that has no file here — or a file
missing any of the four sections every runbook needs:

```
## Symptom            what the person paged actually sees
## First checks       the three or four commands, in order
## Fixing it          the remediation, including the "do nothing" case
## If it is not that  what to escalate, and to whom
```

Two rules that are easy to lose:

**Write for 3am.** Whoever reads this is tired, on a phone, and has not
thought about this subsystem in six weeks. Commands go in full, with the
environment variable already set. No "as discussed".

**Say when to do nothing.** Half of these alerts have a legitimate state that
looks identical to the failure — `submitted_pending` is a real state, a report
spike can be one genuine incident, a stale catalogue can be a partner who
really did take their site down. A runbook that only describes the fix teaches
people to apply it when they should not.

## The rota

| Rota | Covers |
|---|---|
| `platform-oncall` | API, connectors, queues, search, the vault |
| `trust-oncall` | Reports, risk signals, the moderation queue, sanctions |
| `security-oncall` | Authentication anomalies, rate limits, suspected compromise |
| `finance-oncall` | Payouts and refunds — business hours only |

Escalation and severity definitions are in
[`docs/incident-response.md`](../incident-response.md).
