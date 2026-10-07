/**
 * AGENT1-DELIVERY-CAP-HARD-1 — «mínimo 5 y máximo 10 por búsqueda; el resto va al
 * banco» (dueña, 07-10-2026). Lo que el tope deja fuera de una búsqueda web (Tavily,
 * «Claude busca empresas») entra al banco; el asistente no paga Apollo con el lote
 * lleno. Puro + guardas estáticas del cableado. Cero E/S.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DeliveryCappedCompany } from '@/server/agents/prospecting-toolkit/types';
import { planWebBankDeposit } from '../web-company-bank-deposit';
import { PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND, readBankPipelineCandidate } from '../pipeline-candidate-bank-payload';
import { isLotAtDeliveryCap } from '@/modules/prospect-batches/chat-wizard-execution/wizard-tavily-first';

function capped(name: string, domain: string | null, overrides: Partial<DeliveryCappedCompany> = {}): DeliveryCappedCompany {
  return {
    name,
    domain,
    linkedinUrl: null,
    countryCode: 'PE',
    providerOrganizationId: null,
    countsTowardTarget: false,
    claims: domain ? [{ type: 'domain', key: `domain:${domain}` }] : [],
    bankCandidate: {
      name,
      website: domain ? `https://${domain}` : null,
      domain,
      country: 'Perú',
      countryCode: 'PE',
      industry: 'Gobierno',
      sourceUrl: null,
      sourceTitle: null,
      sourceSnippet: null,
      websiteVerification: null,
      duplicateCheck: null,
      scoring: {
        confidenceScore: 0.8,
        fitScore: 0.8,
        dataCompletenessScore: 0.8,
        qualityLabel: 'high',
        recommendedAction: 'review',
        breakdown: {},
        reasons: [],
        warnings: [],
        blockers: [],
      },
    },
    ...overrides,
  } as unknown as DeliveryCappedCompany;
}

describe('planWebBankDeposit', () => {
  it('lo recortado con dominio, reclamo y candidato entra al banco como origen web, listo para volver a escribirse', () => {
    const plan = planWebBankDeposit({
      countryCode: 'PE',
      macroIndustryKey: 'government',
      sourceBatchId: 'b-1',
      requestedSubindustries: ['Municipalidades'],
      capped: [capped('Municipalidad de Tacna', 'munitacna.gob.pe', { countsTowardTarget: true }), capped('Gobierno Regional Cusco', 'regioncusco.gob.pe')],
    });
    assert.equal(plan.notBankable.length, 0);
    assert.equal(plan.items.length, 2);
    const [ready, toComplete] = plan.items;
    assert.equal(ready.sourceProvider, 'tavily');
    assert.equal(ready.tier, 'ready');
    assert.deepEqual(ready.missingFields, []);
    assert.equal(toComplete.tier, 'to_complete');
    assert.deepEqual(toComplete.missingFields, ['target_conditions']);
    assert.equal(ready.countryCode, 'PE');
    assert.equal(ready.macroIndustryKey, 'government');
    assert.equal(ready.sourceBatchId, 'b-1');
    assert.equal((ready.payload as Record<string, unknown>).kind, PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND);
    // El banco primero sabe leerlo tal cual.
    assert.equal(readBankPipelineCandidate(ready.payload)?.domain, 'munitacna.gob.pe');
  });

  it('sin dominio, sin reclamo o sin candidato no entra (se pierde como antes)', () => {
    const plan = planWebBankDeposit({
      countryCode: 'PE',
      macroIndustryKey: 'government',
      sourceBatchId: 'b-1',
      capped: [
        capped('Sin web', null),
        capped('Sin reclamo', 'x.pe', { claims: [] }),
        capped('Sin candidato', 'y.pe', { bankCandidate: undefined }),
      ],
    });
    assert.equal(plan.items.length, 0);
    assert.equal(plan.notBankable.length, 3);
  });

  it('sin macro industria o con país inválido no deposita nada', () => {
    for (const input of [
      { countryCode: 'PE', macroIndustryKey: null },
      { countryCode: 'peru', macroIndustryKey: 'government' },
    ]) {
      const plan = planWebBankDeposit({ ...input, sourceBatchId: 'b', capped: [capped('A', 'a.pe')] });
      assert.equal(plan.items.length, 0);
      assert.equal(plan.notBankable.length, 1);
    }
  });
});

describe('el asistente no paga Apollo con el lote lleno', () => {
  it('isLotAtDeliveryCap: 10 de 10 está lleno; sin tope o sin conteo, no', () => {
    assert.equal(isLotAtDeliveryCap(10, 10), true);
    assert.equal(isLotAtDeliveryCap(12, 10), true);
    assert.equal(isLotAtDeliveryCap(9, 10), false);
    assert.equal(isLotAtDeliveryCap(null, 10), false);
    assert.equal(isLotAtDeliveryCap(10, null), false);
  });
});

describe('guardas estáticas del cableado', () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));

  it('Tavily y «Claude busca empresas» guardan su sobrante en el banco', () => {
    const tavily = read('src/server/agents/prospecting-toolkit/incremental-search.ts');
    assert.match(tavily, /if \(!isApolloProvider && writerOutput\.status !== 'failed'\) \{\s*await depositWebSurplusToBank\(/);
    assert.match(tavily, /capped: writerOutput\.deliveryCappedCompanies/);
    const claude = read('src/server/agents/prospecting-toolkit/claude-classifier/company-search-run.server.ts');
    assert.match(claude, /await depositWebSurplusToBank\(\{[\s\S]*?capped: output\.deliveryCappedCompanies/);
  });

  it('con el lote en el tope, el tramo de Tavily cierra la corrida sin Apollo ni Lusha', () => {
    const wizard = read('src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts');
    assert.match(wizard, /if \(isLotAtDeliveryCap\(lotReviewableNow, deliveryCap\)\) \{\s*tavilyFirstOutcome = \{\s*outcome: 'lot_at_delivery_cap'/);
    assert.match(wizard, /tavilyFirstOutcome\?\.outcome === 'lot_at_delivery_cap'\) &&/);
    assert.match(wizard, /reason: 'tavily_first_lot_at_delivery_cap'/);
  });

  it('el rescate cuenta los lugares libres con los MISMOS estados que el escritor', () => {
    const server = read('src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.server.ts');
    assert.match(server, /deliverySlots: async \(batchId\) => \{[\s\S]*?\.in\('status', \[\.\.\.BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES\]\)/);
    const core = read('src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.ts');
    assert.match(core, /rescueDispositionWithinCap\(item\.row, ctx, deps, admittedIds\)/);
  });
});
