'use client';

import { useState } from 'react';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Dropzone,
  Field,
  Input,
  Select,
  TaskSteps,
  Textarea,
  WizardSteps,
  type UploadedFile,
  type WizardStep,
} from '@modex/ui';
import { STAGE_LABELS, VERIFICATION_STAGES } from '@modex/contracts';

/**
 * Partner onboarding wizard (Phase 1 design spec).
 *
 * Multi-step form with a progress stepper, document upload, a review-and-confirm
 * summary and a success state. Built on the `Wizard Steps` archetype, with
 * `UploadThing Dropzone` for documents and `Task Steps` for the verification
 * pipeline view.
 *
 * The wizard collects; it does not verify. That distinction is the point of the
 * final step: submitting starts a Modex trust review, and no amount of
 * completing this form makes an institution verified. A wizard that ended with
 * "you're verified!" would be the whole trust model undone by a success screen.
 */

export interface OnboardingSubmission {
  legalName: string;
  displayName: string;
  country: string;
  domains: string[];
  websiteUrl: string;
  description: string;
  signatoryName: string;
  signatoryEmail: string;
  documents: UploadedFile[];
}

export interface OnboardingWizardProps {
  onSubmit?: (submission: OnboardingSubmission) => void;
}

const COUNTRIES = [
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'DE', name: 'Germany' },
];

