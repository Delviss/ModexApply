# A partner's catalogue is going stale in bulk

**Alert:** `catalogue_staleness` · **sev3** · `platform-oncall`

## Symptom

More than twenty records were marked stale in an hour. Stale records hide
themselves rather than show a wrong price, so the visible symptom is a partner
quietly disappearing from search.

## First checks

```bash
curl -s -H "authorization: Bearer $OPS_TOKEN" "$API_ORIGIN/v1/admin/ops/catalogue" \
  | jq '{stale, failingRuns, runs: [.runs[] | select(.status != "succeeded")]}'
```

## Fixing it

**Sync runs failing.** Their feed changed, moved, or started erroring. Read
`error` on the run. A schema change needs an adapter fix; a 404 needs the
partner.

**Sync succeeding but records ageing out.** The partner's own data has not been
updated inside the freshness SLA. This is the system working as designed — a
price nobody has confirmed for months should not be shown as current — but the
partner needs telling, because their programmes are invisible until they
refresh.

**Do nothing when:** the partner genuinely has taken a programme down. A stale
record for a withdrawn course is the right outcome.

## If it is not that

If staleness is spread across *every* partner at once, suspect the sweep rather
than the partners: a clock problem or a mis-set SLA will mark everything stale
in one pass. Check the freshness configuration before contacting anybody.
