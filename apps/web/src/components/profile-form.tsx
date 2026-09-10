'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Field, Input, Select } from '@modex/ui';
import { PROGRAM_LEVELS, type StudentProfile } from '@modex/contracts';
import { LEVEL_LABELS } from '@/lib/labels';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The profile form, autosaved.
 *
 * A student filling this in is halfway through a task they did not choose to
 * do, often on a phone, often on a connection that drops. An explicit Save
 * button loses that work; autosave keeps it. The debounce is deliberately
 * generous — this is not a search box, and a save per keystroke would be a
 * write per keystroke.
 */
const SAVE_DEBOUNCE_MS = 900;

export interface ProfileFormProps {
  profile: StudentProfile;
}

export function ProfileForm({ profile }: ProfileFormProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    nationality: profile.nationality ?? '',
    countryOfResidence: profile.countryOfResidence ?? '',
    dateOfBirth: profile.dateOfBirth ?? '',
    intendedLevel: profile.intendedLevel ?? '',
    intendedField: profile.intendedField ?? '',
    preferredCountries: profile.preferredCountries.join(', '),
    targetIntake: profile.targetIntake ?? '',
    workExperienceMonths:
      profile.workExperienceMonths === null ? '' : String(profile.workExperienceMonths),
  });
  const [state, setState] = useState<SaveState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (next: typeof form) => {
      setState('saving');
      setMessage(null);
      try {
        const response = await fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            nationality: upper(next.nationality),
            countryOfResidence: upper(next.countryOfResidence),
            dateOfBirth: next.dateOfBirth === '' ? null : next.dateOfBirth,
            intendedLevel: next.intendedLevel === '' ? null : next.intendedLevel,
            intendedField: next.intendedField === '' ? null : next.intendedField,
            preferredCountries: next.preferredCountries
              .split(',')
              .map((part) => part.trim().toUpperCase())
              .filter((part) => /^[A-Z]{2}$/.test(part)),
            targetIntake: next.targetIntake === '' ? null : next.targetIntake,
            workExperienceMonths:
              next.workExperienceMonths === '' ? null : Number(next.workExperienceMonths),
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(body?.error?.message ?? 'We could not save that.');
        }

        setState('saved');
        // Refresh so the completeness meter beside the form reflects the save.
        router.refresh();
      } catch (error) {
        setState('error');
        setMessage(error instanceof Error ? error.message : 'We could not save that.');
      }
    },
    [router],
  );

  useEffect(() => () => (timer.current === null ? undefined : clearTimeout(timer.current)), []);

  function update(key: keyof typeof form, value: string): void {
    const next = { ...form, [key]: value };
    setForm(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), SAVE_DEBOUNCE_MS);
  }

  return (
    <div className="mx-profile__fields">
      {/*
        The save state is a live region, not a toast: a student who cannot see
        the corner of the screen still needs to know their work is safe.
      */}
      <p className="mx-profile__save" role="status" aria-live="polite" data-state={state}>
        {state === 'saving'
          ? 'Saving…'
          : state === 'saved'
            ? 'Saved'
            : state === 'error'
              ? 'Not saved'
              : 'Changes save automatically'}
      </p>

      {message === null ? null : (
        <Alert tone="danger" title="We could not save that">
          {message}
        </Alert>
      )}

      <div id="nationality">
        <Field label="Your nationality" hint="Two-letter country code, e.g. NG.">
          {({ inputId, describedBy }) => (
            <Input
              id={inputId}
              aria-describedby={describedBy}
              value={form.nationality}
              maxLength={2}
              onChange={(event) => update('nationality', event.target.value.toUpperCase())}
            />
          )}
        </Field>
      </div>

      <div id="dateOfBirth">
        <Field label="Date of birth" hint="Used only for programmes with a minimum age.">
          {({ inputId, describedBy }) => (
            <Input
              id={inputId}
              type="date"
              aria-describedby={describedBy}
              value={form.dateOfBirth}
              onChange={(event) => update('dateOfBirth', event.target.value)}
            />
          )}
        </Field>
      </div>

      <div id="intendedLevel">
        <Field label="What level do you want to study at?">
          {({ inputId }) => (
            <Select
              id={inputId}
              value={form.intendedLevel}
              onChange={(event) => update('intendedLevel', event.target.value)}
            >
              <option value="">Not decided yet</option>
              {PROGRAM_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {LEVEL_LABELS[level] ?? level}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div id="intendedField">
        <Field label="What subject?">
          {({ inputId }) => (
            <Input
              id={inputId}
              value={form.intendedField}
              onChange={(event) => update('intendedField', event.target.value)}
            />
          )}
        </Field>
      </div>

      <div id="preferredCountries">
        <Field
          label="Where would you like to study?"
          hint="Two-letter country codes, separated by commas."
        >
          {({ inputId, describedBy }) => (
            <Input
              id={inputId}
              aria-describedby={describedBy}
              value={form.preferredCountries}
              onChange={(event) => update('preferredCountries', event.target.value)}
            />
          )}
        </Field>
      </div>

      <div id="targetIntake">
        <Field label="When do you want to start?" hint="Year and month, e.g. 2027-09.">
          {({ inputId, describedBy }) => (
            <Input
              id={inputId}
              placeholder="2027-09"
              aria-describedby={describedBy}
              value={form.targetIntake}
              onChange={(event) => update('targetIntake', event.target.value)}
            />
          )}
        </Field>
      </div>

      <div id="workExperience">
        <Field label="Months of work experience">
          {({ inputId }) => (
            <Input
              id={inputId}
              type="number"
              min={0}
              value={form.workExperienceMonths}
              onChange={(event) => update('workExperienceMonths', event.target.value)}
            />
          )}
        </Field>
      </div>
    </div>
  );
}

/** An empty string means "not answered", which is null, not "". */
function upper(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : null;
}
