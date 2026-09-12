/**
 * The destinations the landing rail offers.
 *
 * These mirror `data/institution-register.json` — the countries and cities of
 * the universities entered against the evidence rules. They are identity facts
 * from public sources, which is the only thing the register is allowed to hold
 * and the only thing this page is allowed to repeat: no fee, no deadline, no
 * requirement and no claim that any of these institutions is a partner.
 *
 * A tile is a filter on the catalogue. It says where you can look, never what
 * you will find — the catalogue itself answers that, with a date against every
 * figure.
 */
export interface Destination {
  /** ISO 3166-1 alpha-2, which is also what the catalogue filters on. */
  code: string;
  name: string;
  /** Register cities, in the order they were entered. */
  cities: string[];
}

export const DESTINATIONS: readonly Destination[] = Object.freeze([
  { code: 'GB', name: 'United Kingdom', cities: ['Manchester', 'Leeds', 'Birmingham', 'Glasgow'] },
  { code: 'IE', name: 'Ireland', cities: ['Dublin', 'Galway'] },
  { code: 'NL', name: 'Netherlands', cities: ['Enschede', 'Maastricht', 'Tilburg'] },
  { code: 'DE', name: 'Germany', cities: ['Berlin', 'Aachen', 'Hamburg'] },
  { code: 'CA', name: 'Canada', cities: ['Halifax', 'Winnipeg', 'Montréal'] },
  { code: 'AU', name: 'Australia', cities: ['Adelaide', 'Perth', 'Sydney'] },
  { code: 'LV', name: 'Latvia', cities: ['Riga'] },
]);
