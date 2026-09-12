# A partner connector is failing

**Alert:** `connector_dead_letters` · **sev1** · `platform-oncall`

## Symptom

Repeated errors against one partner's endpoint, and attempts reaching the
dead-letter state — automatic retries are exhausted.

## First checks

```bash
# The console's view, from the command line.
curl -s -H "authorization: Bearer $OPS_TOKEN" "$API_ORIGIN/v1/admin/ops/connectors" \
  | jq '.data[] | select(.health != "healthy")'

# Dead letters and what they said.
curl -s -H "authorization: Bearer $OPS_TOKEN" "$API_ORIGIN/v1/admin/ops/exceptions" | jq '.deadLettered'

# Is their endpoint up at all?
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' "$PARTNER_ENDPOINT"
```

## Fixing it

1. **Confirm it is them.** One failing partner while the others are healthy is
   their outage. All partners failing is ours — go to
   [api-errors](./api-errors.md).
2. **Disable the connector** from `/admin/ops` so new applications are not
   handed a route that cannot complete. This is audited and reversible.
3. **Tell the partner**, through the contact on their `InstitutionContact`
   record, not through whoever answers first.
4. **When they are back:** re-enable, then requeue the dead letters from the
   connector page. The idempotency key is derived from the snapshot, so a
   requeue cannot create a second application at their end.

**Do nothing when:** the connector is `idle` rather than `failing`. Idle means
nothing has been attempted, which is not the same as broken — check whether the
partner has any live intakes before chasing them.

## If it is not that

A partner whose endpoint has moved without telling us looks identical to an
outage. Check for a 301/302 or a TLS name mismatch before escalating; a
certificate that expired this morning is the single most common cause of this
alert.
