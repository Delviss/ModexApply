# The malware scanner cannot reach a verdict

**Alert:** `document_scan_failures` · **sev2** · `platform-oncall`

## Symptom

Document scans are returning `failed`. Every affected upload stays unusable —
the vault fails closed — so students see files that never become attachable and
applications that will not become ready.

## First checks

```bash
# Is clamd alive and did its signatures load?
nc -z "$CLAMAV_HOST" "$CLAMAV_PORT" && echo reachable || echo unreachable
docker compose logs --tail 50 clamav | tail -30

# How many documents are affected?
psql "$DATABASE_URL" -c "
  select \"scanState\", count(*) from document_versions
  where \"createdAt\" > now() - interval '2 hours' group by 1;"
```

## Fixing it

**Scanner unreachable.** Restart it. A first start downloads signature
databases and takes several minutes; the healthcheck is what to watch, not the
process being up.

**Scanner up, verdicts failing.** Usually a signature database that failed to
refresh, or a file larger than the configured stream limit. The scan detail on
the version row says which.

**After it is healthy:** re-run scans for everything left in `failed`. Scanning
is idempotent — a replayed job writes the same verdict.

**Do nothing when:** the failures are a handful of oversized files rather than
every scan. That is a limit working, and the student needs a better error, not
an incident.

## If it is not that

Never "unblock" documents by moving them to `clean` without a scan. The state
machine is the only thing standing between an infected file and a partner's
inbox, and a manual override there is the one change that cannot be undone
after the file has been sent.
