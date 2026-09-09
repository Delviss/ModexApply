import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';
import { AlertTriangleIcon } from './icons.js';

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Present means invalid. The message is announced, not just coloured red. */
  error?: string | null;
  required?: boolean;
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/**
 * Wraps a control with its label, hint and error, wiring `aria-describedby` and
 * `aria-invalid`. Error state is icon + text + colour, never colour alone.
 */
export function Field({ label, hint, error, required = false, children }: FieldProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="mx-field">
      <label className="mx-field__label" htmlFor={inputId}>
        {label}
        {required ? (
          <>
            {' '}
            <span className="mx-field__required" aria-hidden="true">
              *
            </span>
            <span className="mx-visually-hidden">(required)</span>
          </>
        ) : null}
      </label>
      {hint ? (
        <span className="mx-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {children({ inputId, describedBy, invalid: Boolean(error) })}
      {error ? (
        <span className="mx-field__error" id={errorId} role="alert">
          <AlertTriangleIcon size={14} />
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('mx-input', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('mx-textarea', className)} rows={4} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('mx-select', className)} {...props}>
      {children}
    </select>
  );
}
