# Reports are arriving far faster than normal

**Alert:** `report_spike` · **sev2** · `trust-oncall`

## Symptom

Trust cases are opening several times faster than the weekly average. The trust
console's queue is growing while you watch it.

## First checks

```bash
curl -s -H "authorization: Bearer $TRUST_TOKEN" "$API_ORIGIN/v1/admin/trust/summary" | jq
curl -s -H "authorization: Bearer $TRUST_TOKEN" "$API_ORIGIN/v1/admin/trust/signals?days=1" | jq '.totals'
```

Two questions decide everything that follows: **is it one signal or many**, and
**is it one target or many**.

## Fixing it

**One target, many reporters.** A guide or an offer is being reported by
several students. Read the evidence, then sanction from the console with a
reason code — `suspend` takes the guide out of the directory and closes every
open conversation in the same transaction.

**One signal, many targets.** A rule has started catching legitimate
behaviour. Check what changed: a new message template, a campaign that tells
students to share a phone number, a partner asking for a deposit through the
platform. Do **not** mass-dismiss: dismissing is terminal and each case is a
person's report. Triage them, and fix the rule.

**Many signals, many targets, one time window.** Coordinated abuse. Escalate to
`security-oncall` and follow [incident response](../incident-response.md).

**Do nothing when:** the spike is one genuine incident reported by twenty
people. That is the system working; work the case.

## If it is not that

If reports name a Modex operator, treat it as a potential insider incident:
read the impersonation grants and the audit trail for that operator before
acting, and hand the case to somebody who is not them.