const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function OnboardingWizard({ onSubmit }: OnboardingWizardProps) {
  const [form, setForm] = useState({
    legalName: '',
    displayName: '',
    country: 'GB',
    domains: '',
    websiteUrl: '',
    description: '',
    signatoryName: '',
    signatoryEmail: '',
  });
  const [documents, setDocuments] = useState<UploadedFile[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const domainList = form.domains
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain !== '');

  const signatoryDomain = form.signatoryEmail.split('@')[1]?.toLowerCase() ?? '';
  const signatoryOnDomain = domainList.includes(signatoryDomain);

  if (submitted) {
    return <SuccessState displayName={form.displayName} domains={domainList} />;
  }

  const steps: WizardStep[] = [
    {
      id: 'institution',
      title: 'The institution',
      description: 'The legal entity, exactly as it appears on official records.',
      validate: () => {
        if (form.legalName.trim().length < 2) return 'Enter the full registered legal name.';
        if (form.displayName.trim().length < 2) return 'Enter the name students would recognise.';
        return null;
      },
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-4)', maxWidth: 560 }}>
          <Field
            label="Registered legal name"
            hint="As it appears on your incorporation or charter document."
            required
          >
            {({ inputId, describedBy }) => (
              <Input
                id={inputId}
                aria-describedby={describedBy}
                value={form.legalName}
                onChange={(event) => set('legalName')(event.target.value)}
              />
            )}
          </Field>

          <Field label="Display name" hint="What students will see on your page." required>
            {({ inputId, describedBy }) => (
              <Input
                id={inputId}
                aria-describedby={describedBy}
                value={form.displayName}
                onChange={(event) => set('displayName')(event.target.value)}
              />
            )}
          </Field>

          <Field label="Country">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={form.country}
                onChange={(event) => set('country')(event.target.value)}
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="About your institution" hint="Shown on your public page. Plain description, not marketing copy.">
            {({ inputId, describedBy }) => (
              <Textarea
                id={inputId}
                aria-describedby={describedBy}
                value={form.description}
                onChange={(event) => set('description')(event.target.value)}
              />
            )}
          </Field>
        </div>
      ),
    },

    {
      id: 'domains',
      title: 'Official domains',
      description: 'We confirm control of these by DNS record before anything else happens.',
      validate: () => {
        if (domainList.length === 0) return 'Add at least one official domain.';
        const invalid = domainList.filter((domain) => !DOMAIN_PATTERN.test(domain));
        if (invalid.length > 0) return `"${invalid[0]}" does not look like a domain.`;
        return null;
      },
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-4)', maxWidth: 560 }}>
          <Alert tone="info" title="Why we ask for this">
            Anyone can type a university&rsquo;s name into a form. Publishing a DNS record on the
            institution&rsquo;s own domain is something only its administrators can do, which is what
            makes the claim worth anything to a student.
          </Alert>

          <Field
            label="Official domains"
            hint="Comma-separated, e.g. example.ac.uk, example.edu"
            required
          >
            {({ inputId, describedBy }) => (
              <Input
                id={inputId}
                aria-describedby={describedBy}
                value={form.domains}
                onChange={(event) => set('domains')(event.target.value)}
                placeholder="example.ac.uk"
              />
            )}
          </Field>

          <Field label="Website" hint="Your main public site.">
            {({ inputId, describedBy }) => (
              <Input
                id={inputId}
                type="url"
                aria-describedby={describedBy}
                value={form.websiteUrl}
                onChange={(event) => set('websiteUrl')(event.target.value)}
                placeholder="https://www.example.ac.uk"
              />
            )}
          </Field>

          {domainList.length > 0 ? (
            <div style={{ display: 'flex', gap: 'var(--mx-space-2)', flexWrap: 'wrap' }}>
              {domainList.map((domain) => (
                <Badge key={domain} tone="brand">
                  {domain}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ),
    },

    {
      id: 'signatory',
      title: 'Authorised signatory',
      description: 'A named person who can sign a partnership agreement.',
      validate: () => {
        if (form.signatoryName.trim().length < 2) return 'Enter the signatory’s full name.';
        if (!form.signatoryEmail.includes('@')) return 'Enter a valid email address.';
        if (!signatoryOnDomain) {
          return `The signatory must use an address on one of your official domains (${domainList.join(', ')}).`;
        }
        return null;
      },
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-4)', maxWidth: 560 }}>
          <Field label="Full name" required>
            {({ inputId }) => (
              <Input
                id={inputId}
                value={form.signatoryName}
                onChange={(event) => set('signatoryName')(event.target.value)}
              />
            )}
          </Field>

          <Field
            label="Email address"
            hint="Must be on one of the official domains you listed. A free webmail address cannot be an authorised signatory."
            required
            error={
              form.signatoryEmail.includes('@') && !signatoryOnDomain
                ? `${signatoryDomain} is not one of the domains you listed.`
                : null
            }
          >
            {({ inputId, describedBy, invalid }) => (
              <Input
                id={inputId}
                type="email"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                value={form.signatoryEmail}
                onChange={(event) => set('signatoryEmail')(event.target.value)}
              />
            )}
          </Field>
        </div>
      ),
    },

    {
      id: 'documents',
      title: 'Evidence',
      description: 'Held securely and never shown publicly.',
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-4)', maxWidth: 560 }}>
          <Alert tone="info" title="Where these go">
            Evidence documents are stored separately from your public record and are never shown to
            students. Only a Modex trust agent reviewing your application can read them.
          </Alert>

          <Dropzone
            label="Upload incorporation, charter or accreditation documents"
            hint="PDF, PNG or JPEG"
            accept=".pdf,.png,.jpg,.jpeg"
            maxSizeBytes={20 * 1024 * 1024}
            files={documents}
            onFiles={(files) =>
              setDocuments((previous) => [
                ...previous,
                ...files.map((file) => ({
                  id: `${file.name}-${file.size}`,
                  name: file.name,
                  sizeBytes: file.size,
                  progress: null,
                })),
              ])
            }
            onRemove={(id) => setDocuments((previous) => previous.filter((file) => file.id !== id))}
          />
        </div>
      ),
    },

    {
      id: 'review',
      title: 'Review and confirm',
      description: 'Check what you are submitting. Nothing is published from this form.',
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mx-space-4)' }}>
          <Card padding="lg">
            <CardHeader title="What you are submitting" />
            <dl style={{ marginTop: 'var(--mx-space-3)' }}>
              <ReviewRow label="Legal name" value={form.legalName} />
              <ReviewRow label="Display name" value={form.displayName} />
              <ReviewRow label="Country" value={form.country} />
              <ReviewRow label="Official domains" value={domainList.join(', ') || '—'} />
              <ReviewRow label="Signatory" value={`${form.signatoryName} <${form.signatoryEmail}>`} />
              <ReviewRow
                label="Evidence documents"
                value={documents.length === 0 ? 'None attached' : `${documents.length} file(s)`}
              />
            </dl>
          </Card>

          <Card padding="lg">
            <CardHeader
              title="What happens next"
              description="Submitting starts a Modex trust review. It does not make your institution verified."
            />
            <div style={{ marginTop: 'var(--mx-space-4)' }}>
              <TaskSteps
                aria-label="Verification pipeline"
                steps={VERIFICATION_STAGES.map((stage, index) => ({
                  id: stage,
                  title: STAGE_LABELS[stage],
                  status: index === 0 ? ('active' as const) : ('pending' as const),
                  description: NEXT_STEP_COPY[stage],
                }))}
              />
            </div>
          </Card>

          <Alert tone="warning" title="No partial badge">
            Until every step above is complete, your institution page will say clearly that
            verification is not finished. There is no intermediate badge, and we will not publish
            your catalogue before the partnership is active.
          </Alert>
        </div>
      ),
    },
  ];

  return (
    <WizardSteps
      steps={steps}
      completeLabel="Submit for review"
      onComplete={() => {
        setSubmitted(true);
        onSubmit?.({
          legalName: form.legalName,
          displayName: form.displayName,
          country: form.country,
          domains: domainList,
          websiteUrl: form.websiteUrl,
          description: form.description,
          signatoryName: form.signatoryName,
          signatoryEmail: form.signatoryEmail,
          documents,
        });
      }}
    />
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 'var(--mx-space-4)',
        padding: '6px 0',
        borderBottom: '1px solid var(--mx-border)',
      }}
    >
      <dt style={{ color: 'var(--mx-ink-600)', fontSize: 'var(--mx-text-sm)' }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 'var(--mx-text-sm)', textAlign: 'right' }}>{value || '—'}</dd>
    </div>
  );
}

