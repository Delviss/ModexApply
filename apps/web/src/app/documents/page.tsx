import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardHeader, EmptyState, ScanStatePill, formatDate } from '@modex/ui';
import type { DocumentVersion, ExpiryState, ScanState } from '@modex/contracts';
import { ApiError, apiGetAs } from '@/lib/api';
import { sessionToken } from '@/lib/session';
import { DOCUMENT_TYPE_LABELS } from '@/lib/labels';
import { VaultUploader } from '@/components/vault-uploader';

export const metadata: Metadata = {
  title: 'Your documents',
  robots: { index: false },
};

export interface VaultDocument {
  id: string;
  type: string;
  displayName: string;
  expiryAt: string | null;
  expiryState: ExpiryState;
  currentVersion: DocumentVersion | null;
  usable: boolean;
  blockReason: string | null;
  versionCount: number;
  versions: DocumentVersion[];
}

const EXPIRY_COPY: Record<ExpiryState, string | null> = {
  valid: null,
  no_expiry: null,
  expiring_soon: 'Expires soon',
  expired: 'Expired — universities will not accept it',
};

/**
 * The document vault (Phase 2 §2).
 *
 * Two things this page has to get right, both of which are product rules
 * rather than layout: a blocked file says why and says it permanently, and
 * prior versions stay visible so a student can see that replacing a file did
 * not destroy the one an application already references.
 */
export default async function DocumentsPage() {
  const token = await sessionToken();
  if (token === null) redirect('/login?next=/documents');

  let documents: VaultDocument[];
  try {
    documents = (await apiGetAs<{ data: VaultDocument[] }>('/documents', token)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?next=/documents');
    throw error;
  }

  return (
    <main className="mx-vault">
      <header>
        <h1 className="mx-card__title">Your documents</h1>
        <p className="mx-card__description">
          Uploaded once, reused across every application. We check every file for
          malware before it can be sent anywhere.
        </p>
      </header>

      <Card padding="lg">
        <CardHeader
          title="Add a document"
          description="Files go straight to secure storage. They never pass through a third party."
        />
        <div className="mx-vault__uploader">
          <VaultUploader />
        </div>
      </Card>

      <Card padding="lg">
        <CardHeader title="In your vault" description="Every version you have uploaded is kept." />
        {documents.length === 0 ? (
          <div className="mx-vault__empty">
            <EmptyState
              title="Nothing uploaded yet"
              description="Your vault is empty. Upload a transcript or passport above — you only have to do it once, and every application can use it."
            />
          </div>
        ) : (
          <div className="mx-table-wrap">
            <table className="mx-table">
              <caption className="mx-visually-hidden">Documents in your vault</caption>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Type</th>
                  <th scope="col">Malware check</th>
                  <th scope="col">Expiry</th>
                  <th scope="col">Versions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id}>
                    <th scope="row">{document.displayName}</th>
                    <td>{DOCUMENT_TYPE_LABELS[document.type] ?? document.type}</td>
                    <td>
                      <ScanStatePill
                        state={(document.currentVersion?.scanState ?? 'pending') as ScanState}
                        detail={document.usable ? null : document.blockReason}
                      />
                    </td>
                    <td>
                      {document.expiryAt === null ? (
                        <span className="mx-card__description">No expiry</span>
                      ) : (
                        <>
                          {formatDate(document.expiryAt)}
                          {EXPIRY_COPY[document.expiryState] === null ? null : (
                            <div className="mx-vault__expiry" data-state={document.expiryState}>
                              {EXPIRY_COPY[document.expiryState]}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      {/*
                        Stated plainly, because "we replaced your file" and "we
                        kept both" are very different promises to a student who
                        has already submitted an application.
                      */}
                      {document.versionCount === 1
                        ? '1 version'
                        : `${document.versionCount} versions, all kept`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
