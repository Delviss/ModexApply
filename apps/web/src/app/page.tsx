import Link from 'next/link';
import {
  AudienceCard,
  Badge,
  Card,
  CardHeader,
  CtaBand,
  DestinationCard,
  DisclosureNotice,
  JourneySteps,
  LandingHero,
  LandingSection,
  Marquee,
  ProofPoint,
} from '@modex/ui';
import { DESTINATIONS } from '@/lib/destinations';

/**
 * The public landing page.
 *
 * Laid out against the shape a study-abroad marketplace homepage has — header,
 * one centred promise over a search, a destination rail, three audiences, a
 * how-it-works, a closing band — because a student comparing Modex with an
 * agent marketplace should not have to learn a new page to do it.
 *
 * What is different is what the page is allowed to say. The incumbent pattern
 * leads with scale ("1M+ students helped") and a row of stock-photo faces.
 * Neither is available here honestly, and a platform whose entire argument is
 * that claims carry sources cannot open with claims that carry none. So the
 * numbers on this page are rules the platform enforces rather than totals it
 * cannot show you the working for, and they say so.
 *
 * Rendered without an API call on purpose: the front door must not go down
 * because the catalogue service is having a bad afternoon.
 */
export default function HomePage() {
  return (
    <main className="mx-landing">
      <LandingHero
        brand={{ label: 'Modex Apply', href: '/', mark: 'M' }}
        navigation={[
          { label: 'Programmes', href: '/programmes' },
          { label: 'Student guides', href: '/guides' },
          { label: 'Questions', href: '/questions' },
          { label: 'Savings', href: '/savings' },
        ]}
        navSecondary={{ label: 'Log in', href: '/login' }}
        navAction={{ label: 'Create your profile', href: '/onboarding' }}
        eyebrow={<Badge tone="brand">Apply direct. Ask students. Save more.</Badge>}
        title="Apply directly. Ask students who already study there."
        subtitle="No agent in the middle. You keep your application and your documents, the university makes the decision, and the people answering your questions about the course and the city are current students we have verified."
        search={
          // A plain GET form: the search on the front door works before any
          // JavaScript has loaded, and the result is a URL a student can send
          // to their family.
          <form className="mx-landing-search" action="/programmes" method="get" role="search">
            <label className="mx-visually-hidden" htmlFor="landing-search">
              Search programmes
            </label>
            <input
              className="mx-landing-search__input"
              id="landing-search"
              name="q"
              type="search"
              placeholder="Try &quot;computer science&quot; or &quot;public health&quot;"
            />
            <button className="mx-button" data-variant="primary" data-size="lg" type="submit">
              Search programmes
            </button>
          </form>
        }
        secondaryAction={{ label: 'Talk to a student guide', href: '/guides' }}
        disclaimer="Modex does not make admission decisions and does not guarantee visas, admissions, jobs or scholarships. Universities decide admission; governments decide visas."
        proof={
          <>
            <Badge tone="success">Verification with an expiry</Badge>
            <Badge tone="info">Provenance on every figure</Badge>
            <Badge tone="brand">Immutable submission snapshots</Badge>
            <Badge tone="warning">Anti-scam on every message</Badge>
          </>
        }
      >
        <Marquee
          label="Study destinations in the institution register"
          items={DESTINATIONS.map((destination) => (
            <DestinationCard
              key={destination.code}
              code={destination.code}
              name={destination.name}
              detail={destination.cities.join(' · ')}
              meta="Search programmes →"
              href={`/programmes?country=${destination.code}`}
            />
          ))}
        />
      </LandingHero>

      <LandingSection
        tone="canvas"
        eyebrow="Who this is for"
        title="Three jobs an agent bundles into one commission"
        description="An education agent is paid by the university for the enrolment, then advises the student on where to apply. Separating the three jobs is the whole product."
      >
        <div className="mx-landing-grid">
          <AudienceCard
            audience="Students"
            title="Apply direct, and keep what you build"
            description="Search programmes on what they actually require, see what each one costs and when it closes, and submit to the university yourself."
            points={[
              'Your documents stay yours, and you can see who has read them',
              'Every requirement is checked against your profile, with the remedy for anything missing',
              'A submission counts when the university confirms receipt, not when a payload is generated',
            ]}
            action={{ label: 'Browse programmes', href: '/programmes' }}
          />
          <AudienceCard
            audience="Universities"
            title="Applications that arrive complete"
            description="A verified partner publishes its own requirements, fees and deadlines, and receives applications against them through a connector it controls."
            points={[
              'Verification is a signed contract, a confirmed domain and a named signatory — or there is no badge',
              'Every published figure carries the date the institution last updated it',
              'Nothing is ranked for payment without the commercial relationship being disclosed on the page',
            ]}
            action={{ label: 'See an institution page', href: '/institutions/demo' }}
          />
          <AudienceCard
            audience="Student guides"
            title="Paid by us, never by you"
            description="Current students answer questions about the coursework, the city and the real cost of living, verified against evidence that expires."
            points={[
              'A guide cannot collect tuition or application fees, and cannot apply on your behalf',
              'Verification lapses unless it is renewed, and a lapsed guide stops being discoverable',
              'Every message is scanned; a payment request opens a trust case rather than reaching you quietly',
            ]}
            action={{ label: 'Meet the guides', href: '/guides' }}
          />
        </div>
      </LandingSection>

      <LandingSection
        eyebrow="How it works"
        title="Four steps, and you own all four"
        description="Nothing here happens on your behalf in a room you cannot see."
      >
        <JourneySteps
          steps={[
            {
              title: 'Search on what programmes require',
              owner: 'The platform',
              body: 'Rule-based, explainable matching against requirements the university published. Every fee and deadline shows when it was last confirmed, and a figure we cannot vouch for is withheld rather than shown.',
            },
            {
              title: 'Check your eligibility, per requirement',
              owner: 'The platform',
              body: 'A pass, a fail, an unknown or a missing document — never a single verdict. An absence is not a rejection: a transcript you have not uploaded makes you unassessed, not ineligible.',
            },
            {
              title: 'Apply directly to the university',
              owner: 'You',
              body: 'Tasks, separately-worded consents and an immutable snapshot of exactly what was sent. You can reproduce your own submission, byte for byte, months later.',
            },
            {
              title: 'Track it to a confirmed receipt',
              owner: 'You and the university',
              body: 'The university returns its own reference. Until then the application is submitted, not received — and the page says so in those words.',
            },
          ]}
        />
      </LandingSection>

      <LandingSection
        tone="canvas"
        eyebrow="Why it is different"
        title="Every claim on this platform carries its evidence"
        description="The failure the agent model hides is not that somebody is paid. It is that you cannot see who, for what, or on what basis a figure was quoted."
      >
        <div className="mx-landing-grid">
          <Card padding="lg">
            <CardHeader
              title="Verification is all four steps or none"
              description="A verified university has a confirmed official domain, a named signatory on that domain, a legal entity checked against the national register and a signed contract. If any step is missing there is no badge — there is no partial badge."
            />
          </Card>
          <Card padding="lg">
            <CardHeader
              title="Prices and deadlines come with a date"
              description="Every catalogue record shows when the university last updated it and when we last confirmed it. A wrong price is worse than an absent one, so a stale record is withheld rather than served."
            />
          </Card>
          <Card padding="lg">
            <CardHeader
              title="Ranking discloses what pays for it"
              description="Wherever results are ranked or recommended, the commercial relationship behind that ordering is stated on the page as a landmark, not a dismissible toast."
            />
          </Card>
        </div>
      </LandingSection>

      <LandingSection
        eyebrow="The numbers"
        title="Three figures we can show the working for"
        description="Marketplaces in this category open with a student total and a wall of faces. We do not publish a number we cannot source, so these are rules the platform enforces in code."
        lead={<DisclosureNotice kind="ranking_method" />}
        footnote="Counted claims about students, partners or outcomes will appear here when there is an audited figure behind them, with the date it was measured — the same standard every tuition fee on this platform is held to."
      >
        <div className="mx-landing-grid">
          <ProofPoint
            tone="brand"
            value="3"
            label="Jobs an agent bundles into one commission"
            source="Matching, applying and answers are separated, with a different owner each."
          />
          <ProofPoint
            tone="brand"
            value="0"
            label="Guides who can take a payment from you"
            source="Guides are paid by Modex. A payment request is scanned, warned in-thread and opens a trust case."
          />
          <ProofPoint
            tone="brand"
            value="1"
            label="Source for every fee and deadline: the university"
            source="Shown with the date it was last confirmed, and withheld once it goes stale."
          />
        </div>
      </LandingSection>

      <CtaBand
        title="Start with a programme, not a sales call"
        description="Search the catalogue, check what you would need, and ask a current student before you commit to anything."
        primaryAction={{ label: 'Browse programmes', href: '/programmes' }}
        secondaryAction={{ label: 'Read questions students actually asked', href: '/questions' }}
        footnote="Free to search. No agent will call you."
      />

      <footer className="mx-landing-footer">
        <div className="mx-landing-footer__inner">
          <div className="mx-landing-footer__columns">
            <div className="mx-landing-footer__column">
              <span className="mx-landing-footer__heading">Study</span>
              <Link href="/programmes">Search programmes</Link>
              <Link href="/programmes/compare">Compare programmes</Link>
              <Link href="/savings">Verified savings</Link>
            </div>
            <div className="mx-landing-footer__column">
              <span className="mx-landing-footer__heading">Ask</span>
              <Link href="/guides">Student guides</Link>
              <Link href="/questions">Questions and answers</Link>
              <Link href="/messages">Messages</Link>
            </div>
            <div className="mx-landing-footer__column">
              <span className="mx-landing-footer__heading">Apply</span>
              <Link href="/applications">My applications</Link>
              <Link href="/documents">My documents</Link>
              <Link href="/privacy">Who has my data</Link>
            </div>
            <div className="mx-landing-footer__column">
              <span className="mx-landing-footer__heading">Institutions</span>
              <Link href="/institutions/demo">Example institution page</Link>
              <Link href="/admin/university">University intake</Link>
              <Link href="/login">Log in</Link>
            </div>
          </div>
          <p className="mx-landing-footer__legal">
            Modex Apply is not an education agent, an immigration adviser or an admissions decision
            maker. Universities decide admission; governments decide visas. Student guides are
            current students, never staff, and never collect tuition or application fees.
          </p>
        </div>
      </footer>
    </main>
  );
}
