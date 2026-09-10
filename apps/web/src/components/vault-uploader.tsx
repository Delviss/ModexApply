'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Dropzone, Field, Select, type UploadedFile } from '@modex/ui';
import { DOCUMENT_TYPES } from '@modex/contracts';
import { DOCUMENT_TYPE_LABELS } from '@/lib/labels';

/**
 * The upload half of the vault.
 *
 * The three-step flow is the whole security property, so it is worth naming
 * here too: ask the API for a version row and a signed PUT, send the bytes
 * straight to storage, then tell the API the checksum so it can verify and
 * queue the scan. The file never passes through the API process, and the
 * version row exists before the bytes do.
 */
export function VaultUploader() {
  const router = useRouter();
  const [type, setType] = useState<string>('transcript');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function upload(selected: File[]): Promise<void> {
    setError(null);

    for (const file of selected) {
      const id = `${file.name}-${file.size}`;
      setFiles((current) => [
        ...current.filter((entry) => entry.id !== id),
        { id, name: file.name, sizeBytes: file.size, progress: 0 },
      ]);

      try {
        const started = await fetch('/api/documents/upload', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type,
            displayName: file.name,
            contentType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          }),
        });
        if (!started.ok) throw new Error('We could not start that upload.');
        const { versionId, upload: signed } = (await started.json()) as {
          versionId: string;
          upload: { url: string; requiredHeaders: Record<string, string> };
        };

        setFiles((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, progress: 40 } : entry)),
        );

        const put = await fetch(signed.url, {
          method: 'PUT',
          headers: signed.requiredHeaders,
          body: file,
        });
        if (!put.ok) throw new Error('The upload did not complete.');

        // The checksum is computed over the bytes we actually sent, so the API
        // can prove the stored object is the file the student chose.
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const checksum = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');

        const finalised = await fetch(`/api/documents/${versionId}/finalise`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ checksum, sizeBytes: file.size }),
        });
        if (!finalised.ok) throw new Error('We could not verify that upload.');

        setFiles((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, progress: null } : entry)),
        );
        router.refresh();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'That upload failed.';
        setError(message);
        setFiles((current) =>
          current.map((entry) =>
            entry.id === id ? { ...entry, progress: null, error: message } : entry,
          ),
        );
      }
    }
  }

  return (
    <div className="mx-vault__upload-form">
      <Field label="What is this document?">
        {({ inputId }) => (
          <Select id={inputId} value={type} onChange={(event) => setType(event.target.value)}>
            {DOCUMENT_TYPES.map((documentType) => (
              <option key={documentType} value={documentType}>
                {DOCUMENT_TYPE_LABELS[documentType] ?? documentType}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Dropzone
        label="Drop a file here, or choose one"
        hint="PDF, JPG or PNG, up to 20 MB. We check every file for malware before it can be used."
        accept=".pdf,.jpg,.jpeg,.png"
        maxSizeBytes={20 * 1024 * 1024}
        files={files}
        onFiles={(selected) => void upload(selected)}
        onRemove={(id) => setFiles((current) => current.filter((entry) => entry.id !== id))}
      />

      {error === null ? null : (
        <Alert tone="danger" title="That upload did not work">
          {error}
        </Alert>
      )}

      <p className="mx-card__description">
        A newly uploaded file is checked before it can be used. Until that finishes it
        shows as pending, and it cannot be sent to a university.
      </p>
    </div>
  );
}
