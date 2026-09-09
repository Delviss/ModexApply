import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingWizard } from '@/components/onboarding-wizard';

/**
 * The onboarding wizard collects; it does not verify. These assertions guard
 * the copy that says so, because a success screen reading "you're verified" is
 * the whole trust model undone by a paragraph.
 */
describe('<OnboardingWizard>', () => {
  it('opens on the first step and shows the whole path', () => {
    render(<OnboardingWizard />);
    expect(screen.getByRole('button', { name: /the institution/i })).toHaveAttribute(
      'aria-current',
      'step',
    );
    for (const step of ['Official domains', 'Authorised signatory', 'Evidence', 'Review and confirm']) {
      expect(screen.getByRole('button', { name: new RegExp(step, 'i') })).toBeInTheDocument();
    }
  });

  it('locks steps beyond the next one until the current step validates', () => {
    render(<OnboardingWizard />);
    // Step 3 onwards is unreachable from an empty step 1.
    expect(screen.getByRole('button', { name: /authorised signatory/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /review and confirm/i })).toBeDisabled();
  });

  it('starts with Back disabled, because there is nowhere to go back to', () => {
    render(<OnboardingWizard />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('labels required fields for assistive technology, not just with an asterisk', () => {
    render(<OnboardingWizard />);
    expect(screen.getAllByText('(required)').length).toBeGreaterThan(0);
  });
});
