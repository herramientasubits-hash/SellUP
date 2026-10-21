/**
 * El rescate no vuelve a pagar la búsqueda de web de una empresa que ya se buscó sin éxito
 * hace menos de 30 días (mismo número fiscal, o mismo nombre y país).
 *
 * Prod 21-10, árbol de Bimbo: Nicaragua, El Salvador, Colombia y Honduras se buscaron 3 a 5
 * veces el mismo día (US$0,04 cada vez) y nunca dieron una web nueva. Sin red ni base.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  pickRecentDomainSearch,
  RECENT_SEARCH_SKIP_REASON,
  type RecentDomainSearch,
  type RecentDomainSearchRow,
} from '../domain-search';
import { rescueBatchWithClaude, type RescueBatchDeps } from '../rescue-batch';
import type { RescuableDispositionRow } from '../rescue-dispositions';

const NOW = Date.parse('2026-10-21T17:11:00.000Z');
const AT = '2026-10-21T17:11:00.000Z';
const MODEL = 'claude-haiku-4-5-20251001';
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function previousRow(overrides: Partial<RecentDomainSearchRow> & { decision?: string; searchedAt?: string; skipped?: string } = {}): RecentDomainSearchRow {
  const { decision = 'website_not_found', searchedAt = iso(NOW - DAY), skipped, ...rest } = overrides;
  return {
    id: 'old-1',
    batch_id: 'b-old',
    name: 'BIMBO DE NICARAGUA SOCIEDAD ANONIMA',
    provider_identifier: 'tax:J0310000004080',
    evidence: {
      claude_rescue: { decision },
      claude_domain_search: { searched_at: searchedAt, found: false, reason: 'no_candidate', ...(skipped ? { skipped } : {}) },
    },
    ...rest,
  };
}

const TARGET = { id: 'd1', name: 'BIMBO DE NICARAGUA SOCIEDAD ANONIMA', taxId: 'J0310000004080' };

describe('A. pickRecentDomainSearch — qué búsqueda anterior vale', () => {
  it('mismo número fiscal, «sin web», hace un día ⇒ se copia', () => {
    const found = pickRecentDomainSearch(TARGET, [previousRow()], NOW);
    assert.deepEqual(found, { batchId: 'b-old', searchedAt: iso(NOW - DAY), decision: 'website_not_found', reason: 'no_candidate' });
  });

  it('«ya existía» también vale (volver a buscar daría lo mismo)', () => {
    assert.equal(pickRecentDomainSearch(TARGET, [previousRow({ decision: 'duplicate' })], NOW)?.decision, 'duplicate');
  });

  it('sin número fiscal: mismo nombre sin forma societaria ni signos', () => {
    const target = { id: 'd1', name: 'Bimbo de Honduras, S.A. de C.V.', taxId: null };
    const row = previousRow({ name: 'Bimbo de Honduras S.A. de C.V.', provider_identifier: 'corporate_tree:HN:bimbo de honduras' });
    assert.ok(pickRecentDomainSearch(target, [row], NOW));
  });

  it('no vale: hace más de 30 días, un error pasajero, otro número fiscal, la misma fila, o una que también se saltó', () => {
    assert.equal(pickRecentDomainSearch(TARGET, [previousRow({ searchedAt: iso(NOW - 31 * DAY) })], NOW), null);
    assert.equal(pickRecentDomainSearch(TARGET, [previousRow({ decision: 'retryable' })], NOW), null);
    assert.equal(pickRecentDomainSearch(TARGET, [previousRow({ provider_identifier: 'tax:999' })], NOW), null);
    assert.equal(pickRecentDomainSearch(TARGET, [previousRow({ id: 'd1' })], NOW), null);
    assert.equal(
      pickRecentDomainSearch(TARGET, [previousRow({ skipped: RECENT_SEARCH_SKIP_REASON })], NOW),
      null,
      'el plazo cuenta desde la última búsqueda PAGADA, no se encadena',
    );
  });

  it('con número fiscal en las dos, el nombre igual no basta si el número es otro', () => {
    assert.equal(pickRecentDomainSearch(TARGET, [previousRow({ provider_identifier: 'tax:OTRO' })], NOW), null);
  });

  it('gana la más reciente', () => {
    const found = pickRecentDomainSearch(
      TARGET,
      [previousRow({ batch_id: 'b-a', searchedAt: iso(NOW - 5 * DAY) }), previousRow({ id: 'old-2', batch_id: 'b-b', searchedAt: iso(NOW - DAY) })],
      NOW,
    );
    assert.equal(found?.batchId, 'b-b');
  });
});

function disposition(): RescuableDispositionRow {
  return {
    id: 'd1',
    batch_id: 'b1',
    candidate_id: null,
    status: 'discarded',
    name: 'BIMBO DE NICARAGUA SOCIEDAD ANONIMA',
    domain: null,
    country_code: 'NI',
    industry: 'Retail',
    reason_code: 'missing_domain_final',
    round_origin: 'free_source',
    provider_identifier: 'tax:J0310000004080',
    evidence: { provider_raw_name: 'BIMBO DE NICARAGUA SOCIEDAD ANONIMA', tax_identifier_present: true },
  } as RescuableDispositionRow;
}

function fakeDeps(findRecentSearch?: () => Promise<RecentDomainSearch | null>) {
  const evidence = new Map<string, Record<string, unknown>>();
  let searches = 0;
  const deps: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'test-key' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [{ industryId: 'retail', industryName: 'Retail', industryDescription: null, subindustries: [] }],
    loadReviewCandidates: async () => [],
    loadDispositions: async () => [disposition()],
    loadBatchIndustryId: async () => 'retail',
    classify: async () => {
      throw new Error('no debería clasificar');
    },
    logUsage: async () => true,
    patchCandidate: async () => false,
    patchDispositionEvidence: async (id, build) => {
      const next = build(evidence.get(id) ?? disposition().evidence);
      if (!next) return false;
      evidence.set(id, next);
      return true;
    },
    admitDisposition: async () => null,
    claimIdentities: async () => undefined,
    domainSearch: {
      findWebsite: async () => (searches++, {
        found: false as const,
        reason: 'no_candidate' as const,
        usage: {
          model: MODEL,
          inputTokens: 1,
          outputTokens: 1,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          webSearchRequests: 1,
          webFetchRequests: 0,
          estimatedCostUsd: 0.04,
          pricingSource: 'table' as const,
        },
      }),
      checkDuplicate: async () => ({ status: 'new_candidate', summary: 'Nueva' }),
      ...(findRecentSearch ? { findRecentSearch } : {}),
    },
    nowIso: () => AT,
    nowMs: () => NOW,
  };
  return { deps, evidence, searches: () => searches };
}

describe('B. el rescate con la búsqueda reciente', () => {
  const previous: RecentDomainSearch = { batchId: 'b-old', searchedAt: iso(NOW - DAY), decision: 'website_not_found', reason: 'no_candidate' };

  it('Bimbo de Nicaragua: ya buscada sin éxito ⇒ no se paga, queda «sin web» con el rastro de la anterior', async () => {
    const f = fakeDeps(async () => previous);
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.searches(), 0);
    assert.equal(s.ok && s.estimatedCostUsd, 0);
    assert.equal(s.ok && s.dispositionsKept, 1);
    const ev = f.evidence.get('d1')!;
    assert.equal((ev.claude_rescue as { decision: string }).decision, 'website_not_found');
    const search = ev.claude_domain_search as Record<string, unknown>;
    assert.equal(search.skipped, RECENT_SEARCH_SKIP_REASON);
    assert.equal(search.previous_batch_id, 'b-old');
    assert.equal(search.previous_decision, 'website_not_found');
  });

  it('sin búsqueda reciente ⇒ se busca y se paga como siempre', async () => {
    const f = fakeDeps(async () => null);
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.searches(), 1);
  });

  it('si la lectura falla ⇒ se busca como siempre (sólo se pierde el ahorro)', async () => {
    const f = fakeDeps(async () => {
      throw new Error('db down');
    });
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.searches(), 1);
  });
});

describe('C. cableado en vivo', () => {
  it('el rescate en vivo mira las búsquedas recientes de «Descartadas» del país', () => {
    const source = readFileSync(join(__dirname, '..', 'rescue-batch.server.ts'), 'utf8');
    assert.match(source, /findRecentSearch,/);
    assert.match(source, /\.from\('prospect_discarded_dispositions'\)[\s\S]*?\.eq\('country_code', input\.countryCode\)/);
  });
});
