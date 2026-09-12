# Privacy and data governance

The data map is in code: `packages/contracts/src/domain/privacy.ts`. This
document says why it lives there, and what the platform does with it.

## Why the map is code

A data map in a document is out of date the week after it is written. `DATA_MAP`
is the list the student-facing `/privacy` page renders, the list the erasure
plan is derived from, and the list an audit reads — so adding a table without
adding a category shows up as a gap in a page somebody looks at.

Each category carries: what it is in plain language, why it is collected, who
can reach it *in the student's terms*, how long it is kept, and what erasure
does to it.

## The three workflows

| Workflow | Endpoint | What it does |
|---|---|---|
| **Access** | `GET /v1/me/privacy` | Who has my data and why — rendered from the student's own rows, including every support visit by name, reason and ticket |
| **Export** | `POST /v1/me/privacy/export` | Everything they gave us as JSON. Files are named with their checksums, not inlined: a passport base64'd into a downloads folder is not a favour |
| **Erasure** | `POST /v1/me/privacy/erasure` | Deletes what it can, anonymises what it must keep, and says which is which **before** the student confirms |

All three are covered end to end in
`apps/api/test/integration/privacy.test.ts`, against a real account with real
documents, applications and consents.

## What erasure cannot do, and why we say so

A submitted application is a record the university holds too. A consent record
is the evidence we asked. The audit log is append-only by construction. An
erasure flow that implied otherwise would be promising something undeliverable,
so the confirmation dialog lists every retained category with its reason, and
the response repeats it.

What *is* destroyed: profile, academic records, language tests, saved searches,
shortlists, uploaded files (rows and objects), sign-in credentials, and every
session. The user row survives with its identity stripped, because
applications, payments and the audit trail all point at that id and a dangling
reference is worse for the student than a blank one.

## Identity separation

Identity data (`User`) is separated from application data (`Application`,
`ApplicationSnapshot`) by table and by access path: no student-facing
projection joins them, and the snapshot carries a copy of what was sent rather
than a live reference. Verification evidence lives in its own tables that no
public projection selects, and **reading it is itself an audited action**.

## Retention

Per-country, as configuration rather than code: `DOCUMENT_RETENTION_DAYS` takes
`GB:2555,NG:1825` with a `default:` entry. The launch market's rules differ and
the market is still open (issue #1 §7), so this is a setting rather than a
constant.

## Consent

Four scopes, each separate and each revocable: `guide_access`,
`document_share`, `university_submission`, and `support_access` (Phase 6). An
active session is never consent, and revoking a scope takes effect on the next
request — a support agent inside an account loses access the moment the student
withdraws it.

## Cross-border transfer

**Open.** The cloud region is undecided (issue #1 §7, decision 3), and the
transfer position depends on it. The go/no-go checklist carries this as a
blocking item rather than an assumption: the platform is built so the region is
a deployment choice, and nothing in the application code assumes one.

## Logs

`redactAuditMetadata` runs *before* every audit write, not after, so a secret
that slips into a call site never reaches storage. IP addresses are hashed.
Object keys carry a hashed owner segment, so a key in a log does not identify
whose file it is.
