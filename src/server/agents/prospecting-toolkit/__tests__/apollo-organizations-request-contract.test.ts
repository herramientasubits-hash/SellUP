/**
 * A1-APOLLO-WIZARD-1 — Contrato de request de Apollo Organization Search.
 *
 * Puro, offline, determinista. Cero llamadas reales a Apollo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildApolloOrganizationsRequestContract,
  assertApolloOrganizationsBodySafe,
  APOLLO_ORGANIZATIONS_ALLOWED_PARAMS,
  APOLLO_ORGANIZATIONS_FORBIDDEN_PARAMS,
  APOLLO_MAX_PER_PAGE,
  APOLLO_MAX_FILTER_VALUES,
} from '../apollo-organizations-request-contract';

const baseInput = { page: 1, perPage: 10 } as const;

describe('A1-APOLLO-WIZARD-1 · contrato de request', () => {
  // ── Caso 1: país → organization_locations[] ────────────────────────────────
  it('mapea el país a organization_locations[]', () => {
    const { body } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      locations: ['Colombia'],
    });
    assert.deepEqual(body.organization_locations, ['Colombia']);
  });

  it('mapea exclusiones a organization_not_locations[]', () => {
    const { body } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      locations: ['Colombia'],
      notLocations: ['Venezuela'],
    });
    assert.deepEqual(body.organization_not_locations, ['Venezuela']);
  });

  // ── Caso 2: sector → q_organization_keyword_tags[] ─────────────────────────
  it('mapea sectores a q_organization_keyword_tags[]', () => {
    const { body } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      keywordTags: ['corporate training', 'lms'],
    });
    assert.deepEqual(body.q_organization_keyword_tags, ['corporate training', 'lms']);
  });

  // ── Caso 3: rangos de empleados ────────────────────────────────────────────
  it('mapea rangos de empleados a organization_num_employees_ranges[]', () => {
    const { body } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      employeeRanges: ['200,500', '500,1000'],
    });
    assert.deepEqual(body.organization_num_employees_ranges, ['200,500', '500,1000']);
  });

  // ── Caso 4: eliminación de SIC/NAICS ───────────────────────────────────────
  it('rechaza SIC y NAICS y los reporta por nombre, sin enviarlos', () => {
    const result = buildApolloOrganizationsRequestContract({
      ...baseInput,
      extraParams: {
        organization_sic_codes: ['1234'],
        organization_naics_codes: ['5678'],
        not_organization_sic_codes: ['9999'],
        not_organization_naics_codes: ['0000'],
      },
    });

    for (const forbidden of APOLLO_ORGANIZATIONS_FORBIDDEN_PARAMS) {
      assert.equal(
        forbidden in result.body,
        false,
        `${forbidden} nunca debe viajar a Apollo`,
      );
      assert.ok(
        result.rejectedForbiddenParams.includes(forbidden),
        `${forbidden} debe reportarse como rechazado`,
      );
    }
    assert.equal(result.rejectedForbiddenParams.length, 4);
  });

  it('assertApolloOrganizationsBodySafe lanza ante un parámetro prohibido', () => {
    assert.throws(
      () => assertApolloOrganizationsBodySafe({ page: 1, organization_sic_codes: ['1'] }),
      /apollo_organizations_forbidden_params/,
    );
  });

  it('assertApolloOrganizationsBodySafe lanza ante un parámetro desconocido', () => {
    assert.throws(
      () => assertApolloOrganizationsBodySafe({ page: 1, q_totally_made_up: 'x' }),
      /apollo_organizations_unknown_params/,
    );
  });

  it('un parámetro desconocido se reporta en vez de viajar en silencio', () => {
    const result = buildApolloOrganizationsRequestContract({
      ...baseInput,
      extraParams: { q_invented_filter: 'value' },
    });
    assert.deepEqual(result.rejectedUnknownParams, ['q_invented_filter']);
    assert.equal('q_invented_filter' in result.body, false);
    assert.ok(
      result.omittedFilters.some(
        (f) => f.param === 'q_invented_filter' && f.reason === 'unknown_parameter',
      ),
    );
  });

  // ── Caso 5: parámetros vacíos y duplicados ─────────────────────────────────
  it('elimina vacíos, espacios y duplicados case-insensitive', () => {
    const { body } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      keywordTags: ['  LMS  ', 'lms', '', '   ', 'Corporate Training', null, undefined],
    });
    assert.deepEqual(body.q_organization_keyword_tags, ['LMS', 'Corporate Training']);
  });

  it('omite el filtro cuando queda vacío tras la limpieza, con motivo', () => {
    const result = buildApolloOrganizationsRequestContract({
      ...baseInput,
      keywordTags: ['', '   '],
    });
    assert.equal('q_organization_keyword_tags' in result.body, false);
    assert.ok(
      result.omittedFilters.some(
        (f) => f.param === 'q_organization_keyword_tags' && f.reason === 'empty_after_cleanup',
      ),
    );
  });

  it('distingue "no provisto" de "vacío tras limpieza"', () => {
    const result = buildApolloOrganizationsRequestContract({ ...baseInput });
    assert.ok(
      result.omittedFilters.some(
        (f) => f.param === 'organization_locations' && f.reason === 'not_provided',
      ),
    );
  });

  it('no muta el input', () => {
    const locations = ['Colombia', 'colombia'];
    const frozen = Object.freeze([...locations]);
    buildApolloOrganizationsRequestContract({ ...baseInput, locations: frozen });
    assert.deepEqual([...frozen], ['Colombia', 'colombia']);
  });

  it('trunca los arrays al límite defensivo y lo reporta', () => {
    const many = Array.from({ length: APOLLO_MAX_FILTER_VALUES + 5 }, (_, i) => `kw-${i}`);
    const result = buildApolloOrganizationsRequestContract({
      ...baseInput,
      keywordTags: many,
    });
    assert.equal(result.body.q_organization_keyword_tags?.length, APOLLO_MAX_FILTER_VALUES);
    assert.ok(
      result.omittedFilters.some(
        (f) => f.param === 'q_organization_keyword_tags' && f.reason === 'truncated_to_limit',
      ),
    );
  });

  // ── Caso 6: per_page máximo 100 ────────────────────────────────────────────
  it('capa per_page al máximo del contrato (100)', () => {
    const result = buildApolloOrganizationsRequestContract({
      page: 1,
      perPage: 500,
    });
    assert.equal(result.body.per_page, APOLLO_MAX_PER_PAGE);
    assert.ok(
      result.omittedFilters.some(
        (f) => f.param === 'per_page' && f.reason === 'truncated_to_limit',
      ),
    );
  });

  it('fuerza page >= 1', () => {
    assert.equal(buildApolloOrganizationsRequestContract({ page: 0, perPage: 10 }).body.page, 1);
    assert.equal(buildApolloOrganizationsRequestContract({ page: -7, perPage: 10 }).body.page, 1);
  });

  it('fuerza per_page >= 1 ante valores inválidos', () => {
    assert.equal(buildApolloOrganizationsRequestContract({ page: 1, perPage: 0 }).body.per_page, 1);
    assert.equal(
      buildApolloOrganizationsRequestContract({ page: 1, perPage: Number.NaN }).body.per_page,
      1,
    );
  });

  // ── Facturación, nombre, dominios, tecnología ──────────────────────────────
  it('mapea el rango de facturación a revenue_range[min/max]', () => {
    const { body } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      revenueRange: { min: 1_000_000, max: 50_000_000 },
    });
    assert.deepEqual(body.revenue_range, { min: 1_000_000, max: 50_000_000 });
  });

  it('emite sólo el extremo presente del rango de facturación', () => {
    const { body } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      revenueRange: { min: 1_000_000, max: null },
    });
    assert.deepEqual(body.revenue_range, { min: 1_000_000 });
  });

  it('descarta un rango de facturación invertido y lo reporta como inválido', () => {
    const result = buildApolloOrganizationsRequestContract({
      ...baseInput,
      revenueRange: { min: 90, max: 10 },
    });
    assert.equal('revenue_range' in result.body, false);
    assert.ok(
      result.omittedFilters.some(
        (f) => f.param === 'revenue_range' && f.reason === 'invalid_value',
      ),
    );
  });

  it('mapea nombre explícito, lista de dominios y tecnologías', () => {
    const { body } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      organizationName: '  Acme S.A.S  ',
      domainsList: ['acme.com', 'ACME.com'],
      technologyUids: ['salesforce', 'salesforce', 'hubspot'],
    });
    assert.equal(body.q_organization_name, 'Acme S.A.S');
    assert.deepEqual(body.q_organization_domains_list, ['acme.com']);
    assert.deepEqual(body.currently_using_any_of_technology_uids, ['salesforce', 'hubspot']);
  });

  // ── Allowlist e idempotencia ───────────────────────────────────────────────
  it('todo lo que sale está en el allowlist', () => {
    const { body } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      locations: ['Colombia'],
      keywordTags: ['lms'],
      employeeRanges: ['200,500'],
      organizationName: 'Acme',
      domainsList: ['acme.com'],
      technologyUids: ['sap'],
      revenueRange: { min: 1, max: 2 },
      notLocations: ['Peru'],
    });
    for (const key of Object.keys(body)) {
      assert.ok(
        (APOLLO_ORGANIZATIONS_ALLOWED_PARAMS as readonly string[]).includes(key),
        `${key} debe pertenecer al allowlist`,
      );
    }
    assert.doesNotThrow(() =>
      assertApolloOrganizationsBodySafe(body as unknown as Record<string, unknown>),
    );
  });

  it('la huella de filtros es estable entre páginas', () => {
    const filters = { locations: ['Colombia'], keywordTags: ['lms'] };
    const p1 = buildApolloOrganizationsRequestContract({ ...filters, page: 1, perPage: 10 });
    const p7 = buildApolloOrganizationsRequestContract({ ...filters, page: 7, perPage: 10 });
    assert.equal(p1.filtersFingerprint, p7.filtersFingerprint);
  });

  it('la huella cambia cuando cambian los filtros', () => {
    const a = buildApolloOrganizationsRequestContract({
      ...baseInput,
      keywordTags: ['lms'],
    });
    const b = buildApolloOrganizationsRequestContract({
      ...baseInput,
      keywordTags: ['erp'],
    });
    assert.notEqual(a.filtersFingerprint, b.filtersFingerprint);
  });

  it('la huella no depende del orden de los valores', () => {
    const a = buildApolloOrganizationsRequestContract({
      ...baseInput,
      keywordTags: ['lms', 'erp'],
    });
    const b = buildApolloOrganizationsRequestContract({
      ...baseInput,
      keywordTags: ['erp', 'lms'],
    });
    assert.equal(a.filtersFingerprint, b.filtersFingerprint);
  });

  it('un extra permitido no pisa el criterio estructurado del wizard', () => {
    const { body } = buildApolloOrganizationsRequestContract({
      ...baseInput,
      locations: ['Colombia'],
      extraParams: { organization_locations: ['Brasil'] },
    });
    assert.deepEqual(body.organization_locations, ['Colombia']);
  });
});
