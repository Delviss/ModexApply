import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Alert, Card, CardHeader } from '@modex/ui';
import { canonicalJson } from '@modex/contracts';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Submission summary',
  robots: { index: false },
};

interface Reproduction {
  submissionNo: number;
  createdAt: string;
  profileVersion: string;
  documentVersionIds: string[];
  payload: unknown;
  storedHash: string;
  recomputedHash: string;
  verified: boolean;
}

/**
 * The submission summary — what was actually sent, regenerated from the
 * snapshot and re-verified.
 *
 * This page is the product's central claim made inspectable. The API rebuilds
 * the canonical bytes from the stored payload and recomputes the hash; if the
 * two disagree, the page says so in as many words rather than quietly showing
 * the payload as though nothing were wrong.
 *
 * The payload is rendered through `canonicalJson`, the same serialisation the
 * hash was taken over, so what a student reads here is byte-for-byte what was
 * hashed rather than a prettied-up rendering of it.
 */
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string; submissionNo: string }>;
}) {
  const { id, submissionNo } = await params;
  const token = await sessionToken();
  if (token === null) redirect(`/login?next=/applications/${id}/receipt/${submissionNo}`);

  let reproduction: Reproduction;
  try {
    reproduction = await apiGetAs<Reproduction>(
      `/applications/${id}/snapshots/${submissionNo}`,
      token,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/login?next=/applications/${id}/receipt/${submissionNo}`);
    }
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <main className="mx-receipt-page">
      <header>
        <p className="mx-card__description">
          <Link href={`/applications/${id}`}>Back to the application</Link>
        </p>
        <h1 className="mx-card__title">Submission {reproduction.submissionNo}</h1>
        <p className="mx-card__description">
          Exactly what left Modex Apply on{' '}
          {new Date(reproduction.createdAt).toLocaleString('en-GB')}.
        </p>
      </header>

      {reproduction.verified ? (
        <Alert tone="success" title="This record verifies">
          We rebuilt the submission from the stored record and recomputed its fingerprint. It
          matches what we stored at the time, so nothing has been altered since.
        </Alert>
      ) : (
        <Alert tone="danger" title="This record does not verify">
          The fingerprint we recomputed does not match the one stored when this was sent. This
          should never happen. Modex Trust has a copy of the audit trail; quote submission{' '}
          {reproduction.submissionNo} on application {id} when you contact us.
        </Alert>
      )}

      <Card padding="lg">
        <CardHeader title="Fingerprints" description="Stored when sent, and recomputed now." />
        <dl className="mx-receipt-page__grid">
          <div>
            <dt>Stored</dt>
            <dd>{reproduction.storedHash}</dd>
          </div>
          <div>
            <dt>Recomputed</dt>
            <dd>{reproduction.recomputedHash}</dd>
          </div>
          <div>
            <dt>Profile version</dt>
            <dd>{reproduction.profileVersion}</dd>
          </div>
          <div>
            <dt>Document versions</dt>
            <dd>{reproduction.documentVersionIds.length}</dd>
          </div>
        </dl>
      </Card>

      <Card padding="lg">
        <CardHeader
          title="The submission itself"
          description="The exact bytes the fingerprint was taken over — sorted keys, no formatting. This is what the university received."
        />
        <pre className="mx-receipt-page__payload">
          <code>{canonicalJson(reproduction.payload)}</code>
        </pre>
      </Card>
    </main>
  );
}
