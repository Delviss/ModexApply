# Authentication anomalies

**Alert:** `authentication_anomalies` · **sev2** · `security-oncall`

## Symptom

Either refresh-token reuse (fires on the first occurrence) or a burst of failed
sign-ins.

## First checks

```bash
# Token reuse: which family, whose account?
psql "$DATABASE_URL" -c "
  select \"actorId\", metadata, timestamp from audit_events
  where action = 'user.session_revoked'
    and metadata->>'reason' = 'refresh_token_reuse'
    and timestamp > now() - interval '1 hour'
  order by timestamp desc limit 20;"

# Failed sign-ins: one account, or many?
psql "$DATABASE_URL" -c "
  select \"objectId\", count(*) from audit_events
  where action = 'user.login_failed' and timestamp > now() - interval '30 minutes'
  group by 1 order by 2 desc limit 20;"
```

## Fixing it

**Token reuse.** The session family is already revoked automatically — that
happens at detection, not at triage. What is left is finding out how: check the
`ipHash` and `userAgent` on the family's sessions for two distinct clients.
Contact the account holder, and require a password change if two clients are
present.

**Failed sign-ins concentrated on one account.** Credential stuffing against a
person. The email-keyed budget is already refusing most of it; confirm the
account has MFA and tell the holder.

**Failed sign-ins spread across many accounts.** Spraying. Check the
address-keyed refusals (`ratelimit.refusals`) and whether the source is one
network. Consider a temporary block upstream — not in the application, where it
would need a deploy to remove.

**Do nothing when:** one person fails five times and then succeeds. That is a
typo, and it is the most common shape of this alert.

## If it is not that

A rise in `step_up_failed` from a *single staff account* is the one to take
seriously out of proportion to its volume: it is what a stolen laptop looks
like. Revoke that user's sessions and call them.
