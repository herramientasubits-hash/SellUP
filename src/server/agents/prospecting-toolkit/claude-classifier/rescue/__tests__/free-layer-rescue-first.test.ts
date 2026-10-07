/**
 * AGENT1-FREE-LAYER-RESCUE-FIRST-1 — el rescate de las sin web del buscador gratuito
 * corre ANTES de Tavily, y sólo sobre ellas.
 *
 * Prod 07-10 (Bolivia × Tecnología 84ddefb7): el buscador gratuito trajo grandes
 * contribuyentes con NIT y sin web, Tavily llenó el lote hasta el tope de 10 y el
 * rescate nunca les buscó la web. Dobles en memoria; cero E/S.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  isFreeSourceMissingDomainDisposition,
  rescueBatchWithClaude,
  type RescueBatchDeps,
} from '../rescue-batch';
import type { RescuableDispositionRow } from '../rescue-dispositions';
import type { ClassifiableCandidateRow } from '../../classification-metadata';
import {
  FREE_LAYER_RESCUE_RESERVE_MS,
  FREE_LAYER_RESCUE_WINDOW_MS,
  TAVILY_FIRST_APOLLO_START_LIMIT_MS,
  resolveFreeLayerRescueWindowMs,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-tavily-first';

const AT = '2026-10-07T13:07:00.000Z';
const NOW = Date.parse(AT);

function disposition(overrides: Partial<RescuableDispositionRow> = {}): RescuableDispositionRow {
  return {
    id: 'd-zte',
    batch_id: 'b1',
    candidate_id: null,
    status: 'discarded',
    name: 'ZTE BOLIVIA S.R.L.',
    domain: null,
    country_code: 'BO',
    industry: 'Tecnología',
    reason_code: 'missing_domain_final',
    evidence: { tax_identifier_present: true },
    round_origin: 'free_source',
    provider_identifier: 'tax:154370023',
    ...overrides,
  };
}

function fakeDeps(dispositions: RescuableDispositionRow[], candidates: ClassifiableCandidateRow[] = []) {
  const searched: string[] = [];
  const classifiedCandidates: string[] = [];
  const deps: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: 'claude-test', apiKey: 'k' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [{ industryId: 'tec', industryName: 'Tecnología', industryDescription: null, subindustries: [] }],
    loadReviewCandidates: async () => candidates,
    loadDispositions: async () => dispositions,
    loadBatchIndustryId: async () => 'tec',
    classify: async (company) => {
      classifiedCandidates.push(company.candidateId);
      return {
        candidateId: company.candidateId,
        outcome: 'error',
        sector: null,
        employeeRange: null,
        rejected: [],
        isOperatingCompany: null,
        pageFinalUrl: null,
        usage: null,
        errorCode: 'model_error',
        durationMs: 1,
      } as unknown as Awaited<ReturnType<RescueBatchDeps['classify']>>;
    },
    logUsage: async () => true,
    patchCandidate: async () => false,
    patchDispositionEvidence: async () => true,
    admitDisposition: async (id) => `new-${id}`,
    claimIdentities: async () => undefined,
    domainSearch: {
      findWebsite: async (input) => {
        searched.push(input.name);
        return { found: false, reason: 'not_in_search_results', usage: null } as unknown as Awaited<
          ReturnType<NonNullable<RescueBatchDeps['domainSearch']>['findWebsite']>
        >;
      },
      checkDuplicate: async () => ({ status: 'new_candidate', summary: 'Nueva' }),
    },
    nowIso: () => AT,
    nowMs: () => NOW,
  };
  return { deps, searched, classifiedCandidates };
}

describe('qué filas entran en la pasada previa a Tavily', () => {
  it('sólo descartadas del buscador gratuito, sin web, por falta de web y con número fiscal', () => {
    assert.equal(isFreeSourceMissingDomainDisposition(disposition()), true);
    assert.equal(isFreeSourceMissingDomainDisposition(disposition({ round_origin: 'tavily' })), false);
    assert.equal(isFreeSourceMissingDomainDisposition(disposition({ round_origin: null })), false);
    assert.equal(isFreeSourceMissingDomainDisposition(disposition({ reason_code: 'existing_in_hubspot' })), false);
    assert.equal(isFreeSourceMissingDomainDisposition(disposition({ provider_identifier: 'gobbo:entel' })), false);
    assert.equal(isFreeSourceMissingDomainDisposition(disposition({ domain: 'zte.com' })), false);
  });

  it('con el modo encendido NO toca candidatas ni descartadas de Tavily/Apollo', async () => {
    const tavily = disposition({ id: 'd-tavily', name: 'Csirt360', round_origin: 'tavily', provider_identifier: null });
    const candidate = { id: 'c1' } as unknown as ClassifiableCandidateRow;
    const f = fakeDeps([disposition(), tavily], [candidate]);
    const summary = await rescueBatchWithClaude(
      { batchId: 'b1', triggeredBy: null, deadlineMs: 45_000, onlyFreeSourceMissingDomain: true },
      f.deps,
    );
    assert.equal(summary.ok, true);
    assert.deepEqual(f.searched.length, 1, 'sólo ZTE se busca');
    assert.equal(f.classifiedCandidates.includes('c1'), false, 'ninguna candidata se revisa');
  });

  it('sin el modo, el rescate de siempre no cambia (también busca la de Tavily)', async () => {
    const tavily = disposition({ id: 'd-tavily', name: 'Csirt360', round_origin: 'tavily', provider_identifier: null });
    const f = fakeDeps([disposition(), tavily]);
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: null }, f.deps);
    assert.equal(f.searched.length, 2);
  });
});

describe('cuándo y cuánto tiempo', () => {
  it('ventana corta (45 s) que deja 60 s a Tavily antes del límite de Apollo; sin tiempo, no corre', () => {
    assert.equal(resolveFreeLayerRescueWindowMs(10_000), FREE_LAYER_RESCUE_WINDOW_MS);
    const late = TAVILY_FIRST_APOLLO_START_LIMIT_MS - FREE_LAYER_RESCUE_RESERVE_MS - 20_000;
    assert.equal(resolveFreeLayerRescueWindowMs(late), 20_000);
    assert.equal(resolveFreeLayerRescueWindowMs(TAVILY_FIRST_APOLLO_START_LIMIT_MS - FREE_LAYER_RESCUE_RESERVE_MS - 5_000), null);
  });
});

describe('cableado en la búsqueda (AGENT1-FREE-LAYER-FIRST-1)', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts'),
    'utf8',
  );
  const layer = readFileSync(
    join(process.cwd(), 'src/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server.ts'),
    'utf8',
  );

  it('el asistente inyecta en la capa gratuita el rescate SÓLO de sus sin web, con la ventana corta', () => {
    const inject = src.slice(src.indexOf('rescueUnverifiedFreeLayer: async (batchId) => {'));
    assert.ok(inject.length > 0);
    assert.match(inject, /resolveFreeLayerRescueWindowMs\(Date\.now\(\) - actionStartedAtMs\)/);
    assert.match(inject, /onlyFreeSourceMissingDomain: true/);
  });

  it('en la capa: primero la capa gratuita, después el rescate (si mandó sin web a Descartadas), después el banco', () => {
    const run = layer.slice(layer.indexOf('export async function runPrePaidNoveltyDiscovery('), layer.indexOf('async function runFreeCatalogLayer('));
    const free = run.indexOf('await runFreeCatalogLayer(client, input, deps)');
    const rescue = run.indexOf('input.rescueUnverifiedFreeLayer(batchId)');
    const bank = run.indexOf('.drawCompanyBank({');
    assert.ok(free > 0 && rescue > free && bank > rescue);
    assert.match(run, /free\.telemetry\['unverified_sent_to_discards'\]/);
  });

  it('deja en el lote lo que decidió el rescate (free_layer_rescue_first)', () => {
    assert.match(src, /prePaidNovelty\?\.telemetry\?\.\['free_layer_rescue_first'\]/);
    assert.match(src, /free_layer_rescue_first: freeLayerRescueFirst/);
  });

  it('el rescate inline de Tavily no cambia: sigue devolviendo sí/no y revisa el lote entero', () => {
    assert.match(src, /rescueBatchInline\?: \(input: \{ batchId: string; windowMs: number \}\) => Promise<boolean>;/);
    assert.match(src, /\{ batchId, triggeredBy, deadlineMs: windowMs \},/);
  });
});
