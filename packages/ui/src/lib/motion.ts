import { useEffect, useState } from 'react';

/**
 * Several sourced blocks animate with Framer Motion. Everything in this package
 * gates on this hook so `prefers-reduced-motion` is honoured (Phase 0 §1.6);
 * the token layer additionally collapses the duration variables to 1ms, so a
 * component that forgets still degrades safely.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setPrefersReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return prefersReduced;
}
