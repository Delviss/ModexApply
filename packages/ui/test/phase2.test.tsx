import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SCAN_STATES, type ProfileCompleteness } from '@modex/contracts';
import { CompletenessMeter } from '../src/signature/completeness-meter.js';
import { ScanStatePill } from '../src/signature/scan-state-pill.js';
import { Checkbox, RadioGroup, RangeField } from '../src/primitives/choice.js';
import { Sheet } from '../src/blocks/sheet.js';

function completeness(overrides: Partial<ProfileCompleteness> = {}): ProfileCompleteness {
  return {
    completed: 6,
    total: 10,
    missing: [
      { field: 'languageTests', label: 'Your English language test', unlocks: 'Language checks' },
      { field: 'nationality', label: 'Your nationality', unlocks: 'Nationality rules' },
    ],
    ...overrides,
  };
}

describe('<CompletenessMeter>', () => {
  /**
   * The hard product boundary from issue #4: the meter must never be framed,
   * labelled or visually implied as an admission likelihood.
   */
  it('never uses admission or likelihood language', () => {
    const { container } = render(<CompletenessMeter completeness={completeness()} />);
    const text = container.textContent ?? '';

    for (const forbidden of [
      /\bchance\b/i,
      /\blikelihood\b/i,
      /\blikely to be (admitted|accepted)\b/i,
      /\bodds\b/i,
      /\bmatch score\b/i,
      /\byou will get in\b/i,
    ]) {
      expect(text).not.toMatch(forbidden);
    }

    // And it says what it is, so it cannot be dropped next to offer language
    // and quietly read as a prediction.
    expect(text).toMatch(/not a prediction/i);
  });

  it('is labelled "Profile completeness" and counts sections, not a bare percentage', () => {
    render(<CompletenessMeter completeness={completeness()} />);
    expect(screen.getByRole('region', { name: /profile completeness/i })).toBeInTheDocument();
    expect(screen.getByText('6 of 10 sections')).toBeInTheDocument();
  });

  it('exposes progress to assistive technology in sections, not a percent', () => {
    render(<CompletenessMeter completeness={completeness()} />);
    const bar = screen.getByRole('progressbar', { name: /profile completeness/i });
    expect(bar).toHaveAttribute('aria-valuenow', '6');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
    expect(bar).toHaveAttribute('aria-valuetext', '6 of 10 sections complete');
  });

  it('lists what is missing and what filling it unlocks', () => {
    render(<CompletenessMeter completeness={completeness()} />);
    expect(screen.getByText(/your english language test/i)).toBeInTheDocument();
    expect(screen.getByText(/language checks/i)).toBeInTheDocument();
  });

  it('says so plainly when nothing is missing', () => {
    render(<CompletenessMeter completeness={completeness({ completed: 10, missing: [] })} />);
    expect(screen.getByText(/your profile is complete/i)).toBeInTheDocument();
  });
});

describe('<ScanStatePill>', () => {
  // Never colour alone: the state has to survive greyscale and a screen reader.
  it('carries a text label for every state', () => {
    for (const state of SCAN_STATES) {
      const { unmount, container } = render(<ScanStatePill state={state} />);
      expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('renders a quarantined file as blocked, not as retryable', () => {
    render(
      <ScanStatePill state="quarantined" detail="Malware signature: Eicar-Test-Signature" />,
    );
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText(/eicar/i)).toBeInTheDocument();
  });

  // `failed` and `pending` are different things, and a student fixing one is
  // not fixing the other.
  it('distinguishes a scan still running from one that could not finish', () => {
    const { unmount } = render(<ScanStatePill state="pending" />);
    expect(screen.getByText(/checking for malware/i)).toBeInTheDocument();
    unmount();

    render(<ScanStatePill state="failed" />);
    expect(screen.getByText(/did not finish/i)).toBeInTheDocument();
  });
});

describe('choice primitives', () => {
  it('associates a checkbox with its label and keeps the native input', () => {
    render(<Checkbox label="Scholarship available" meta="12" defaultChecked />);
    const box = screen.getByRole('checkbox', { name: /scholarship available/i });
    expect(box).toBeChecked();
    // A facet count must not become part of the control's accessible name.
    expect(box).toHaveAccessibleName('Scholarship available');
  });

  it('gives a radio group a real accessible name through its legend', () => {
    const onChange = vi.fn();
    render(
      <RadioGroup
        legend="Sort results by"
        name="sort"
        value="relevance"
        onChange={onChange}
        options={[
          { value: 'relevance', label: 'Best match' },
          { value: 'tuition_asc', label: 'Lowest tuition' },
        ]}
      />,
    );

    const group = screen.getByRole('group', { name: /sort results by/i });
    expect(group).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('radio', { name: /lowest tuition/i }));
    expect(onChange).toHaveBeenCalledWith('tuition_asc');
  });

  // A slider whose value exists only as a pixel offset is unreadable to half
  // its users, so the formatted value is both rendered and announced.
  it('announces the range value in words as well as showing it', () => {
    render(
      <RangeField
        label="Maximum tuition"
        min={0}
        max={5_000_000}
        step={100_000}
        value={2_400_000}
        onChange={() => {}}
        format={(value) => `Up to £${(value / 100).toLocaleString('en-GB')}`}
      />,
    );

    const slider = screen.getByRole('slider', { name: /maximum tuition/i });
    expect(slider).toHaveAttribute('aria-valuetext', 'Up to £24,000');
    expect(screen.getByText('Up to £24,000')).toBeInTheDocument();
  });
});

describe('<Sheet>', () => {
  it('renders nothing when closed', () => {
    render(
      <Sheet open={false} onClose={() => {}} title="Filters">
        <button type="button">Inside</button>
      </Sheet>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a labelled modal dialog when open', () => {
    render(
      <Sheet open onClose={() => {}} title="Filters">
        <button type="button">Inside</button>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('moves focus into the panel on open', () => {
    render(
      <Sheet open onClose={() => {}} title="Filters">
        <button type="button">First control</button>
      </Sheet>,
    );
    // Focus lands on the first focusable in the panel, which is Close in the
    // header. What matters is that it is inside the dialog rather than left on
    // the page behind it.
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  // The behaviour `role="dialog"` promises and the Phase 1 drawer never had.
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Filters">
        <button type="button">Inside</button>
      </Sheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wraps Tab at the end of the panel rather than escaping to the page', () => {
    render(
      <Sheet open onClose={() => {}} title="Filters" footer={<button type="button">Apply</button>}>
        <button type="button">Inside</button>
      </Sheet>,
    );

    const apply = screen.getByRole('button', { name: 'Apply' });
    apply.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    // Wrapped back to the first control in the panel, not out of it.
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
  });

  it('restores focus to whatever opened it', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const { rerender } = render(
      <Sheet open onClose={() => {}} title="Filters">
        <button type="button">Inside</button>
      </Sheet>,
    );
    expect(opener).not.toHaveFocus();

    rerender(
      <Sheet open={false} onClose={() => {}} title="Filters">
        <button type="button">Inside</button>
      </Sheet>,
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
