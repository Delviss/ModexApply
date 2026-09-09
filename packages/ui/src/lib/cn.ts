import clsx, { type ClassValue } from 'clsx';

/**
 * Class joiner. Deliberately not `tailwind-merge`: the design system styles come
 * from token-bound `.mx-*` classes rather than utility soup, so there is nothing
 * to de-duplicate — and the vendor-colour gate bans the utility colour classes
 * that would need merging.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
