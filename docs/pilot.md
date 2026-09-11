# Pilot readiness

What a partner university and Modex support need in place before real students
use this with real documents.

## Partner sandbox

The pilot institution exercises their own workspace on staging, with seeded
applications that look like theirs. Three things have to happen there and not
in a demo:

1. **Their admissions team works the applications queue** — including the
   awkward states: an application in `submitted_pending`, one that failed, one
   an operator submitted on a student's behalf.
2. **They give a reference back** and watch the application become `submitted`.
   This is the moment the product's central rule becomes visible to them: we do
   not call it submitted until they say so.
3. **They review a machine rule** from the eligibility engine and override it,
   and see the before/after values land in the audit trail.

## Connector contract tests

`apps/api/test/connector-contract.test.ts` runs against the adapter. Before
go-live it also runs against the partner's *live sandbox*, with their
credentials resolved from the secret store by name.

A partner whose sandbox differs from their production endpoint is a partner
whose contract test proves nothing; ask explicitly.

## Support runbooks

Operational alerts live in [`docs/runbooks/`](./runbooks/). These are the
*support* paths — what a person asks for help with, rather than what a
dashboard notices.

### "My application is stuck"

Look it up in `/admin/ops` → exceptions. The row names its remediation. If it
is not there, the application is progressing normally and the student needs the
state explained rather than a fix: `submitted_pending` means the university has
not confirmed receipt, and that is theirs to do.

### "The university says they never got it"

Pull the submission attempt and the snapshot. The snapshot reproduces the exact
payload and its hash verifies, so the question "what did you send" has an
answer that does not depend on anybody's memory. Send them the receipt
reference and the `idempotencyKey` — their duplicate guard will have seen it.

### "My document was rejected"

Check the scan state. `quarantined` means our scanner flagged it: the student
uploads a replacement, and we do not hand the original back — not even to them.
`failed` means the scanner could not decide, which is ours to fix
([scanner-degraded](./runbooks/scanner-degraded.md)), and they should be told it
is our problem, not their file.

### "A guide asked me for money"

Report it from the conversation. If the message tripped the engine the guide is
already suspended and a case is open; if it did not, open one manually and
attach the conversation. Either way the student sends no money, and Trust reads
the case the same day. See [guide safety](./guide-safety.md).

### "This offer isn't what the university's website says"

An offer mismatch is a trust incident, not a catalogue bug — `offer.mismatch_detected`
exists as its own audit action for exactly this. Unpublish the offer from the
trust console, then ask the partner which figure is correct. A student who was
shown the wrong net price is told directly.

### "I want my data deleted"

Point them at `/privacy`, which does it themselves, and shows what has to be
kept before they confirm. Do not run an erasure on somebody's behalf: the typed
confirmation is the record that they asked.

## Analytics validation

TRD §19 events must fire correctly and reconcile against the success metrics in
issue #1 before the pilot, not during it. The validation is: run a complete
student journey on staging, then reconstruct that journey from the analytics
stream alone. Anything the reconstruction cannot see is not instrumented,
whatever the code says.

## Go / no-go

[docs/go-live.md](./go-live.md). Four signatures, and any unchecked item in
Trust or Legal is a no-go.
