# The search index is behind the catalogue

**Alert:** `search_index_lag` · **sev3** · `platform-oncall`

## Symptom

p95 lag between a catalogue write and the index reflecting it is over five
minutes. Students see a programme that has changed, or miss one that just
opened.

## First checks

```bash
# Is the indexer queue backed up?
redis-cli -u "$REDIS_URL" llen "bull:search-index:wait"

# How stale is the index against the source of truth?
psql "$DATABASE_URL" -c "
  select count(*) from programs p
  left join program_search_documents d on d.\"programKey\" = p.\"programKey\"
  where p.status = 'published' and (d.\"programKey\" is null or d.\"updatedAt\" < p.\"updatedAt\");"
```

## Fixing it

**Queue backed up.** Check the worker process is running and consuming. The API
registers the same handlers, so a single-process deployment should never be
idle-with-a-backlog; a split deployment can be.

**Queue empty but documents stale.** Jobs are being dropped or failing. Read
the dead-letter queue. A full reindex is safe and idempotent:

```bash
pnpm --filter @modex/api reindex
```

**Do nothing when:** the lag spike coincides with a bulk import. A partner
importing two thousand programmes produces exactly this, and it clears itself.

## If it is not that

If the index is *ahead* of the catalogue — showing programmes that no longer
exist — that is the more damaging direction, because the student clicks through
to a page that is gone. Reindex immediately rather than waiting for the queue.
