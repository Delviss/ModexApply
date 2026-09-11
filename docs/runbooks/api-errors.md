# The API is returning server errors

**Alert:** `api_error_rate` · **sev1** · `platform-oncall`

## Symptom

More than two percent of requests are failing with a 5xx. Students see the
error boundary: "something on our side failed".

## First checks

```bash
# Readiness on every instance — this is the fastest way to find a bad one.
curl -sS "$API_ORIGIN/v1/health/ready" | jq

# What is failing, and on which route?
# Group http.server.errors by route in the metrics backend, then read the
# structured logs for that route's correlation ids.
psql "$DATABASE_URL" -c "select 1;"   # database reachable at all?
redis-cli -u "$REDIS_URL" ping
```

## Fixing it

**Database unreachable.** Readiness returns 503 and the load balancer should
already be routing away. Check connection-pool exhaustion before assuming the
database is down: a slow query holding every connection looks identical from
here.

**One route failing, everything else fine.** A deploy. Compare against the
previous release and roll back — the migration-safety gate means the previous
version can run against the current schema.

**Errors following a migration.** Expand/contract was skipped somewhere. Roll
the *code* back, not the schema.

**Do nothing when:** the rate is over threshold on a handful of requests
overall. Check the denominator.

## If it is not that

Correlation ids tie a user-visible failure to its audit events and its
connector calls. Take one id from a reported failure and follow it end to end
before theorising.
