/**
 * AGENT1-RESCUE-SIZE-UNFILTERED-1 — Prod 15-10, «Proveedores» Subsecretaría de Salud
 * Pública × Chile × Tecnología (28a13bfd): el rescate dejó en Por revisar a AZAR
 * PRODUCCIONES (2 empleados, por «industria corregida») y a VICONF sin web (como «filial
 * grande» de viconf.cl), porque en Chile toda fila oficial se daba por «100+ medido» — y
 * las de compras públicas no pasaron ese filtro. Además Entel y Soaint quedaron sin
 * revisar: la ventana es corta y no iban primero las grandes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isSizeUnfiltered, officialSizeSignal } from '../official-size-signal';
import {
  byOfficialWorkforceDesc,
  isOfficiallyLargeFreeLayerRow,
  rescueBatchWithClaude,
  type RescueBatchDeps,
} from '../rescue-batch';
import { keptBeforeOfficialSizeRule, type RescuableDispositionRow } from '../rescue-dispositions';
import type { DomainFinderOutcome } from '../../domain-finder';
import type { CompanyClassificationResult } from '../../types';
import type { SendToReviewOrigin } from '@/modules/prospect-discards/send-to-review-core';
import { sanitizeStructuredDiscoveryProvenance } from '@/server/agents/prospecting-toolkit/structured-discovery-provenance';
import { buildUnverifiedFreeDispositionRows } from '@/server/prospect-batches/country-source-discovery/free-source-unverified';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';

const AT = '2026-10-15T14:10:00.000Z';
const NOW = Date.parse(AT);
const MODEL = 'claude-haiku-4-5-20251001';
const TECH = 'Tecnología';
const SERVICES = 'Compañía de Servicios';
const USAGE = { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: 0, webFetchRequests: 0 };

function row(overrides: Partial<RescuableDispositionRow> & { evidence?: Record<string, unknown> } = {}): RescuableDispositionRow {
  return {
    id: 'd1',
    batch_id: 'b1',
    candidate_id: null,
    status: 'discarded',
    name: 'VICONF - SOLUCIONES DE COMUNICACIONES JORGE ANDRES',
    domain: null,
    country_code: 'CL',
    industry: TECH,
    reason_code: 'missing_domain_final',
    round_origin: 'free_source',
    provider_identifier: 'tax:76064702-0',
    ...overrides,
    evidence: {
      provider_raw_name: 'VICONF - SOLUCIONES DE COMUNICACIONES JORGE ANDRES',
      tax_identifier_present: true,
      tax_identifier_type: 'RUT',
      official_size_unfiltered: true,
      ...(overrides.evidence ?? {}),
    },
  } as RescuableDispositionRow;
}

describe('1. la señal de tamaño oficial', () => {
  it('Chile sin filtro de la fuente: NO está medido, pero rige el umbral de Chile (100)', () => {
    assert.deepEqual(officialSizeSignal({ countryCode: 'CL', fromFreeLayer: true, sizeUnfiltered: true }), { measured: false, minEmployees: 100 });
    assert.deepEqual(officialSizeSignal({ countryCode: 'CL', fromFreeLayer: true }), { measured: true, minEmployees: 100 });
    assert.equal(officialSizeSignal({ countryCode: 'CO', fromFreeLayer: true, sizeUnfiltered: true }).measured, false);
  });

  it('la marca se lee de la evidencia o la metadata', () => {
    assert.equal(isSizeUnfiltered({ official_size_unfiltered: true }), true);
    assert.equal(isSizeUnfiltered({ official_size_unfiltered: 'true' }), false);
    assert.equal(isSizeUnfiltered(null), false);
  });

  it('«grande» sólo con trabajadores del SII ≥ 100; sin dato, no entra sin web', () => {
    assert.equal(isOfficiallyLargeFreeLayerRow(row()), false);
    assert.equal(isOfficiallyLargeFreeLayerRow(row({ evidence: { official_workforce: { workers: 150, year: 2024, source_label: 'SII' } } })), true);
    assert.equal(isOfficiallyLargeFreeLayerRow(row({ evidence: { official_workforce: { workers: 40, year: 2024, source_label: 'SII' } } })), false);
    // La capa gratuita de Chile (100+ por construcción) sigue igual.
    assert.equal(isOfficiallyLargeFreeLayerRow(row({ evidence: { official_size_unfiltered: undefined } })), true);
  });

  it('la vuelta extra por la regla del tamaño oficial no aplica a las sin filtro', () => {
    const kept = row({
      evidence: {
        claude_rescue: { decision: 'unchanged' },
        claude_domain_search: { found: true, website: 'https://x.cl', domain: 'x.cl', verification: 'name_match', searched_at: AT },
      },
    });
    assert.equal(keptBeforeOfficialSizeRule(kept), false);
  });
});

describe('2. la marca viaja de la fuente a la fila', () => {
  const company: CountrySourceCompany = {
    recordIdentityKey: 'tax:76064702-0',
    legalName: 'VICONF',
    normalizedLegalName: null,
    taxId: '76064702-0',
    taxIdentifierType: 'RUT',
    countryCode: 'CL',
    city: null,
    region: null,
    domain: null,
    declaredIndustry: null,
    industryCode: null,
    coarseSector: null,
    sizeNotFilteredBySource: true,
  };

  it('a la descartada sin web', () => {
    const [disposition] = buildUnverifiedFreeDispositionRows({ batchId: 'b1', countryCode: 'CL', companies: [company] });
    assert.equal(disposition.evidence?.official_size_unfiltered, true);
    const [plain] = buildUnverifiedFreeDispositionRows({ batchId: 'b1', countryCode: 'CL', companies: [{ ...company, sizeNotFilteredBySource: undefined }] });
    assert.equal(plain.evidence?.official_size_unfiltered, undefined);
  });

  it('a la procedencia del candidato (sólo como `true`)', () => {
    assert.deepEqual(sanitizeStructuredDiscoveryProvenance({ official_size_unfiltered: true }), { official_size_unfiltered: true });
    assert.deepEqual(sanitizeStructuredDiscoveryProvenance({ official_size_unfiltered: 'yes' }), {});
  });
});

describe('3. las grandes primero', () => {
  it('de más a menos trabajadores oficiales; las sin dato al final, en su orden', () => {
    const rows = [
      row({ id: 'sin-1' }),
      row({ id: 'entel', evidence: { official_workforce: { workers: 5000 } } }),
      row({ id: 'sin-2' }),
      row({ id: 'netics', evidence: { official_workforce: { workers: 120 } } }),
    ];
    assert.deepEqual([...rows].sort(byOfficialWorkforceDesc).map((r) => r.id), ['entel', 'netics', 'sin-1', 'sin-2']);
  });
});

function classified(company: { candidateId: string }, opts: { industry: string; matches: boolean; employees: number }): CompanyClassificationResult {
  return {
    candidateId: company.candidateId,
    outcome: 'classified',
    sector: {
      industryId: opts.industry === TECH ? 'tech' : 'services',
      industryName: opts.industry,
      subindustryId: null,
      subindustryName: null,
      matchesCurrentIndustry: opts.matches,
      quote: 'Nos especializamos en el arriendo y servicio para producciones audiovisuales',
      sourceUrl: 'https://www.azarproducciones.cl/',
      confidence: 0.9,
      verification: 'quote_verified',
    },
    employeeRange: { min: opts.employees, max: opts.employees, quote: `${opts.employees} empleados`, sourceUrl: 'https://www.azarproducciones.cl/', confidence: 0.9, verification: 'quote_verified', status: 'estimated' },
    rejected: [],
    isOperatingCompany: true,
    pageFinalUrl: 'https://www.azarproducciones.cl/',
    usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.02, pricingSource: 'table' },
    errorCode: null,
    durationMs: 1000,
  } as unknown as CompanyClassificationResult;
}

function deps(opts: { row: RescuableDispositionRow; finder: DomainFinderOutcome; classify: Parameters<typeof classified>[1] }) {
  const origins: SendToReviewOrigin[] = [];
  const evidence = new Map<string, Record<string, unknown>>();
  const d: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'test-key' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [
      { industryId: 'tech', industryName: TECH, industryDescription: null, subindustries: [] },
      { industryId: 'services', industryName: SERVICES, industryDescription: null, subindustries: [] },
    ],
    loadReviewCandidates: async () => [],
    loadDispositions: async () => [opts.row],
    loadBatchIndustryId: async () => 'tech',
    classify: async (company) => classified(company, opts.classify),
    logUsage: async () => true,
    patchCandidate: async () => false,
    patchDispositionEvidence: async (id, build) => {
      const next = build(evidence.get(id) ?? opts.row.evidence);
      if (!next) return false;
      evidence.set(id, next);
      return true;
    },
    admitDisposition: async (id, origin) => (origins.push(origin), `new-${id}`),
    claimIdentities: async () => undefined,
    domainSearch: {
      findWebsite: async () => opts.finder,
      checkDuplicate: async () => ({ status: 'new_candidate' as never, summary: '' }),
    },
    nowIso: () => AT,
    nowMs: () => NOW,
  };
  return { d, origins };
}

describe('4. el rescate con los dos casos de Producción', () => {
  it('VICONF: Claude no confirma viconf.cl ⇒ ya no entra sin web como «filial grande»', async () => {
    const f = deps({
      row: row(),
      finder: {
        found: false,
        reason: 'identity_not_confirmed',
        claimedUrl: 'https://www.viconf.cl',
        usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.04, pricingSource: 'table' },
      } as DomainFinderOutcome,
      classify: { industry: TECH, matches: true, employees: 300 },
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.d);
    assert.equal(s.ok && s.dispositionsAdmitted, 0);
    assert.equal(f.origins.length, 0);
  });

  it('AZAR PRODUCCIONES: web encontrada, otra industria y 2 empleados ⇒ se queda en Descartadas', async () => {
    const f = deps({
      row: row({ id: 'd2', name: 'AZAR PRODUCCIONES SPA', provider_identifier: 'tax:76889547-3', evidence: { provider_raw_name: 'AZAR PRODUCCIONES SPA' } }),
      finder: {
        found: true,
        website: 'https://azarproducciones.cl',
        domain: 'azarproducciones.cl',
        verification: 'search_result_match',
        usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.04, pricingSource: 'table' },
      } as DomainFinderOutcome,
      classify: { industry: SERVICES, matches: false, employees: 2 },
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.d);
    assert.equal(s.ok && s.dispositionsAdmitted, 0);
    assert.equal(s.ok && s.reassigned, 0);
    assert.equal(f.origins.length, 0);
  });

  it('la capa gratuita de Chile (sin la marca) sigue como antes: con web y su industria, vuelve aunque Claude vea pocos empleados', async () => {
    const f = deps({
      row: row({ id: 'd3', name: 'NETICS SPA', evidence: { provider_raw_name: 'NETICS SPA', official_size_unfiltered: undefined } }),
      finder: {
        found: true,
        website: 'https://netics.cl',
        domain: 'netics.cl',
        verification: 'name_match',
        usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.04, pricingSource: 'table' },
      } as DomainFinderOutcome,
      classify: { industry: TECH, matches: true, employees: 57 },
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.d);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
  });
});
