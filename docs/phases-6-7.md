# Phases 6 and 7 — what was built, and what is not proven

Tracks issues [#8](https://github.com/Delviss/ModexApply/issues/8) and
[#9](https://github.com/Delviss/ModexApply/issues/9).

Phases 0–5 are in [phases.md](./phases.md).

---

## Phase 6 acceptance criteria

| Criterion | State |
|---|---|
| University staff see and act on **only** their own organisation's data; a cross-organisation request is rejected and audited, covered by a test | **Done** — `scope()` refuses an explicit mismatched id rather than silently re-scoping, and writes the refusal to the audit log |
| Portal access impossible without a verified official domain | **Done** — re-checked on every call, not at sign-in, so a revocation takes effect on the next request |
| A requirement override writes an audit event with actor, reason and before/after values | **Done** — plus a `requirement_reviews` row that the database refuses to update or delete |
| Every trust-console action — **including viewing evidence** — writes an immutable audit event; a test proves no delete path | **Done** — the audit write happens *before* the rows are returned, so an unlogged look is impossible |
| Step-up authentication for console entry, evidence viewing and sanctions | **Done** — stamped on the session, compared against a clock, refused with `step_up_required` so the client shows an interstitial rather than signing the operator out |
| Support impersonation time-boxed, expiring, visible to the student, reconstructable from the audit log | **Done** — and consented: a `support_access` scope checked against the subject's own grants |
| A high-value payout cannot be approved by its initiator — enforced server-side and tested | **Done** — by actor identity, with the reason rendered on the disabled button |
| Connector health reflects a simulated partner outage; the exceptions queue surfaces every affected application | **Done** — integration-tested with a dead-lettered attempt |
| A guide suspended from the trust console immediately loses messaging and directory presence | **Done** — one transaction, including the system message into every open conversation |
| All four consoles pass WCAG 2.2 AA and are keyboard operable in both themes | **Partial** — axe (WCAG 2.2 AA) runs over all four in a real browser and is clean; the dark-theme sweep and the manual keyboard pass are still by hand |

### What Phase 6 found

**Staff could not sign in at all.** Phase 0 issued staff sessions with
`mfaSatisfied: false` and a comment saying "the challenge upgrades it" — and
nothing ever did. There was no MFA challenge route and no page to enter a code
on, so every role that administers the platform was locked out of it. TOTP
enrolment and challenge are in this phase because Phase 6 could not exist
without them.

**Console pages handed render functions to client components.** React refuses,
and the result was an error boundary *after* a successful step-up, which is the
most confusing possible place for it. The fetch stays on the server; the view
is a client component taking plain JSON.

**`next build` failed whenever `.env` had been sourced** — `NODE_ENV=development`
leaking into the build produced "`<Html>` should not be imported outside
pages/_document", which names nothing that is actually wrong.

---

## Phase 7 acceptance criteria

| Criterion | State |
|---|---|
| Penetration test complete with no open high or critical findings | **Not booked** — scope is written in [security.md](./security.md); it needs a vendor and a contract |
| Every fraud scenario in TRD §23 caught by the anti-scam engine, evidenced by a test | **Done** — including evasion by spacing and character substitution |
| WCAG 2.2 AA verified by automated tooling **and** a manual assistive-technology audit | **Partial** — automated is done and green across seventeen pages; the manual audit with an AT user is not something code can do |
| p95 search < 500 ms under load, enforced by a CI performance budget | **Done** — 2,000-programme corpus, in CI since Phase 2 |
| Backup restore and connector-outage drills, with measured RTO/RPO | **Not done** — needs a deployed environment; the drills are scripted in [incident-response.md](./incident-response.md) |
| Every alert has an owner and a runbook | **Done, and enforced** — `pnpm check:runbooks` fails CI on an alert with no runbook, a runbook missing a section, or a metric nothing records |
| Data access, export and deletion demonstrated end to end on a real test account | **Done** — eight integration tests against a real account with documents, applications and consents |
| A live incident drill start to finish, with a written postmortem | **Not done** — needs an environment and people |
| Go/no-go checklist signed by all four parties | **Template ready** — [go-live.md](./go-live.md), with today's honest status per line |

### What Phase 7 found

**Rate limiting did not exist.** The issue asks for a rate-limit *bypass* test
surface and there was nothing to bypass. Three decisions in what replaced it:
sign-in is keyed on the email rather than the address, `trust proxy` is a hop
count rather than `true`, and the six-digit-code budgets come in two halves
because the guard runs before authentication and cannot tell two signed-in
users apart.

**A quarantined document could still be downloaded.** The connector path failed
closed; the download path did not. The platform would have handed a student
back the malware its own scanner caught, and — by handing it over normally —
told them nothing was wrong with it.

**The destructive button was 4.29:1.** The contrast registry declared that
pairing as *large* text, which a 14px button label is not, so the gate passed
while the rendered button failed. The registry now measures what is rendered.

**A data table rendered a sort button with no accessible name** for columns with
no header — announced as "button" and nothing else.

---

## Gaps, and why

### Everything that needs an environment

Dashboards, backup-restore drills, connector-outage drills against a partner
sandbox, blue/green rollback, and DAST are all built-for or scripted, and none
is proven. They need a deployed staging environment, which needs the cloud
region decision (issue #1 §7, decision 3) — the same decision the cross-border
transfer position waits on.

This is recorded as a blocking line in the go/no-go checklist rather than as a
footnote, because the temptation at pilot time is to treat "we wrote the
runbook" as "we ran the drill".

### The manual accessibility audit

Automated coverage is real: seventeen pages, every core journey and all four
consoles, checked against WCAG 2.2 AA in a real browser on every run. What
automation cannot tell you is whether the trust queue is *usable* with a screen
reader — whether the table announcements make sense in sequence, whether the
step-up interstitial traps focus in the way it should. That needs an assistive
technology user, and it is booked as a go/no-go item.

### Storybook

Still not set up, carried over from Phase 0. The correctness half is covered by
149 component tests and the contrast budget; the review surface — a designer
opening a URL and seeing every state — is still missing.

### The dark-theme sweep

The tokens are defined for both themes and the contrast budget measures both.
Nobody has looked at all four consoles in dark mode with fresh eyes, which is
what the design spec asks for.
