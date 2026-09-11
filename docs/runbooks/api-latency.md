# The API is slow

**Alert:** `api_latency` · **sev2** · `platform-oncall`

## Symptom

p95 request latency is over a second. The catalogue is what people notice
first, and the budget for search is 500 ms.

## First checks

```bash
# Which routes? Group http.server.duration by route in the metrics backend.

# Long-running queries right now:
psql "$DATABASE_URL" -c "
  select pid, now() - query_start as duration, left(query, 120) as query
  from pg_stat_activity
  where state = 'active' and now() - query_start > interval '2 seconds'
  order by duration desc;"

# Queue saturation pushes latency indirectly.
redis-cli -u "$REDIS_URL" info clients | head -5
```

## Fixing it

**Search specifically.** Run the performance budget locally against a copy of
production-sized data: `pnpm --filter @modex/api test:performance`. It prints
the percentiles per query shape, which usually names the culprit immediately.

**A query missing an index.** The most common cause after a schema change.
`EXPLAIN ANALYZE` the slow query from `pg_stat_activity`.

**N+1 on a list endpoint.** The application queue, the guide directory and the
catalogue are the three that have had this before. Look for a `findMany`
followed by a per-row lookup.

**Do nothing when:** latency rose with a load test or a bulk import and the
error rate is flat.

## If it is not that

If latency is high and the database is idle, the time is being spent in the
process — usually in a connector call made inline rather than queued. Those
belong on the queue.
