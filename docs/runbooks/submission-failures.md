# Submission failures

**Alert:** `submission_failures` · **sev1** · `platform-oncall`

## Symptom

More than one submission in ten is failing over fifteen minutes. On the
student's side an application sits in `failed` with "we could not send this
yet"; on ours, `submission_attempts` rows are landing with a `failureCode`.

## First checks

```bash
# Which partner, and what are they saying?
psql "$DATABASE_URL" -c "
  select c.\"displayName\", a.\"failureCode\", count(*)
  from submission_attempts a
  join applications app on app.id = a.\"applicationId\"
  left join connector_configs c on c.id = app.\"connectorId\"
  where a.\"startedAt\" > now() - interval '30 minutes'
  group by 1, 2 order by 3 desc;"

# Is it one partner or all of them?
curl -s -H "authorization: Bearer $OPS_TOKEN" "$API_ORIGIN/v1/admin/ops/connectors" | jq '.data[] | {institution, health, successRate, deadLettered}'
```

The operations console shows the same thing with less typing:
`/admin/ops` → Connector health.

## Fixing it

**One partner, `partner_unavailable` or timeouts.** Their end. Confirm with a
direct call to their endpoint, then disable the connector from the console so
students stop being given a submission path that cannot complete — an
application that never leaves `draft` is recoverable, one stuck in
`submitted_pending` needs a human. Tell the partner. Re-enable when they
confirm.

**One partner, `validation_rejected`.** Our payload no longer matches their
schema, usually because they changed it. Do **not** retry: the same payload
will be rejected the same way. Read the response body on the attempt row,
compare against the connector's contract test, and fix the adapter.

**Every partner at once.** Not the partners. Check the queue and the database
first — a saturated `connector-submission` queue or a failing database produces
exactly this shape. `/v1/health/ready` on each instance.

**Do nothing when:** the rate is above the threshold because volume is tiny
(two attempts, one failed). Check the denominator before acting.

## If it is not that

Escalate to the partner integration owner named on the connector's
`ConnectorConfig`. If students have been told an application was sent when it
was not, that is a trust incident as well as an availability one — page
`trust-oncall` too, and follow [incident response](../incident-response.md).

**Never** clear `submitted_pending` by hand to make the queue look better. The
state means "we have no receipt", and editing it destroys the only record that
we do not.
