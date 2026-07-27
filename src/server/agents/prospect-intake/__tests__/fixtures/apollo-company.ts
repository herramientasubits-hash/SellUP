/**
 * Q3F-5BB.10B1 — Synthetic Apollo organization fixture (SAFE, no real payload).
 * Fabricated data only; models `mixed_companies/search` firmographic output.
 */

import type { ApolloRawOrganization } from '../../adapters/apollo';

export const apolloOrganizationFixture: ApolloRawOrganization = {
  id: 'apollo-org-001',
  name: 'Globex Industrial Inc',
  website_url: 'https://www.globex-industrial.example',
  primary_domain: 'globex-industrial.example',
  linkedin_url: 'https://www.linkedin.com/company/globex-industrial',
  industry: 'industrial machinery',
  estimated_num_employees: 1200,
  employee_range: '1001-5000',
  country: 'Mexico',
  city: 'Monterrey',
  state: 'Nuevo León',
  organization_naics_codes: ['333120', '333',],
  organization_sic_codes: ['3531'],
  short_description: 'Synthetic industrial machinery example.',
};

/** Uses `organization_id` + range array instead of the flat fields. */
export const apolloOrganizationAltShapeFixture: ApolloRawOrganization = {
  organization_id: 'apollo-org-002',
  name: 'Initech Software',
  domain: 'initech.example',
  industry: 'software',
  organization_num_employees_ranges: ['201-500'],
  country: 'Chile',
};
