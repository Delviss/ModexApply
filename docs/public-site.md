# The published site

<https://delviss.github.io/ModexApply/> serves the product: the catalogue, the
eligibility engine, the guide directory, chat with the anti-scam pipeline, the
application journey with its immutable snapshot, the savings view and the four
admin consoles. It used to serve the delivery board; that board moved to
[/board.html](https://delviss.github.io/ModexApply/board.html).

## What it is

GitHub Pages is static hosting, so the site is a static bundle built from
`apps/site/src` into `docs/` and committed. It has no server, no database and no
network calls: everything a visitor does is held in their own browser under one
`localStorage` key, and the footer has a control that erases it.

## The home page

The front door is laid out against the shape a study-abroad marketplace
homepage has — one centred promise over a programme search, a scrolling
destination rail, three audiences, a how-it-works and a closing band — because
a student comparing this with an agent marketplace should not have to learn a
new page to do it.

Every number on it is computed from the data in this repository, not written
into the page: the register count, the published-programme count and the
discoverable-guide count come from the same selectors the rest of the site
reads, and each says where it came from and whether it is sample data. Each
destination tile carries **both** numbers — "8 in the register · 0 sample
programmes" — because a register entry is a publicly verifiable name, not a
partner with a catalogue, and a tile showing only the larger number would be
the move this platform exists to remove. The incumbent pattern here is a scale
claim and a row of stock-photo faces; neither is available honestly, so neither
is on the page.

What it is *not* is a mock. The rules that make this platform what it is are
imported, not reimplemented:

| Rule | Where the site gets it |
|---|---|
| Anti-scam scanning, severities and actions | `scanMessage` from `packages/contracts/src/domain/trust.ts` |
| Guide matching weights and the match reason | `matchGuides` from `packages/contracts/src/domain/guide-matching.ts` |
| Guide messaging and discoverability predicates | `canGuideSendMessages`, `isGuideDiscoverable` |
| Reverification lifecycle (notify → restrict → suspend) | `guideLifecycleDecision`, `guideExpiryUrgency` |
| Eligibility evaluation, per requirement | `evaluateRequirement` from `apps/api/src/eligibility/rules.ts` |
| Eligibility roll-up | `rollUpVerdict` |
| Application transitions and submission wording | `canTransition`, `submissionDisplayState`, `submissionHeadline` |
| Canonical payload and consent wording | `canonicalJson`, `SUBMISSION_CONSENTS` |

`apps/site/src/engine.js` is the only seam. If somebody loosens the rule that a
suspended guide cannot send a message, the published site stops enforcing it in
the same commit, and that is visible rather than hidden behind a demo fixture.

## The data, and what it is allowed to claim

Two files, kept separate on purpose.

**`data/institution-register.json` — real universities.** Publicly verifiable
identity facts only: display name, country, city, official domain, website. No
tuition figure, no deadline, no requirement, no partnership scope, no legal
entity name. Every record starts at stage `submitted` and unverified, because
entering a name from a public website is not verification of anything.

**`data/catalogue.json` and `data/network.json` — sample data.** Fictional
institutions, programmes, fees, intakes, guides, offers and Q&A, rendered with a
visible "Sample data" chip. They exist so the whole journey can be walked — a
verified partner, a stale price that gets withheld, a scholarship with an
expiry, a guide whose evidence lapsed — without attributing an invented tuition
figure to a real university. Inventing one would break the rule the platform is
built to enforce, on the platform's own front page.

## The institution register

Entering a university is the admin work the University intake console exists
for, and it has rules the form enforces rather than documents:

1. **Identity facts only.** The form has no field for money, dates or
   requirements. A figure typed by staff has no source, and a figure with no
   source is exactly what this platform removes.
2. **A stage is a claim, so it needs evidence.** Advancing refuses an empty
   evidence reference, and stores the reference with the operator's name and the
   date:

   | Stage | Evidence before it can be claimed |
   |---|---|
   | Legal entity confirmed | Confirmed against the national register of the awarding country |
   | Domain confirmed | DNS TXT record published by the institution |
   | Signatory confirmed | Authorised signatory verified on an address at that domain |
   | Partnership signed | Signed contract on file, with the agreed scopes |

3. **The last stage is step-up gated.** Marking an institution as a signed
   partner publishes a verified badge on public pages, so it asks for the second
   factor first.
4. **A verified badge expires.** A claim nobody has to renew is a claim nobody
   maintains.
5. **Nothing is deleted.** A rejected record keeps its reason.

The register in the repository today holds 25 real universities across the UK,
Ireland, the Netherlands, Germany, Canada, Australia and Latvia, all at the
first stage. Adding more is a two-step loop: enter them in the console, then use
**Export the register** and commit the JSON over the `institutions` array in
`data/institution-register.json`. The export is the path from browser-local
admin work back into the repository, deliberately, so that a claim reaches the
public site only through a commit somebody can review.

## Building and testing it

```bash
pnpm site:serve   # build and serve on http://localhost:4321
pnpm site:build   # rebuild the committed bundle
pnpm site:check   # fail if docs/ has drifted from apps/site/src  (CI gate)
pnpm site:test    # every route and three journeys in a real Chromium (CI gate)
```

`pnpm site:test` walks every route, asserts there are no console errors and no
failed requests, and drives the three journeys that carry the product's
promises: a submission that only counts once the university confirms receipt, a
payment solicitation that is warned in-thread and opens an evidenced trust case
while the guide is suspended automatically, and a university entered against the
evidence rules — including that a duplicate domain is refused.

## What the published build does not prove

- **No server means no server guarantees.** Rate limits, the append-only audit
  trail, step-up as an actual TOTP check, RBAC and consent enforcement live in
  the API and are tested there. The consoles here gate the same moments and say
  where the check is stubbed.
- **The sample catalogue is not a partner catalogue.** No university in the
  register has agreed to anything; a signed partnership is what moves an
  institution out of the register and into a catalogue with a connector.
- **Accessibility is checked, not audited.** The site test covers structure,
  focus, naming and keyboard operation; the manual audit with an
  assistive-technology user is still a go/no-go item in
  [go-live.md](go-live.md).
