# A lot of traffic is being refused by a budget

**Alert:** `rate_limit_refusals` · **sev3** · `security-oncall`

## Symptom

More than five hundred requests refused in fifteen minutes. This is either an
attack being handled correctly, or a budget set too low and real people locked
out of their own accounts.

## First checks

```bash
# Which budget, and how concentrated?
# (The counter carries the limit name; group by it in the metrics backend.)

# Are real sign-ins succeeding at the same time?
psql "$DATABASE_URL" -c "
  select action, count(*) from audit_events
  where timestamp > now() - interval '15 minutes'
    and action in ('user.login_succeeded','user.login_failed')
  group by 1;"
```

## Fixing it

**`auth.login` refusals with almost no successes.** Credential stuffing. The
budget is doing its job. Note the pattern, and consider an upstream block if it
is one network.

**`auth.mfa` refusals from one address with successful logins.** A shared
address — a university, an office, a conference. The address-keyed budget is
coarse by design and the per-account budget is the real control, so raise the
address budget rather than the account one.

**`document.upload` or `search.query` refusals.** Almost always a legitimate
heavy user or a misbehaving client retrying. Check whether one user id
dominates before changing anything.

**Do nothing when:** refusals are high but the corresponding success rate is
normal. Something automated is being refused and nobody is being harmed.

## If it is not that

If refusals appear for a budget nobody is hitting, suspect the proxy
configuration: `TRUSTED_PROXY_HOPS` set too low makes every request look like
it came from the load balancer, and one address then exhausts every
address-keyed budget for everybody.
