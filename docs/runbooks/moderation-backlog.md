# The moderation queue is backing up

**Alert:** `moderation_queue_backlog` · **sev3** · `trust-oncall`

## Symptom

More than fifty items have been waiting in the trust queue for four hours.
Every item is somebody waiting: a guide who cannot start, an offer a student
cannot see, a report nobody has read.

## First checks

```bash
curl -s -H "authorization: Bearer $TRUST_TOKEN" "$API_ORIGIN/v1/admin/trust/queue" \
  | jq '{institutions: (.institutions|length), guides: (.guides|length), offers: (.offers|length)}'

# What is breaching its SLA, oldest first?
curl -s -H "authorization: Bearer $TRUST_TOKEN" "$API_ORIGIN/v1/admin/trust/queue" \
  | jq '[.institutions[], .guides[], .offers[]] | map(select(.breachingSla)) | sort_by(-.ageHours)'
```

## Fixing it

Work the SLA breaches first — the console sorts by waiting time rather than by
creation, which is the same order.

**If one category dominates,** the cause is usually upstream: a recruitment push
that brought in fifty guides at once, or a partner publishing their whole offer
catalogue. Staff to it; do not lower the bar.

**If it is a steady rise across all three,** the team is under-resourced for the
volume. That is a capacity conversation, not an incident — but say so
explicitly rather than letting the queue absorb it.

**Do nothing when:** the depth is high but ageing is low. A busy queue being
cleared quickly is not a backlog.

## If it is not that

Never clear the queue by bulk-approving. Verification is the product; a guide
approved without evidence is exactly the failure the platform exists to
prevent, and the audit trail will show who did it.
