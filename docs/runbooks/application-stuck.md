# Applications stuck awaiting a reference

**Alert:** `submission_stuck_pending` · **sev2** · `platform-oncall`

## Symptom

Applications have been in `submitted_pending` for over an hour. The student
sees "sent, waiting for the university to confirm" and no receipt.

## First checks

```bash
curl -s -H "authorization: Bearer $OPS_TOKEN" "$API_ORIGIN/v1/admin/ops/exceptions" | jq '.stuckPending'
```

Each row says whether a reference arrived. That is the fork in this runbook.

## Fixing it

**No reference at all.** The partner never confirmed receipt. Check connector
health ([connector-down](./connector-down.md)); if the connector is healthy,
re-run the status poll for the affected applications. If the partner confirms
receipt out of band — an email, a phone call — record their reference against
the application through the ops console so the state machine can advance
legitimately.

**Reference present, state never advanced.** The inbound event was received and
not applied. Look at `application_status_events` for that application:
`skippedReason` says why. An out-of-order event is normal and harmless; a
mapping we do not recognise is a code fix.

**Do nothing when:** the partner's stated turnaround is longer than an hour and
their applications always look like this. Raise the threshold for that
connector rather than treating their normal behaviour as an incident every day.

## If it is not that

If the same application has been stuck across several deploys, check whether
its snapshot still verifies (`verifySnapshot`). A snapshot that no longer
reproduces is a data-integrity incident, not an availability one.

**Never** move an application to `submitted` by hand. The only route to that
state is a reference the university gave us, and that rule is the product.
