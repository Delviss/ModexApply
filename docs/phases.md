# Phases 0–2 — what is built, and what is not

Tracks issues [#2](https://github.com/Delviss/ModexApply/issues/2),
[#3](https://github.com/Delviss/ModexApply/issues/3) and
[#4](https://github.com/Delviss/ModexApply/issues/4).

---

## Phase 0 acceptance criteria

| Criterion | State |
|---|---|
| `packages/ui` exports every component in §2, re-themed onto the tokens | **Partial** — every §2 pick in scope for Phases 0–1 is implemented and re-themed; the messaging (§2.5) and scheduling (§2.6) picks are deferred to Phase 3, recorded in `registry.ts` with the reason |
| Storybook with light + dark + keyboard states | **Not done** — see *Gaps* below |
| CI greps `packages/ui` for raw hex and fails on vendor colour | **Done** — `pnpm check:vendor-hex`, 42 files scanned, also covers `apps/web` |
| Automated contrast check fails on any AA violation | **Done** — `pnpm test:contrast`, 38 pairings across both themes |
| The four signature components render every state, including `expired` and `unverified` | **Done** — 20 tests in `packages/ui/test/signature.test.tsx` |
| Clone → `make dev` → working stack in under 15 minutes | **Done** — `make dev`; verified by hand against a real PostgreSQL |
| A protected endpoint rejects unauthenticated, under-privileged and cross-organisation requests, each covered by a test | **Done** — `apps/api/test/access-control.test.ts`, plus an end-to-end cross-organisation test against the database |
| Every sensitive auth action writes an immutable audit event; a test proves the table rejects update and delete | **Done** — `apps/api/test/integration/audit.test.ts`, against real PostgreSQL, as the table owner |
| CI blocks merge on lint, type, test, SAST, dependency and secret-scan failure | **Done** — `.github/workflows/ci.yml`; SAST is CodeQL |
| Deploy to staging and roll back with a migration, without data loss | **Not verifiable here** — the migration-safety gate that makes it possible is built; the deploy itself needs infrastructure |

## Phase 1 acceptance criteria

| Criterion | State |
|---|---|
| An institution cannot reach `verified` without a confirmed domain and a stored contract; a test proves the state machine rejects the shortcut | **Done** — 12 unit tests, plus an end-to-end test that the evidence is read from the database so a caller cannot assert it |
| Publishing requires an active partnership and an intake with a future deadline | **Done** — `canPublishProgram`, tested against the database |
| Editing a live programme creates a new effective-dated record; the prior version stays readable and snapshots are unaffected | **Done** — `supersede()`, timeline validation, and an integration test that reads the old version back after an edit |
| A sync failure past SLA flips records to `stale`, surfaces the warning on public pages, and alerts ops — verified end to end | **Done** — freshness sweeper, integration tests, and the public page states verified against a running stack |
| Revoking a partnership unpublishes programmes and suspends guides within one job cycle | **Partial** — programme unpublish is inline and transactional (it must not wait on a queue); the guide-roster suspension is enqueued, and the guide roster itself is Phase 3 |
| Every requirement has both a machine rule and a human summary; CI fails on a record missing either | **Done** — enforced at write time by `validateRequirement`; an unparseable rule is rejected, never stored |
| Institution and programme pages pass WCAG 2.2 AA and render in light and dark | **Partial** — the contrast budget is enforced in CI and both themes were checked by hand; no automated axe run in CI yet |

---

## Gaps, and why

### Storybook

Not set up. The acceptance criterion asks for per-branch Storybook with light,
dark and keyboard states.

What exists instead: 70 component tests covering state rendering including the
awkward ones (`expired`, `unverified`, `revoked`, `missing_data`), the contrast
budget enforced over both themes in CI, and the vendor-colour gate. Those cover
the *correctness* half of what Storybook is for. The review-surface half — a
designer opening a URL and looking at every state — is genuinely missing, and
should be the first thing added.

### 21st.dev blocks were rebuilt, not installed

`API_KEY_21ST` is not available in this environment, so the registry could not
be reached. Every block was built to the archetype the issue describes and
themed onto the tokens directly.

`packages/ui/src/registry.ts` records all 36 blocks from issue #2 §2 with their
registry paths, so installing the real sources later is a diff against a named
component rather than an archaeology exercise. The vendor-colour gate is what
will prove the re-theme was finished when that happens.

### Automated accessibility testing

The contrast budget is enforced. Keyboard operability is built (focus rings are
never removed, the wizard is arrow-key navigable, the dropzone is a real button,
the palette is a proper dialog) and covered by assertions on ARIA state. What is
missing is an axe run over the rendered pages in CI.

### The deploy path

`infra/` holds the Terraform skeleton and the migration-safety gate exists, but
no environment has been stood up, so blue/green and rollback are unproven.

---

## Bugs found while testing

**Ambiguous dates in the bulk importer.** `Date.parse` accepts `01/08/2026`,
which is 1 August to the partner who typed it and 8 January to the runtime. On a
platform whose subject is application deadlines, a date silently off by seven
months is a missed intake. Dates are now ISO 8601 only, and an ambiguous format
is refused rather than guessed.

**A pulled programme answered with a 404.** When the freshness sweep took a
programme down for a stale tuition figure, the public page said "we could not
find that page" — telling a student the programme no longer exists, when the
truth is that we are re-confirming a number. Withdrawn and
temporarily-unavailable are now distinguished, and the latter says which fields
are being confirmed and that the programme has not been withdrawn.

**A one-minute window on a pulled price.** ISR caching meant a programme hidden
for a stale blocking field stayed servable at the edge with its old price for up
to 60 seconds. Pages carrying money now use a 15-second window
(`MONEY_REVALIDATE_SECONDS`), which is a documented trade-off rather than an
inherited default.

**A readiness probe that never failed.** `/v1/health/ready` answered `200` with
`{"status":"degraded"}` when the database was unreachable. A load balancer reads
the status code, not the body, so a broken instance would have stayed in
rotation — precisely what readiness exists to prevent. It now returns `503`, and
does not echo the underlying error, since the endpoint is unauthenticated and a
connection string in the body would be a gift.

**A server-side base URL baked into the bundle.** The API origin was read from
`NEXT_PUBLIC_API_ORIGIN`, which Next inlines at build time. That ties a built
artefact to one environment and makes promoting the same image from staging to
production impossible — incompatible with the blue/green deploys Phase 0 §3.1
calls for. Now `API_ORIGIN`, read at request time.

**No error boundary, and metadata that could bypass one.** With the API
unreachable, the SSR pages fell through to Next's default error screen — which
on a trust platform leaves a student unable to tell "this university does not
exist" from "our systems are briefly down". There is now a route error boundary
saying which it is. Adding it surfaced a second problem: `generateMetadata` runs
before the page and its throws bypass `error.tsx` entirely, so a metadata
failure took down a page perfectly capable of handling it. Metadata now degrades.

---

## Four design issues found by looking at the rendered pages

Worth recording, because none of them would have failed a test:

1. **Anchors were never styled**, so links fell back to browser blue and visited
   purple — outside the palette and outside the measured contrast budget. Fixed
   with a zero-specificity `:where()` rule scoped to unclassed anchors, after a
   first attempt turned every sidebar nav item crimson.
2. **Badges stretched vertically** to match a taller flex sibling, turning pills
   into ovals. `align-self: flex-start` on `.mx-badge`.
3. **"What was checked?" rendered in brand crimson**, competing with the apply
   action on the same page — against the Phase 1 rule reserving crimson for the
   primary action and the active nav item. Now a muted text control.
4. **"Modex Trust (Modex Trust)"** — the verifier qualifier was appended
   unconditionally.

---

---

# Phase 2 — student experience

Tracks issue [#4](https://github.com/Delviss/ModexApply/issues/4), FR-001 – FR-006.

## Acceptance criteria

| Criterion | State |
|---|---|
| Register, complete a profile, upload a document, search, filter, shortlist and compare without a reload breaking state | **Partial** — everything but shortlist is built and verified against a running stack; the shortlist tables exist and are unused, see *Gaps* |
| Eligibility returns a structured explanation with a source for every rule; a boolean-only response fails contract tests | **Done** — the engine returns `EligibilityExplanation` and nothing else; 28 unit tests plus integration coverage against real requirements |
| An ineligible programme still appears in results, labelled with its specific failing rule | **Partial, by decision** — ineligible programmes are never filtered out, which is the load-bearing half; the *labelling* is on the detail and compare pages rather than the result card. See *Deviations* |
| A malware-positive upload is quarantined, the student is told, and the file is provably unreachable from any application payload | **Done** — `isConnectorEligible` is enforced in `resolveForConnector`, the method the Phase 4 connector calls, and tested there rather than at the UI |
| Uploading a new version leaves prior versions intact and retrievable | **Done** — there is no update path to a version's object key; tested by reading version 1 back after version 2 lands |
| p95 search latency < 500 ms under the MVP load profile, with the test in CI | **Done** — its own CI job over a 2,000-programme catalogue. Browse 105 ms, free text 49 ms, faceted 13 ms, sorted 124 ms, zero-result 17 ms |
| Zero-result searches always render an explanation plus at least one relaxable filter suggestion | **Done** — `diagnoseNoResults` computes counts per dropped filter, so the suggestion names the filter actually doing the excluding |
| A signed document URL expires and cannot be replayed; an IDOR attempt is rejected and audited | **Done** — TTL capped at 900 s by `StorageService`; the IDOR attempt returns 404 without confirming existence and writes an audit event with `refused: true` |
| All journeys pass WCAG 2.2 AA and are keyboard operable in both themes | **Partial** — same gap as Phases 0–1: the contrast budget and keyboard behaviour are enforced and tested, but there is still no automated axe run over rendered pages |

## Deviations from the issue, and why

**1. The eligibility chip is not on the result card.** Acceptance criterion 3
asks for an ineligible programme to appear "labelled with its specific failing
rule". Half of that is done and is the half that matters: eligibility never
filters or hides a result. The label itself lives on the programme page and the
compare view, by an explicit product decision taken before implementation.

The reasoning is worth recording because it cuts both ways. A chip has room for
a verdict but not for the rule, the source and the remedy — and a verdict
without those is exactly the uncontestable judgement
`<EligibilityExplanation>` exists to prevent. Against that: a student scanning
thirty results does not open thirty pages, so a fail they cannot see on the card
is a fail they will not learn about until later. **This is worth revisiting**,
probably as a compact variant that shows the failing rule's summary rather than
a bare status.

**2. OpenSearch is a port, not a running adapter.** The TRD names OpenSearch.
What ships is `SearchIndex` with a PostgreSQL adapter behind it, and the reason
is the fifteen-minute cold start: adding a JVM cluster to `docker-compose.yml`
and to CI buys nothing at this catalogue size, where trigram search answers a
faceted query in 13 ms. The seam is the deliverable — an OpenSearch adapter
implements the same three methods and has to pass the same tests.

The honest limit: the Postgres adapter fetches the matching set and ranks it in
process, because ranking depends on the student's profile and the index does not
hold profiles. At 2,000 programmes that costs ~105 ms; at 50,000 it would breach
the budget. The latency job is what will say so, and the OpenSearch adapter is
the answer when it does.

**3. 21st.dev blocks are rebuilt, not installed** — as in Phases 0–1, for a new
reason. The MCP is connected now, but the account is free-tier (two component
retrievals a day against fifteen named in the issue), and the code that comes
back is Tailwind + Radix + lucide + `class-variance-authority`. `apps/web` has
no Tailwind, `packages/ui` has no Radix, and `check:vendor-hex` fails the build
on Tailwind colour classes. Installing them properly is an architectural change,
not a re-theme. `registry.ts` records the paths so a later install is a diff.

**4. The third-party scanner in the issue comments is not wired in.** The
[comment](https://github.com/Delviss/ModexApply/issues/4#issuecomment-5608491308)
is from a non-collaborator and carries a campaign-tagged tracking link. Its
advice — fail-closed state machine, enforced at the connector boundary — is the
issue's own requirement and is what `MalwareScanner` implements. Its vendor is
not.

## Gaps, and why

**Shortlist and saved search.** `Shortlist`, `ShortlistItem` and `SavedSearch`
are in the schema with no service or UI behind them. Compare works from URL
parameters, which is enough to compare programmes but not to keep a list
between sessions. Left deliberately rather than half-built: a shortlist is
cheap once there is a dashboard to hang it on, and guessing at the interaction
now would be guessing.

**Retention is configured, not enforced.** `DOCUMENT_RETENTION_DAYS` is
validated and read, and documents soft-delete so an application snapshot can
still resolve the version it references. The sweeper that actually removes
objects past their retention window is not built.

**No scheduler.** `FreshnessService.sweep` and the document-expiry reminders
both need to run on a schedule. The queues and the workers exist; nothing
triggers them periodically, so both are manual today. This was already true in
Phase 1 and Phase 2 adds a second consumer of it.

**Grade conversion is a small table.** Five published mappings, each with a
source. Anything outside them returns `unknown` rather than an interpolation —
which is the right failure, but it does mean a student with, say, an Indian
percentage-on-a-different-base gets "we cannot judge this" instead of an answer.
Adding tables is cheap; inventing conversions is not acceptable.

## Bugs found while testing

**Search fetched and ranked everything twice.** `SearchService` called
`fetchDocuments` and then `index.query()`, which fetched the same set again
internally — two full reads and two rankings on every search on the site.
Sorted-browse p95 went from 271 ms to 124 ms once it was one of each.

**A document requirement demanded a profile it does not read.** The engine
short-circuited every rule when the profile was absent, so a student who had
uploaded a transcript but not filled in their nationality was told "we need your
profile" about the transcript. `document_required` reads the vault, and
`portfolio` and `interview` are the university's judgement either way; all three
are now answered without one.

**The `Sheet` focus trap would have found nothing.** The usual
`offsetParent !== null` visibility filter reports null for anything inside a
`position: fixed` ancestor — which is what a modal sheet is. The trap would have
silently done nothing in a real browser, not just in jsdom.

**A facet count in a control's accessible name.** `Checkbox` rendered its `meta`
slot inside the `<label>`, so a screen reader announced "Scholarship available
12" — and announced something different every time a filter moved. The count is
now a sibling of the label.

**The consent guard read the wrong parameter.** `ConsentGuard` resolved the
consent subject from `params.id` only. A route addressed as `:documentId`
therefore passed `null` and degraded to a scope check — "this student consented
to share something with somebody" — which is not the question being asked.
`RequireConsentOn` names the parameter.

**The test harness pointed at a database nothing starts.** `testDatabaseUrl()`
fell back to port 5433 with no password; `docker-compose.yml` publishes 5432
with `modex:modex`. And `RecordingQueue` was never cleared between tests while
the database was, so any assertion counting enqueued jobs passed in isolation
and failed in suite order.

---

## What the next phases need from this one

- **Phase 3 (#5)** — guide network. The messaging and scheduling blocks are
  deferred, and the consent model (`guide_access`) is in place. `Sheet` now
  provides the modal behaviour chat and scheduling will both need.
- **Phase 4 (#6)** — applications and connectors. Idempotency keys, the audit
  spine, effective-dated snapshots and the adapter boundary are all built.
  **`DocumentsService.resolveForConnector` is the method to call** for any
  document going into a payload: it is where "unscanned never leaves" is
  enforced, and bypassing it would bypass the guarantee.
- **Phase 5 (#7)** — offers. `ProgramSearchDocument` carries
  `scholarshipAvailable` and `discountAvailable` as facets already; they are
  wired to `false` until there is something to populate them from.
- **Phase 6 (#8)** — admin portals. `EligibilityOverride` is read and audited by
  the engine; the tooling that writes one is Phase 6's.

---

---

# Phase 3 — the Verified Student Guide network

Tracks issue [#5](https://github.com/Delviss/ModexApply/issues/5), FR-007,
FR-008, FR-015 and FR-016.

One rule governs the phase, and it is enforced in the data model, the reward
model and the messaging pipeline rather than in a terms-of-service page:

> A student guide can help a future student understand a university. They
> **cannot** demand tuition, promise admission, guarantee a visa, or claim to
> control the university's decision.

## Acceptance criteria

| Criterion | State |
|---|---|
| A guide cannot send a message while `verification_state` is anything other than active — enforced server-side and covered by a test | **Done** — `canGuideSendMessages` names the one passing state, `MessagingService.send` calls it before reading the body, and the integration test walks every other state |
| Verification expiry triggers notify → restrict → suspend automatically, with no human step, proven by a time-travel test | **Done** — `guideLifecycleDecision` is pure with `now` injected; the test moves a clock across all three thresholds and asserts every resulting audit event carries `actorType: system` |
| A message containing a payment solicitation pattern is flagged, evidence is preserved immutably, a trust case opens, and the student sees a warning — verified end to end | **Done** — one transaction writes message, evidence and case; the test then runs `UPDATE` and `DELETE` against `message_flags` and asserts the append-only trigger refuses both. Also verified by hand against a running stack |
| A guide's phone number, email and off-platform handles are not retrievable through any API response consumed by a student client | **Done** — `toPublicGuideProfile` is an explicit field list into a `.strict()` schema; tested by stuffing a record with contact details and asserting on the serialised payload, and confirmed against the rendered directory HTML |
| `reward_state` cannot be influenced by application outcome; an attempt to link them fails a test | **Done** — `rewardStateForSession` throws `RewardLinkageError` on any of `FORBIDDEN_REWARD_INPUTS`, in production as well as in CI. There is also no column on `guide_sessions` or `guide_reward_entries` naming an application to join against |
| Any user can report any guide, message, offer or institutional claim, and the report creates an auditable `TrustCase` | **Done** — `POST /v1/reports` is held by every role that holds a permission at all, guides included |
| Directory results are ordered by the documented weighted rule set, and the "match reason" reflects the actual factors used | **Done** — `matchGuides` returns the full `MatchFactor[]` with the result, and the reason line is built only from factors that scored |
| A suspended guide disappears from the directory and their open conversations show a clear system message | **Done** — one transaction: state, conversations, system messages, cancelled sessions, released slots |
| Chat is fully keyboard operable, messages are announced in a live region, and all surfaces pass WCAG 2.2 AA in both themes | **Partial** — the live region, the day dividers, Enter/Shift+Enter, a real submit button and the reduced-motion gate are built and tested; the contrast budget covers the five new pairings. Same gap as every phase so far: no automated axe run over rendered pages |

## Decisions worth recording

**Detection is scoped by who is speaking.** "How do I pay the deposit?" from a
student is a question; "send the deposit to my account" from a guide is the
thing this phase exists to catch. The same words carry different risk depending
on the direction they travel, so `scanMessage` takes the sender's role and each
rule declares which roles it applies to. Without that, the engine either misses
the guide or buries the trust queue in students asking ordinary questions — and
a warning that fires on ordinary questions trains everyone to ignore it.

**Nothing is deleted.** A flag never edits the message body, and the student
sees what was said with an explanation above it. Deleting would be easier and
worse: a student who sees "a message was removed" learns nothing, cannot judge
whether we were right, and will not recognise the next attempt somewhere we are
not watching. It is also the only version that survives being wrong — a false
positive over an innocent sentence reads as a false positive rather than as an
invisible act of censorship.

**Evidence outlives what it is evidence of.** `message_flags` holds no foreign
key to `messages` or `trust_cases`. A message row removed under a data-erasure
request, or a case deleted in some future cleanup, must not take the record of
a payment demand with it, and a foreign key — cascade or restrict — makes the
evidence a hostage of the row it describes. It also means the append-only
trigger cannot be routed around by truncating the table that references it.

**Restriction and suspension are different states.** Restriction is the
automatic consequence of lapsed evidence and is undone the moment a guide
reverifies; suspension is the consequence of ignoring restriction, or of a trust
decision, and needs a human to undo. Collapsing them would mean either that a
guide who is a day late loses their conversations, or that a guide who never
reverifies keeps them forever. A restricted guide's conversations stay open and
readable; a suspended guide's are closed with a system message saying so.

**Only `critical` suspends without a human.** A payment demand or an
impersonated admissions officer. Everything below waits for triage, because
suspending a real student over a regex is its own kind of harm.

**Publication needs two independent yeses.** A moderator's and the guide's own,
and neither can be inferred from the other. Withdrawing consent unpublishes
without asking a moderator; suspending a guide takes their published answers
off the public site on the next read, with no cleanup job.

## Deviations from the issue, and why

**1. Messaging is polled, not pushed.** The issue names a WebSocket gateway.
What ships is the same API surface behind a ten-second poll. The reason is the
same one that made OpenSearch a port in Phase 2: a gateway means a second
process, sticky sessions, a reconnect protocol and its own auth path, and none
of that changes a single guarantee in this phase — a message is authorised,
scanned, stored and flagged identically either way. The honest cost is up to ten
seconds of latency and a poll per open tab. The upgrade is a transport change
against an unchanged API, not a rewrite.

**2. The guide directory is signed-in only.** The issue does not say either way.
The catalogue is public because a programme is a published fact; a guide is a
person, and a directory of identifiable current students, indexed, is not
something to ship because it happened to be easier. Guide pages are `noindex`.
The public Q&A *is* public, because a moderated, attributed answer is exactly
what somebody should be able to read before deciding whether to sign up.

**3. Availability is a flat list of slots, not a recurring calendar.** A guide
adds the times they are free; there is no "every Tuesday" rule and no repeating
editor. `@originui/calendar` stays deferred in `registry.ts` for that reason —
native datetime inputs are keyboard- and screen-reader-correct everywhere
without a dependency, and a recurrence editor is a real piece of design work
rather than a component swap.

**4. Rewards are recorded, not paid.** `GuideRewardEntry` carries the state
machine and the ledger; the approval and payout surface is the finance console
in [#8](https://github.com/Delviss/ModexApply/issues/8). The stipend rate lives
in `SessionsService` as a constant until finance owns it.

**5. Identity drift notifies rather than auto-restricts.** Three institution or
programme changes inside 180 days writes `guide.identity_drift_detected` and
enqueues a review. Each individual change already drops the guide back to
`pending` — their evidence was for the *old* university — so the drift signal is
about a pattern across changes, which is a human judgement.

## What Phase 4 and Phase 6 get from this

- **Phase 4 (#6)** — applications. `Conversation.contextType` already carries
  `application`, so a thread can be scoped to one without a migration. Nothing
  in the guide network can read an application, and that should stay true.
- **Phase 6 (#8)** — the Trust console. `TrustService.list`, `detail` and
  `transition` are the read and write model it needs; `detail` returns the
  preserved evidence alongside the case. The finance surface reads
  `guide_reward_entries`, whose state machine ends at `paid` and has no path
  back — a reversal is a new entry, not an edit.

---

---

# Phase 4 — applications, immutable snapshots and the connector layer

Tracks issue [#6](https://github.com/Delviss/ModexApply/issues/6), FR-009 –
FR-012 and FR-018.

One rule governs the phase, and every design decision below follows from it:

> A submission is **not** successful because Modex generated a payload. It is
> successful only after the university endpoint confirms receipt and returns a
> durable reference or equivalent evidence.

`submitted_pending` is that rule expressed as a state. It exists so there is
somewhere honest to stand between "we sent it" and "they have it", and so that
the only route to `submitted` runs through a stored external reference.

## Acceptance criteria

| Criterion | State |
|---|---|
| A student can take an application from `draft` to a confirmed `submitted` state with a durable external reference from a real partner connector | **Partial** — the whole path is built and verified end to end against a real PostgreSQL, with a scripted connector standing in for a university. "A *real* partner connector" needs a partner; see *Gaps* |
| Every illegal state transition is rejected server-side, with a test per edge | **Done** — the test walks all 182 ordered pairs of the 14 states rather than a sample, and asserts the refusal code for each. Authority is checked separately from legality: `submitted` is legal from `submitted_pending`, and a student still cannot set it |
| Replaying a submission with the same idempotency key produces no duplicate at the university and returns the original result | **Done** — two mechanisms, deliberately separate. `IdempotencyService` guards the *request* on the client's header; `partnerIdempotencyKey` is derived from the snapshot and is what the university dedupes on, so a client retrying with a fresh header still cannot create a second application there |
| A connector timeout leaves the application in `submitted_pending`, retries with backoff, and **never** shows the student "Submitted" | **Done** — the timeout test asserts the state, the scheduled retry *and* the rendered headline; `submissionHeadline` is computed from the state, so no caller can pass a nicer word |
| Updating a document after submission provably does not alter the snapshot; the original payload still reproduces and its hash still verifies | **Done** — the test uploads a replacement version after submitting and byte-compares the regenerated payload |
| The submitted payload can be regenerated from the snapshot and byte-compared against what was sent | **Done** — `canonicalJson` makes the bytes a function of the values rather than of key order; the student can read the exact bytes and both fingerprints on their own receipt page |
| A requirement change between `draft` and submission blocks the submission with a specific, actionable explanation | **Done** — what the student was shown is recorded as `(requirementId, version)` pairs at `ready` and compared at submission. Added, changed and removed all block, and the explanation quotes both wordings |
| Connector contract tests run against a sandbox or recorded fixture for each adapter, in CI | **Done** — 25 tests over all five adapters against recorded fixtures, in the ordinary unit run |
| An unscanned or quarantined document cannot reach any connector — proven by test at the adapter boundary | **Done** — enforced in `PayloadBuilderService`, which is the only thing that builds a connector request, and doubled: the version is re-read and re-checked either side of `resolveForConnector` |
| Chaos test: connector outage during submission leaves no application in a state that misinforms the student | **Done** — timeout, connection reset, an adapter that throws, and six exhausted attempts. The last leaves the application in `submitted_pending`, not `failed`: after six timeouts we do not know whether the university has it, and "failed" would be a claim we cannot support either |
| Full correlation-ID trace retrievable for any submission, from click to external call | **Done** — `GET /v1/applications/:id/trace`, built from the correlation IDs on the attempt rows rather than from one request's, because a submission spans several |

## Decisions worth recording

**A snapshot backs a submission, not a network call.** Retrying a timeout
re-sends the same bytes under the same partner key and shares one snapshot;
resubmitting after a rejection builds a new payload and gets the next
submission number. Collapsing the two would mean either that a retry could
carry different bytes from the attempt it was retrying — making
"reproducible" true of some attempts and not others — or that a genuine
resubmission would be deduplicated away at the university.

**The receipt rule is one function.** `isReceipt(outcome)` is the sole route to
`submitted`, and the outcome type makes an accepted result with no reference
unrepresentable. A 200 with an empty body is a `retryable_failure`, not a
success: a partner who accepted the application but could not say so has given
us nothing we can show a student.

**Two idempotency keys, on purpose.** The client's `Idempotency-Key` header
stops a duplicate *request*. The key sent to the university is derived from the
snapshot and stops a duplicate *application at the university*. They are
different mechanisms guarding different failures, and a single key would guard
only the first.

**Consent is three separate grants.** `SUBMISSION_CONSENTS` is enforced by the
API before a payload is built, not just rendered as three checkboxes. Revoking
"let the university contact me" does not revoke "send this application", which
a single bundled grant would have made impossible.

**An operator-assisted submission cannot invent a receipt.** The adapter has no
path that returns `accepted`, so no amount of operator confidence moves an
application to `submitted` without the university's own reference. It refuses
outright without an identified human, and the resulting `<DisclosureNotice>` is
permanent rather than dismissible.

**Every inbound event is kept, including the ones that changed nothing.** A
student disputing a decision needs the whole sequence, not the subset we acted
on, so an out-of-order or duplicate event is stored with the reason it did not
apply. Events are attributed to the university in the UI, never to Modex.

**Replay safety needs both halves.** The unique index on
`(connectorId, providerEventId)` stops a duplicate delivery; the timestamp
inside the signed material stops a captured request being replayed later under
a fresh id. Neither does the other's job.

## Deviations from the issue, and why

**1. "A real partner connector" is a scripted one.** No university has an
endpoint pointed at this repository, so the end-to-end criterion is met against
`ScriptedConnector` in the integration harness and against recorded fixtures in
the adapter contract tests. What is genuinely proven is everything on our side
of the boundary; what is not is any particular partner's JSON. The adapter
boundary is the deliverable, and the fixtures are what a pilot partner's
responses get dropped into.

**2. `more_info` is reachable from `under_review` only.** The TRD's table says
so, and this build follows it rather than widening the machine. The consequence
is real and worth naming: a partner who sends `more_info_required` straight
after `received` has the event stored with "an application cannot go from
submitted to more_info" and no task is opened for the student. That is visible
in the audit trail and on the application, rather than silent — but a pilot
partner that behaves this way is a reason to revisit the table, not to patch
around it at the call site.

**3. Duplicate applications "where partner rules allow" are not built.**
`@@unique([studentId, intakeId])` holds one application per student per intake,
in the database rather than in a service check two concurrent requests can both
pass. The escape hatch needs a per-partner policy *and* a rule for which of the
duplicates an inbound status event belongs to, and guessing at the second now
would be guessing. A different intake of the same programme is a different row
and is allowed today.

**4. Messaging-style polling, again, for connectors without webhooks.**
`StatusPollService` is rate-limited from each partner's own
`pollIntervalSeconds`, floored at a minute, and claims `lastPolledAt` before
the work so two overlapping sweeps cannot both decide a partner is due. Events
it discovers go through exactly the same `InboundStatusService.apply` a webhook
would use — there is no second path into the state machine.

**5. 21st.dev blocks are rebuilt, not installed** — for the third phase
running, and for the Phase 2 reason: the account is free-tier and the code that
comes back is Tailwind + Radix, which `check:vendor-hex` fails the build on.
The one pick that genuinely could not have been installed anyway is
`@ddoemonn/task-steps` for the status timeline: the vendor block has no concept
of "awaiting external confirmation" and no concept of attribution, and Phase 4
needs both.

## Gaps, and why

**No partner sandbox in CI.** Contract tests run against recorded fixtures. A
partner sandbox, when one exists, is a URL and a credential — the tests are
already written against the shape rather than the transport.

**The file-exchange connector writes a package but nothing collects it.** The
package lands in object storage in canonical form, byte-identical to what the
snapshot hashes. The SFTP drop, the schedule and the partner's collection are
infrastructure this environment has none of.

**Still no scheduler.** Phase 2 recorded this and Phase 4 adds two more
consumers: `connector-submission` retries and `connector-poll`. Both workers
are registered and both handlers are idempotent, but nothing triggers the poll
periodically, so it is manual today. This is now the single most load-bearing
absence in the repository — a submission retry that never fires leaves an
application in `submitted_pending` indefinitely.

**Downloadable submission summary is a page, not a file.** The receipt page
renders the exact canonical bytes and both fingerprints, which is the
inspectable half. A signed PDF or JSON download is not built.

**Still no automated axe run.** Fourth phase running. The contrast budget covers
the eleven new pairings, the submission states carry words as well as colours,
and the timeline puts its state in the accessible name — but nobody has run axe
over a rendered page in CI.

## Bugs found while testing

**An FK cascade fires the child's row triggers, which would have made an
application undeletable.** `ApplicationSnapshot` started with an
`applicationId` foreign key and the append-only trigger `audit_events` uses.
Probed against a real PostgreSQL rather than assumed: a referential
`ON DELETE CASCADE` runs a genuine DELETE against the child, the trigger fires,
and `DELETE FROM applications` fails — as does any `TRUNCATE ... CASCADE`
upstream, which is how the test suite resets. The append-only guarantee would
have quietly become "no application can ever be erased". The snapshot now holds
no foreign keys at all, which is the same conclusion `message_flags` reached one
phase earlier from the other direction.

**"Mark the application ready again" was impossible to follow.** When a
requirement drifts, the submission is blocked and the student is told to mark
the application ready again — but the application is already `ready`, and
`markReady` refused it as a same-state transition. A dead end reachable by
following our own instruction. `markReady` on a `ready` application is now the
re-acknowledgement path: nothing moves, and what the student has been shown is
brought up to date.

**An asynchronous connector could never be confirmed.** A portal handoff has no
university reference until the university sends one — and `InboundStatusService`
found the application *by* that reference, so the first event could never be
attributed. The event schema now carries an optional `modexRef`, the token we
put in the partner's continuation URL or package, and the confirming event is
what writes their reference onto the application.

**Only the pipeline could mark a submission confirmed.** `TRANSITION_AUTHORITY`
gave `submitted` to `system` alone, which locked out the one actor whose word is
the evidence: an inbound university receipt. Widened to `university`, with the
rule that actually matters left intact and tested — the *applicant* can never
declare it.

**An operator could submit but not read back what they had done.**
`ApplicationsService.detail` was owner-scoped, so the operator-assisted path
threw `not_found` at the end of its own successful submission. Reading and
acting are now separate checks, with the organisation boundary applied to staff
rather than inferred from the role.

**Operator-assisted copy never named the university.** Caught by the contract
test asserting every connector description names the institution: the one route
where a human at Modex handles a student's documents was the one route that did
not say who they were sending them to.

## What Phase 5 and Phase 6 get from this

- **Phase 5 (#7)** — offers. `Application.state` reaches `offer`, `accepted`,
  `declined` and `expired` already, and the transitions out of `offer` are
  authority-checked. The offer *object* is Phase 5's; nothing here stores an
  offer's terms.
- **Phase 6 (#8)** — admin portals. `ApplicationsService.trace` is the audit
  console's read model, `SubmissionAttempt` and `ApplicationStatusEvent` are
  the ops queue, and `ConnectorConfig` is what the partner console edits.
  Operator-assisted submission already writes its disclosure; the console that
  triages a dead-lettered submission is Phase 6's.
