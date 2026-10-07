/**
 * AGENT1-RESCUE-KNOWN-COMPANY-GUARD-1 — el rescate no admite como nueva una empresa
 * que SellUp ya tiene por otro camino, aunque Claude le haya encontrado OTRA web.
 *
 * Prod 07-10, Ecuador × Retail (b899ce30): «Pycca» (pycca.com, Tavily) quedó
 * duplicada en el lote; «PYCCA S.A.» (capa gratuita) recibió polipapel.com, pasó el
 * control por web y entró a revisión. Sin red ni base: todo es un doble.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { companyNameCoreForDuplicates, findKnownCompanyMatch } from '../known-company-guard';
import { rescueBatchWithClaude, type RescueBatchDeps } from '../rescue-batch';
import type { RescuableDispositionRow } from '../rescue-dispositions';
import type { SendToReviewOrigin } from '@/modules/prospect-discards/send-to-review-core';
import type { CompanyClassificationResult } from '../../types';

const NOW = Date.parse('2026-10-07T05:00:00.000Z');
const AT = '2026-10-07T05:00:00.000Z';
const MODEL = 'claude-haiku-4-5-20251001';
const RETAIL = 'Retail';
const USAGE = {
  inputTokens: 100,
  outputTokens: 50,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  webSearchRequests: 0,
  webFetchRequests: 0,
};

describe('A. el nombre base para comparar', () => {
  it('quita la forma societaria de cualquier país, tildes y signos', () => {
    assert.equal(companyNameCoreForDuplicates('PYCCA S.A.'), 'PYCCA');
    assert.equal(companyNameCoreForDuplicates('Pycca'), 'PYCCA');
    assert.equal(companyNameCoreForDuplicates('Almacenes Juan Eljuri Cía. Ltda.'), 'ALMACENES JUAN ELJURI');
    assert.equal(companyNameCoreForDuplicates('Grupo Bimbo, S.A.B. de C.V.'), companyNameCoreForDuplicates('GRUPO BIMBO'));
  });
});

describe('B. findKnownCompanyMatch', () => {
  const pyccaTavily = { name: 'Pycca', tax_identifier: null, status: 'duplicate' };

  it('el mismo nombre base ya está en el lote (en cualquier estado) ⇒ conocida', () => {
    const match = findKnownCompanyMatch({ names: ['PYCCA S.A.'], taxId: '0990000530001', batchRows: [pyccaTavily], taxRows: [] });
    assert.equal(match?.status, 'existing_in_sellup');
    assert.match(match?.summary ?? '', /Pycca/);
  });

  it('el mismo número fiscal vivo en otro lote ⇒ conocida', () => {
    const match = findKnownCompanyMatch({
      names: ['Otra razón social'],
      taxId: '0990000530001',
      batchRows: [],
      taxRows: [{ name: 'PYCCA S.A.', tax_identifier: '0990000530001', status: 'needs_review' }],
    });
    assert.equal(match?.status, 'existing_in_sellup');
    assert.match(match?.summary ?? '', /0990000530001/);
  });

  it('nombres distintos y sin número fiscal compartido ⇒ nueva', () => {
    assert.equal(
      findKnownCompanyMatch({ names: ['PYCCA S.A.'], taxId: '0990000530001', batchRows: [{ name: 'Comercial Kywi', tax_identifier: null, status: 'duplicate' }], taxRows: [] }),
      null,
    );
  });

  it('un nombre base demasiado corto no basta para declarar duplicado', () => {
    assert.equal(
      findKnownCompanyMatch({ names: ['GM S.A.'], taxId: null, batchRows: [{ name: 'GM', tax_identifier: null, status: 'needs_review' }], taxRows: [] }),
      null,
    );
  });
});

function disposition(overrides: Partial<RescuableDispositionRow> = {}): RescuableDispositionRow {
  return {
    id: 'd1',
    batch_id: 'b1',
    candidate_id: null,
    status: 'discarded',
    name: 'PYCCA S.A.',
    domain: null,
    country_code: 'EC',
    industry: RETAIL,
    reason_code: 'missing_domain_final',
    round_origin: 'free_source',
    provider_identifier: 'tax:0990000530001',
    evidence: { provider_raw_name: 'PYCCA S.A.', tax_identifier_present: true, tax_identifier_type: 'RUC' },
    ...overrides,
  } as RescuableDispositionRow;
}

function classified(company: { candidateId: string }): CompanyClassificationResult {
  return {
    candidateId: company.candidateId,
    outcome: 'classified',
    sector: {
      industryId: 'retail',
      industryName: RETAIL,
      subindustryId: null,
      subindustryName: null,
      matchesCurrentIndustry: true,
      quote: 'Cadena de tiendas por departamentos',
      sourceUrl: 'https://polipapel.com/',
      confidence: 0.9,
      verification: 'quote_verified',
    },
    employeeRange: null,
    rejected: [],
    isOperatingCompany: true,
    pageFinalUrl: 'https://polipapel.com/',
    usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.02, pricingSource: 'table' },
    errorCode: null,
    durationMs: 1000,
  };
}

function fakeDeps(findKnownCompany: NonNullable<RescueBatchDeps['domainSearch']>['findKnownCompany']) {
  const evidence = new Map<string, Record<string, unknown>>();
  const origins: SendToReviewOrigin[] = [];
  const asked: Array<{ batchId: string; taxId: string | null; names: readonly string[] }> = [];
  let classifiedCount = 0;
  const deps: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'test-key' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [{ industryId: 'retail', industryName: RETAIL, industryDescription: null, subindustries: [] }],
    loadReviewCandidates: async () => [],
    loadDispositions: async () => [disposition()],
    loadBatchIndustryId: async () => 'retail',
    classify: async (company) => (classifiedCount++, classified(company)),
    logUsage: async () => true,
    patchCandidate: async () => false,
    patchDispositionEvidence: async (id, build) => {
      const next = build(evidence.get(id) ?? disposition().evidence);
      if (!next) return false;
      evidence.set(id, next);
      return true;
    },
    admitDisposition: async (id, origin) => (origins.push(origin), `new-${id}`),
    claimIdentities: async () => undefined,
    domainSearch: {
      findWebsite: async () => ({
        found: true as const,
        website: 'https://polipapel.com',
        domain: 'polipapel.com',
        verification: 'name_match' as const,
        inSearchResults: true,
        usage: { model: MODEL, ...USAGE, estimatedCostUsd: 0.013, pricingSource: 'table' as const },
      }),
      checkDuplicate: async () => ({ status: 'new_candidate', summary: 'Nueva' }),
      ...(findKnownCompany
        ? {
            findKnownCompany: async (input: { batchId: string; taxId: string | null; names: readonly string[] }) => {
              asked.push(input);
              return findKnownCompany(input);
            },
          }
        : {}),
    },
    nowIso: () => AT,
    nowMs: () => NOW,
  };
  return { deps, evidence, origins, asked, classified: () => classifiedCount };
}

describe('C. el rescate con la comprobación', () => {
  it('Pycca: la web nueva pasó el control por web, pero el lote ya la tiene ⇒ se queda en Descartadas, sin clasificar', async () => {
    const f = fakeDeps(async (input) =>
      findKnownCompanyMatch({
        names: input.names,
        taxId: input.taxId,
        batchRows: [{ name: 'Pycca', tax_identifier: null, status: 'duplicate' }],
        taxRows: [],
      }),
    );
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 0);
    assert.equal(s.ok && s.dispositionsKept, 1);
    assert.equal(f.origins.length, 0);
    assert.equal(f.classified(), 0);
    assert.deepEqual(f.asked, [{ batchId: 'b1', taxId: '0990000530001', names: ['PYCCA S.A.', 'PYCCA S.A.'] }]);
    const ev = f.evidence.get('d1')!;
    assert.equal((ev.claude_rescue as { decision: string }).decision, 'duplicate');
    assert.equal((ev.claude_domain_search as { duplicate_status: string }).duplicate_status, 'existing_in_sellup');
  });

  it('desconocida ⇒ entra como siempre', async () => {
    const f = fakeDeps(async () => null);
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
  });

  it('si la lectura falla, no bloquea (el control por web ya pasó)', async () => {
    const f = fakeDeps(async () => {
      throw new Error('boom');
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
  });

  it('sin la comprobación cableada, el comportamiento de antes', async () => {
    const f = fakeDeps(undefined);
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
  });
});

describe('D. cableado en vivo', () => {
  it('el rescate en vivo usa la comprobación: lote en cualquier estado + número fiscal vivo', () => {
    const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const server = strip(
      readFileSync(
        join(process.cwd(), 'src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.server.ts'),
        'utf8',
      ),
    );
    assert.match(server, /checkDuplicate: checkDuplicateStrict,\s*findKnownCompany,/);
    assert.match(server, /\.eq\('batch_id', input\.batchId\)\s*\.limit\(KNOWN_COMPANY_BATCH_ROWS\)/);
    assert.match(server, /\.eq\('tax_identifier', input\.taxId\)\s*\.in\('status', \[\.\.\.BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES\]\)/);
  });
});
