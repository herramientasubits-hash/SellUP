/**
 * AGENT1-RESCUE-SUBSIDIARY-WITHOUT-WEB-1 — dueña 07-10: «sí, pero sólo si es un buen
 * prospecto, no cualquiera sin web». Prod 07-10, Costa Rica × Servicios (47f4c893):
 * AMAZON SUPPORT SERVICES COSTA RICA → amazon.com y DOLE SHARED SERVICES → dole.com se
 * quedaban en Descartadas (`identity_not_confirmed`: la portada de la matriz no nombra a
 * la filial). Ahora entran a revisión SIN web cuando la fuente oficial dice que son
 * grandes, el dominio es la marca de su razón social, no son duplicadas y Claude confirma
 * la industria en la web de la matriz. Sin red ni base: todo es un doble.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parentGroupWebsite } from '../domain-search';
import { isOfficiallyLargeFreeLayerRow, rescueBatchWithClaude, type RescueBatchDeps } from '../rescue-batch';
import type { RescuableDispositionRow } from '../rescue-dispositions';
import type { DomainFinderOutcome } from '../../domain-finder';
import type { SendToReviewOrigin } from '@/modules/prospect-discards/send-to-review-core';
import type { CompanyClassificationResult } from '../../types';

const NOW = Date.parse('2026-10-07T16:00:00.000Z');
const AT = '2026-10-07T16:00:00.000Z';
const MODEL = 'claude-haiku-4-5-20251001';
const SERVICES = 'Compañía de Servicios';
const USAGE = { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: 0, webFetchRequests: 0 };
const LARGE_BAND = { band: 'large', source_label: 'Hacienda – Grandes Contribuyentes' };

function amazon(overrides: Partial<RescuableDispositionRow> = {}): RescuableDispositionRow {
  return {
    id: 'd1',
    batch_id: 'b1',
    candidate_id: null,
    status: 'discarded',
    name: 'AMAZON SUPPORT SERVICES COSTA RICA S.R.L.',
    domain: null,
    country_code: 'CR',
    industry: SERVICES,
    reason_code: 'missing_domain_final',
    round_origin: 'free_source',
    provider_identifier: 'tax:3102474379',
    evidence: {
      provider_raw_name: 'AMAZON SUPPORT SERVICES COSTA RICA S.R.L.',
      tax_identifier_present: true,
      tax_identifier_type: 'cedula_juridica',
      official_size_band: LARGE_BAND,
    },
    ...overrides,
  } as RescuableDispositionRow;
}

const NOT_CONFIRMED: DomainFinderOutcome = {
  found: false,
  reason: 'identity_not_confirmed',
  claimedUrl: 'https://www.amazon.com',
  usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.013, pricingSource: 'table' },
};

describe('A. la web de la matriz', () => {
  it('Amazon, Dole y Kimberly-Clark: el dominio es la marca de su razón social', () => {
    assert.deepEqual(parentGroupWebsite(amazon(), NOT_CONFIRMED), { website: 'https://amazon.com', domain: 'amazon.com' });
    const dole = amazon({ name: 'DOLE SHARED SERVICES LIMITED', evidence: { ...amazon().evidence, provider_raw_name: 'DOLE SHARED SERVICES LIMITED' } });
    assert.equal(parentGroupWebsite(dole, { ...NOT_CONFIRMED, claimedUrl: 'https://www.dole.com' })?.domain, 'dole.com');
    const kc = amazon({ name: 'KIMBERLY – CLARK TRADING AND SERVICES LIMITADA', evidence: { ...amazon().evidence, provider_raw_name: 'KIMBERLY – CLARK TRADING AND SERVICES LIMITADA' } });
    assert.equal(parentGroupWebsite(kc, { ...NOT_CONFIRMED, claimedUrl: 'https://www.kimberly-clark.com' })?.domain, 'kimberly-clark.com');
  });

  it('no: la matriz con otro nombre (B.A.T.O. → bridgestoneamericas.com), otro motivo, sin número fiscal, gobierno', () => {
    const bato = amazon({ name: 'B.A.T.O. SHARED SERVICES S.A.', evidence: { ...amazon().evidence, provider_raw_name: 'B.A.T.O. SHARED SERVICES S.A.' } });
    assert.equal(parentGroupWebsite(bato, { ...NOT_CONFIRMED, claimedUrl: 'https://www.bridgestoneamericas.com' }), null);
    assert.equal(parentGroupWebsite(amazon(), { ...NOT_CONFIRMED, reason: 'no_candidate', claimedUrl: null }), null);
    assert.equal(parentGroupWebsite(amazon(), { ...NOT_CONFIRMED, reason: 'not_in_search_results' }), null);
    assert.equal(parentGroupWebsite(amazon({ evidence: { provider_raw_name: 'AMAZON SUPPORT SERVICES COSTA RICA S.R.L.' } }), NOT_CONFIRMED), null);
    assert.equal(parentGroupWebsite(amazon(), { ...NOT_CONFIRMED, claimedUrl: 'https://amazon.gob.cr' }), null);
  });
});

describe('B. «grande» según la fuente oficial', () => {
  it('marca por tramo, trabajadores ≥ umbral, o fuente que ya filtra por tamaño', () => {
    assert.equal(isOfficiallyLargeFreeLayerRow(amazon()), true);
    assert.equal(
      isOfficiallyLargeFreeLayerRow(amazon({ evidence: { tax_identifier_present: true, official_workforce: { workers: 900, year: 2025, source_label: 'X' } } })),
      true,
    );
    assert.equal(isOfficiallyLargeFreeLayerRow(amazon({ country_code: 'EC', evidence: { tax_identifier_present: true } })), true);
  });

  it('sin dato de tamaño, pequeña o fuera de la capa gratuita: no', () => {
    assert.equal(isOfficiallyLargeFreeLayerRow(amazon({ evidence: { tax_identifier_present: true } })), false);
    assert.equal(
      isOfficiallyLargeFreeLayerRow(amazon({ evidence: { tax_identifier_present: true, official_workforce: { workers: 40, year: 2025, source_label: 'X' } } })),
      false,
    );
    assert.equal(isOfficiallyLargeFreeLayerRow(amazon({ round_origin: 'round_1' })), false);
  });
});

function classified(company: { candidateId: string }, matches = true): CompanyClassificationResult {
  return {
    candidateId: company.candidateId,
    outcome: 'classified',
    sector: {
      industryId: 'services',
      industryName: matches ? SERVICES : 'Retail',
      subindustryId: null,
      subindustryName: null,
      matchesCurrentIndustry: matches,
      quote: 'Customer service and business operations',
      sourceUrl: 'https://amazon.com/',
      confidence: 0.9,
      verification: 'quote_verified',
    },
    employeeRange: { min: 10001, max: null, quote: '1.5M employees', sourceUrl: 'https://amazon.com/', confidence: 0.9, verification: 'quote_verified', status: 'estimated' },
    rejected: [],
    isOperatingCompany: true,
    pageFinalUrl: 'https://amazon.com/',
    usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.02, pricingSource: 'table' },
    errorCode: null,
    durationMs: 1000,
  } as unknown as CompanyClassificationResult;
}

function fakeDeps(opts: { row?: RescuableDispositionRow; duplicate?: string; sectorMatches?: boolean } = {}) {
  const evidence = new Map<string, Record<string, unknown>>();
  const origins: SendToReviewOrigin[] = [];
  const dupInputs: unknown[] = [];
  const row = opts.row ?? amazon();
  const deps: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'test-key' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [{ industryId: 'services', industryName: SERVICES, industryDescription: null, subindustries: [] }],
    loadReviewCandidates: async () => [],
    loadDispositions: async () => [row],
    loadBatchIndustryId: async () => 'services',
    classify: async (company) => classified(company, opts.sectorMatches !== false),
    logUsage: async () => true,
    patchCandidate: async () => false,
    patchDispositionEvidence: async (id, build) => {
      const next = build(evidence.get(id) ?? row.evidence);
      if (!next) return false;
      evidence.set(id, next);
      return true;
    },
    admitDisposition: async (id, origin) => (origins.push(origin), `new-${id}`),
    claimIdentities: async () => undefined,
    domainSearch: {
      findWebsite: async () => NOT_CONFIRMED,
      checkDuplicate: async (input) => (dupInputs.push(input), { status: (opts.duplicate ?? 'new_candidate') as never, summary: '' }),
    },
    nowIso: () => AT,
    nowMs: () => NOW,
  };
  return { deps, evidence, origins, dupInputs };
}

describe('C. el rescate', () => {
  it('Amazon CR grande + matriz amazon.com + industria confirmada ⇒ a revisión SIN web, con su número fiscal', async () => {
    const f = fakeDeps();
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
    const origin = f.origins[0];
    const columns = origin.columns ?? {};
    assert.equal(columns.domain, undefined, 'la web global nunca es la del candidato');
    assert.equal(columns.website, undefined);
    assert.equal(columns.employee_count, undefined, 'los empleados de la matriz no son de la filial');
    assert.equal(columns.name, 'AMAZON SUPPORT SERVICES COSTA RICA S.R.L.');
    assert.deepEqual(
      { ...(origin.metadata.parent_group_website as Record<string, unknown>), searched_at: undefined },
      { website: 'https://amazon.com', domain: 'amazon.com', web_pending: true, searched_at: undefined },
    );
    assert.equal(origin.metadata.icp_size_gate, undefined);
    assert.match(origin.reviewNote, /sin web propia/);
    // El duplicado se revisa por NOMBRE, nunca con el dominio global.
    assert.deepEqual(f.dupInputs, [{ name: 'AMAZON SUPPORT SERVICES COSTA RICA S.R.L.', website: null, domain: null, countryCode: 'CR' }]);
  });

  it('sin dato oficial de tamaño ⇒ se queda en Descartadas («no cualquiera sin web»)', async () => {
    const f = fakeDeps({ row: amazon({ evidence: { ...amazon().evidence, official_size_band: undefined } }) });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 0);
    assert.equal(f.origins.length, 0);
  });

  it('duplicada en SellUp/HubSpot ⇒ se queda, con la web de la matriz como referencia', async () => {
    const f = fakeDeps({ duplicate: 'existing_in_hubspot' });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsKept, 1);
    assert.equal(f.origins.length, 0);
    const ev = f.evidence.get('d1')!;
    assert.equal((ev.parent_group_website as { duplicate_status: string }).duplicate_status, 'existing_in_hubspot');
  });

  it('Claude no confirma la industria pedida ⇒ se queda', async () => {
    const f = fakeDeps({ sectorMatches: false });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 0);
    assert.equal(f.origins.length, 0);
  });
});
