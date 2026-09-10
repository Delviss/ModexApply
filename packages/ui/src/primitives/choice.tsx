'use client';

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { CheckIcon } from './icons.js';

/**
 * Checkbox, radio group and range — the three controls Phase 2's filter rail
 * and profile form need that Phases 0–1 never had a use for.
 *
 * All three are native elements underneath. A custom listbox re-implementation
 * would have to re-earn keyboard support, form association and screen-reader
 * announcement that the platform gives away, and every one of those is a thing
 * this codebase has committed to not getting wrong.
 */

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  /**
   * Shown beside the label — a facet count, typically.
   *
   * Rendered as a **sibling** of the label rather than inside it, so it stays
   * out of the control's accessible name. A facet count changes every time a
   * filter moves; folding it into the name would mean the same checkbox
   * announces itself differently on every render, and "Scholarship available
   * 12" is not what the control is called.
   */
  meta?: ReactNode;
}

export function Checkbox({ label, meta, className, ...props }: CheckboxProps) {
  const id = useId();
  return (
    <div className={cn('mx-choice', className)}>
      <div className="mx-choice__row">
        <input className="mx-choice__input" id={id} type="checkbox" {...props} />
        <label className="mx-choice__label" htmlFor={id}>
          <span className="mx-choice__box" aria-hidden="true">
            <CheckIcon size={12} />
          </span>
          <span className="mx-choice__text">{label}</span>
        </label>
        {meta === undefined ? null : <span className="mx-choice__meta">{meta}</span>}
      </div>
    </div>
  );
}

export interface RadioOption {
  value: string;
  label: ReactNode;
  hint?: ReactNode;
}

export interface RadioGroupProps {
  /** The group's accessible name. A fieldset with no legend is an unlabelled group. */
  legend: ReactNode;
  name: string;
  options: readonly RadioOption[];
  value: string | null;
  onChange: (value: string) => void;
  className?: string;
}

export function RadioGroup({
  legend,
  name,
  options,
  value,
  onChange,
  className,
}: RadioGroupProps) {
  return (
    <fieldset className={cn('mx-radiogroup', className)}>
      <legend className="mx-field__label">{legend}</legend>
      {options.map((option) => (
        <RadioOptionRow
          key={option.value}
          name={name}
          option={option}
          checked={value === option.value}
          onChange={onChange}
        />
      ))}
    </fieldset>
  );
}

function RadioOptionRow({
  name,
  option,
  checked,
  onChange,
}: {
  name: string;
  option: RadioOption;
  checked: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="mx-choice">
      <input
        className="mx-choice__input"
        id={id}
        type="radio"
        name={name}
        value={option.value}
        checked={checked}
        aria-describedby={option.hint === undefined ? undefined : hintId}
        onChange={() => onChange(option.value)}
      />
      <label className="mx-choice__label" htmlFor={id}>
        <span className="mx-choice__radio" aria-hidden="true" />
        <span className="mx-choice__text">{option.label}</span>
      </label>
      {option.hint === undefined ? null : (
        <p className="mx-field__hint" id={hintId}>
          {option.hint}
        </p>
      )}
    </div>
  );
}

export interface RangeFieldProps {
  label: ReactNode;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  /** Renders the current value in words — "up to £24,000", not "2400000". */
  format: (value: number) => string;
  className?: string;
}

/**
 * A single-thumb range.
 *
 * Two thumbs on one track cannot be operated by keyboard without inventing
 * semantics the platform does not have, so a two-sided filter is two of these.
 * The current value is rendered as text as well as position: a slider whose
 * value only exists as a pixel offset is unreadable to half its users.
 */
export function RangeField({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  format,
  className,
}: RangeFieldProps) {
  const id = useId();
  return (
    <div className={cn('mx-range', className)}>
      <label className="mx-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        className="mx-range__input"
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <p className="mx-range__value">{format(value)}</p>
    </div>
  );
}
