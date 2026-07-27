/**
 * Q3F-5BB.10B1 — Synthetic Lusha company fixture (SAFE, no real payload).
 * Fabricated data only; used to exercise the pure Lusha adapter.
 */

import type { LushaRawCompany } from '../../adapters/lusha';

export const lushaCompanyFixture: LushaRawCompany = {
  id: 'lusha-co-001',
  requestId: 'req-lusha-abc',
  name: 'Acme Widgets SAS',
  domain: 'acmewidgets.co',
  website: 'https://www.acmewidgets.co/co',
  linkedin: 'https://www.linkedin.com/company/acme-widgets',
  employeeCount: 240,
  industry: 'Manufacturing',
  mainIndustriesIds: [12, 34],
  description: 'Fabricante sintético de ejemplo.',
  location: {
    country: 'Colombia',
    countryCode: 'CO',
    city: 'Bogotá',
    state: 'Cundinamarca',
  },
};

/** Same shape but with a PERSONAL LinkedIn profile — must be rejected as corporate. */
export const lushaCompanyPersonalLinkedinFixture: LushaRawCompany = {
  ...lushaCompanyFixture,
  id: 'lusha-co-002',
  linkedin: 'https://www.linkedin.com/in/some-person',
};
