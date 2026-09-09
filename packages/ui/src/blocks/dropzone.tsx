import { useCallback, useRef, useState, type DragEvent } from 'react';
import { Button } from '../primitives/button.js';
import { Progress } from '../primitives/feedback.js';
import { FileIcon, TrashIcon, UploadIcon } from '../primitives/icons.js';

/**
 * Dropzone — re-themed from `@elements-/uploadthing-dropzone`, with the
 * per-file progress rows from `@ephraimduncan/file-upload-01`.
 *
 * Backend-agnostic on purpose: it hands the caller a `File` and renders whatever
 * progress the caller reports, which is what lets it sit on top of the platform's
 * signed-URL flow rather than a vendor upload service. Documents never pass
 * through a third party.
 */

export interface UploadedFile {
  id: string;
  name: string;
  sizeBytes: number;
  /** 0–100. `null` once the upload has settled. */
  progress: number | null;
  error?: string | null;
}

export interface DropzoneProps {
  label: string;
  hint?: string;
  accept?: string;
  maxSizeBytes?: number;
  multiple?: boolean;
  files?: readonly UploadedFile[];
  onFiles: (files: File[]) => void;
  onRemove?: (id: string) => void;
  className?: string;
}

export function Dropzone({
  label,
  hint,
  accept,
  maxSizeBytes,
  multiple = true,
  files = [],
  onFiles,
  onRemove,
  className,
}: DropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept_ = useCallback(
    (incoming: FileList | null) => {
      if (incoming === null) return;
      const list = Array.from(incoming);
      const tooLarge =
        maxSizeBytes === undefined ? [] : list.filter((file) => file.size > maxSizeBytes);
      if (tooLarge.length > 0) {
        setRejection(
          `${tooLarge.map((f) => f.name).join(', ')} exceeds the ${formatBytes(maxSizeBytes ?? 0)} limit.`,
        );
        return;
      }
      setRejection(null);
      onFiles(list);
    },
    [maxSizeBytes, onFiles],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept_(event.dataTransfer.files);
  };

  return (
    <div className={className}>
      {/* Keyboard reaches the same affordance as the pointer: the div is a button. */}
      <div
        className="mx-dropzone"
        data-dragging={dragging}
        data-invalid={rejection !== null}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <UploadIcon size={22} />
        <span className="mx-field__label">{label}</span>
        {hint ? <span className="mx-dropzone__hint">{hint}</span> : null}
        {maxSizeBytes !== undefined ? (
          <span className="mx-dropzone__hint">Up to {formatBytes(maxSizeBytes)} per file</span>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          className="mx-visually-hidden"
          accept={accept}
          multiple={multiple}
          onChange={(event) => accept_(event.target.files)}
        />
      </div>

      {rejection !== null ? (
        <p className="mx-field__error" role="alert">
          {rejection}
        </p>
      ) : null}

      {files.length > 0 ? (
        <ul className="mx-file-list">
          {files.map((file) => (
            <li key={file.id} className="mx-file">
              <FileIcon size={16} />
              <span className="mx-file__name">{file.name}</span>
              <span className="mx-file__meta">{formatBytes(file.sizeBytes)}</span>
              {file.progress !== null ? (
                <span style={{ width: 120 }}>
                  <Progress value={file.progress} label={`Uploading ${file.name}`} />
                </span>
              ) : null}
              {file.error ? (
                <span className="mx-field__error" role="alert">
                  {file.error}
                </span>
              ) : null}
              {onRemove ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(file.id)}
                  icon={<TrashIcon size={14} />}
                >
                  <span className="mx-visually-hidden">Remove {file.name}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