function SuccessState({ displayName, domains }: { displayName: string; domains: string[] }) {
  return (
    <Card padding="lg">
      <CardHeader
        title={`${displayName || 'Your institution'} has been submitted for review`}
        description="A Modex trust agent will work through the verification pipeline with you."
      />
      <div style={{ marginTop: 'var(--mx-space-4)' }}>
        <Alert tone="info" title="Your next action">
          <p style={{ margin: 0 }}>
            We will send you a DNS TXT record to publish on{' '}
            <strong>{domains[0] ?? 'your official domain'}</strong>. Until that record is live and we
            can read it, verification cannot move past the second stage.
          </p>
        </Alert>
      </div>
      <div style={{ marginTop: 'var(--mx-space-4)' }}>
        <TaskSteps
          aria-label="Verification pipeline"
          steps={VERIFICATION_STAGES.map((stage, index) => ({
            id: stage,
            title: STAGE_LABELS[stage],
            status: index === 0 ? ('done' as const) : index === 1 ? ('active' as const) : ('pending' as const),
            description: NEXT_STEP_COPY[stage],
          }))}
        />
      </div>
    </Card>
  );
}

const NEXT_STEP_COPY: Record<string, string> = {
  legal_entity_check: 'A trust agent checks your registration against the public register.',
  official_domain_confirmation: 'You publish a DNS TXT record we provide, and we read it back.',
  partner_contact_confirmation:
    'We confirm your authorised signatory at an address on that official domain.',
  signed_contract: 'Both sides sign the partnership agreement, which sets your scopes and markets.',
  active: 'Your catalogue can be published and students can apply directly.',
};
