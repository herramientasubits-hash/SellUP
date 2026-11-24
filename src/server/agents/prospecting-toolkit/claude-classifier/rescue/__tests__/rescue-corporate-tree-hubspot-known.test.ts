// Prod 24-11 (Grupo Aval 5989cf21): el árbol vio «Multi Financial Group, Inc.» con
// multibank.com.pa ya en HubSpot (ficha guardada con otra web). La fila hermana
// «Multi Financial Group (Multibank)» llegó sin web; el rescate encontró multibank.com.pa, la
// revisión por web no halló la ficha y la mandó a «Por revisar». Ahora el rescate usa lo que el
// árbol ya reconoció: es la misma empresa, se queda como referencia.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { rescueBatchWithClaude, withTreeHubSpotMatch, type RescueBatchDeps } from '../rescue-batch';
import type { RescuableDispositionRow } from '../rescue-dispositions';
import type { DomainFinderOutcome } from '../../domain-finder';
import type { SendToReviewOrigin } from '@/modules/prospect-discards/send-to-review-core';
import type { CompanyClassificationResult } from '../../types';

const NOW = Date.parse('2026-11-24T19:32:00.000Z');
const AT = '2026-11-24T19:32:00.000Z';
const MODEL = 'claude-haiku-4-5-20251001';
const USAGE = { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: 0, webFetchRequests: 0 };
const NEW = { status: 'new_candidate' as const, summary: 'Revisado: no hay otra empresa igual.' };

describe('A. la web que el árbol ya reconoció en HubSpot', () => {
  const ctx = { treeHubSpotDomains: new Set(['multibank.com.pa']), groupDomains: new Set(['grupoaval.com']) };

  it('Multibank: misma web que otra fila ya en HubSpot ⇒ «ya está en HubSpot»', () => {
    assert.equal(withTreeHubSpotMatch(NEW, 'multibank.com.pa', ctx).status, 'existing_in_hubspot');
    assert.equal(withTreeHubSpotMatch(NEW, 'www.multibank.com.pa', ctx).status, 'existing_in_hubspot');
  });

  it('otra web, la web del grupo, o ya duplicada ⇒ no cambia nada', () => {
    assert.deepEqual(withTreeHubSpotMatch(NEW, 'avvillas.com.co', ctx), NEW);
    const withGroup = { ...ctx, treeHubSpotDomains: new Set(['multibank.com.pa', 'grupoaval.com']) };
    assert.deepEqual(withTreeHubSpotMatch(NEW, 'grupoaval.com', withGroup), NEW);
    const dup = { status: 'existing_in_sellup' as const, summary: 'x' };
    assert.deepEqual(withTreeHubSpotMatch(dup, 'multibank.com.pa', ctx), dup);
  });

  it('fuera del árbol (sin webs) ⇒ no cambia nada', () => {
    assert.deepEqual(withTreeHubSpotMatch(NEW, 'multibank.com.pa', {}), NEW);
  });
});

function multibank(): RescuableDispositionRow {
  return {
    id: 'd-multibank',
    batch_id: 'b1',
    candidate_id: null,
    status: 'discarded',
    name: 'Multi Financial Group (Multibank)',
    domain: null,
    country_code: 'PA',
    industry: null,
    reason_code: 'missing_domain_final',
    round_origin: 'free_source',
    provider_identifier: 'corporate_tree:PA:multi financial group multibank',
    evidence: { provider_raw_name: 'Multi Financial Group (Multibank)', tax_identifier_present: false },
  } as RescuableDispositionRow;
}

const FOUND: DomainFinderOutcome = {
  found: true,
  website: 'https://multibank.com.pa',
  domain: 'multibank.com.pa',
  verification: 'search_result_match',
  inSearchResults: true,
  usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.01, pricingSource: 'table' },
} as DomainFinderOutcome;

function classified(company: { candidateId: string }): CompanyClassificationResult {
  return {
    candidateId: company.candidateId,
    outcome: 'classified',
    sector: {
      industryId: 'fin',
      industryName: 'Seguros y Servicios Financieros',
      subindustryId: null,
      subindustryName: null,
      matchesCurrentIndustry: null,
      quote: 'Somos un banco universal',
      sourceUrl: 'https://multibank.com.pa/',
      confidence: 0.95,
      verification: 'quote_verified',
    },
    employeeRange: { min: 1001, max: 5000, quote: 'De 1.001 a 5.000 empleados', sourceUrl: 'https://multibank.com.pa/', confidence: 0.9, verification: 'quote_verified', status: 'estimated' },
    rejected: [],
    isOperatingCompany: true,
    pageFinalUrl: 'https://multibank.com.pa/',
    usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.02, pricingSource: 'table' },
    errorCode: null,
    durationMs: 1000,
  } as unknown as CompanyClassificationResult;
}

function fakeDeps(treeHubSpotDomains: string[] | null) {
  const origins: SendToReviewOrigin[] = [];
  const evidence = new Map<string, Record<string, unknown>>();
  const row = multibank();
  const deps: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'test-key' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [{ industryId: 'fin', industryName: 'Seguros y Servicios Financieros', industryDescription: null, subindustries: [] }],
    loadReviewCandidates: async () => [],
    loadDispositions: async () => [row],
    loadBatchIndustryId: async () => null,
    loadBatchIsCorporateTree: async () => true,
    loadBatchGroupDomains: async () => ['grupoaval.com'],
    ...(treeHubSpotDomains ? { loadBatchTreeHubSpotDomains: async () => treeHubSpotDomains } : {}),
    classify: async (company) => classified(company),
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
      findWebsite: async () => FOUND,
      checkDuplicate: async () => NEW,
    },
    nowIso: () => AT,
    nowMs: () => NOW,
  };
  return { deps, origins, evidence };
}

describe('B. el rescate de Multibank', () => {
  it('el árbol ya la tiene en HubSpot con esa web ⇒ no entra a revisión', async () => {
    const f = fakeDeps(['multibank.com.pa']);
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.ok(s.ok);
    assert.equal(s.dispositionsAdmitted, 0);
    assert.equal(f.origins.length, 0);
  });

  it('control: sin esa ficha en el árbol, entra a revisión como antes', async () => {
    const f = fakeDeps(null);
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.ok(s.ok);
    assert.equal(s.dispositionsAdmitted, 1);
  });
});
