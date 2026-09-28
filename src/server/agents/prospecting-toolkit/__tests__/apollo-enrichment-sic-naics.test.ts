/**
 * AGENT1-APOLLO-ENRICH-SIC-NAICS-1 — los códigos SIC / NAICS del enriquecimiento
 * de Apollo se guardan en el perfil del candidato.
 *
 * Apollo Support (2026-09-24): `mixed_companies/search` no devuelve la industria;
 * Organization Enrichment sí, y además `sic_codes` / `naics_codes` cuando el
 * registro los tiene. La industria ya se guardaba; los códigos se perdían.
 * Sólo observación: no deciden admisión, aceptación ni gasto.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeEnrichmentIntoResult,
  normalizeIndustryCodes,
  sanitizeEnrichmentProfile,
} from '../apollo-organization-enrichment-cascade';
import type { ApolloOrganization } from '../../../integrations/apollo-client';
import type { WebSearchResult } from '../types';

function org(overrides: Partial<ApolloOrganization> = {}): ApolloOrganization {
  return {
    id: 'org-1',
    name: 'Empresa',
    website_url: 'https://empresa.co',
    linkedin_url: null,
    industry: 'retail',
    industry_tag_ids: [],
    employee_count: 300,
    estimated_num_employees: 300,
    city: 'Bogotá',
    country: 'Colombia',
    phone: '+57 000',
    annual_revenue: null,
    technologies: [],
    short_description: null,
    keywords: [],
    ...overrides,
  };
}

describe('§ 1 — normalización de códigos', () => {
  it('acepta cadenas y números, deja sólo dígitos y deduplica', () => {
    assert.deepEqual(normalizeIndustryCodes(['5411', 5411, ' 5812 ', 44511]), [
      '5411',
      '5812',
      '44511',
    ]);
  });

  it('descarta lo que no es un código', () => {
    assert.deepEqual(normalizeIndustryCodes(['', 'retail', '54.11', 5.5, -1, null, {}, '7']), null);
  });

  it('no es un arreglo ⇒ null', () => {
    for (const value of [undefined, null, '5411', 5411, {}]) {
      assert.equal(normalizeIndustryCodes(value), null);
    }
  });

  it('se acota a 10 códigos', () => {
    const many = Array.from({ length: 15 }, (_, i) => String(1000 + i));
    assert.equal(normalizeIndustryCodes(many)?.length, 10);
  });
});

describe('§ 2 — llegan al perfil del candidato', () => {
  it('🔴 el perfil sanitizado lleva sic_codes y naics_codes', () => {
    const profile = sanitizeEnrichmentProfile(org({ sic_codes: ['5411'], naics_codes: [445110] }));
    assert.deepEqual(profile.sic_codes, ['5411']);
    assert.deepEqual(profile.naics_codes, ['445110']);
  });

  it('sin códigos en la respuesta, el perfil los deja en null (nunca se inventan)', () => {
    const profile = sanitizeEnrichmentProfile(org());
    assert.equal(profile.sic_codes, null);
    assert.equal(profile.naics_codes, null);
  });

  it('🔴 el merge los escribe en metadata.apollo_profile y los declara añadidos', () => {
    const result = {
      url: 'https://empresa.co',
      title: 'Empresa',
      snippet: '',
      metadata: {},
    } as unknown as WebSearchResult;
    const { updated, fieldsAdded } = mergeEnrichmentIntoResult(
      result,
      sanitizeEnrichmentProfile(org({ sic_codes: ['5411'], naics_codes: ['445110'] })),
    );
    const profile = (updated.metadata as Record<string, Record<string, unknown>>)['apollo_profile'];
    assert.deepEqual(profile!['sic_codes'], ['5411']);
    assert.deepEqual(profile!['naics_codes'], ['445110']);
    assert.ok(fieldsAdded.includes('sic_codes') && fieldsAdded.includes('naics_codes'));
  });

  it('el perfil sigue sin datos personales (teléfono, id)', () => {
    const profile = sanitizeEnrichmentProfile(org({ sic_codes: ['5411'] })) as Record<
      string,
      unknown
    >;
    assert.equal('phone' in profile, false);
    assert.equal('id' in profile, false);
  });
});
