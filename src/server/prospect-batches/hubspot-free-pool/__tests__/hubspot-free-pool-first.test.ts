/**
 * HUBSPOT-FREE-POOL-SOURCE-1 — las empresas libres de HubSpot corren PRIMERO en la
 * capa gratuita del Agente 1 (decisión de la dueña, 15-10).
 *
 *   · cierran la meta ⇒ ni registros oficiales ni banco ni pago;
 *   · aporte parcial ⇒ lo demás corre SÓLO por el hueco, en el mismo lote, con el
 *     tope de entrega descontado de lo que HubSpot escribió;
 *   · sin aporte (o sin lote canónico) ⇒ todo exactamente como antes;
 *   · el asistente y Competidores la cablean detrás de la bandera.
 *
 *   LIVE_PROVIDER_CALLS = 0 · CREDITS = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const TARGET = 5;

function freeCompany(i: number): CountrySourceCompany {
  return {
    recordIdentityKey: `siis:${i}`,
    legalName: `EMPRESA ${i}`,
    normalizedLegalName: `empresa ${i}`,
    taxId: null,
    taxIdentifierType: null,
    countryCode: 'CO',
    city: 'Bogotá',
    region: null,
    domain: `e${i}.com.co`,
    declaredIndustry: 'Manufactura',
    industryCode: '1011',
    coarseSector: null,
  } as unknown as CountrySourceCompany;
}

function freeHarness(companies: CountrySourceCompany[], maxDeliveredCandidates: number | null = 10) {
  const gateTargets: number[] = [];
  const persisted: Array<{ count: number; batchId: string | null | undefined }> = [];
  const deps: PrePaidNoveltyDiscoveryDeps = {
    maxDeliveredCandidates,
    runGate: async (gateInput) => {
      gateTargets.push(gateInput.requestedTarget);
      return {
        context: buildPrePaidNoveltyContext({
          requestedTarget: gateInput.requestedTarget,
          countryCode: 'CO',
          macroIndustryKey: 'industry_manufacturing_chemicals_automotive',
          freeSource: {
            sourceKey: 'co_siis',
            attempted: true,
            rawReturned: companies.length,
            macroConfirmed: companies.length,
            ambiguous: 0,
            rejected: 0,
            sellupKnown: 0,
            hubspotKnown: 0,
            acceptedNovel: companies.length,
            failed: false,
            failureCode: null,
          },
        }),
        exclusionPlan: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0 },
        providerExclusionPlan: planProviderExclusions('apollo', {}),
        providerSeen: PROVIDER_SEEN_LOAD_EMPTY,
        providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
        acceptedCompanies: companies,
        telemetry: {},
      } as unknown as PrePaidNoveltyGateResult;
    },
    persist: async (_client, input) => {
      persisted.push({ count: input.companies.length, batchId: input.batchId });
      return { batchId: input.batchId ?? 'b-free', writtenCount: input.companies.length, skippedCount: 0, failed: false };
    },
    recordUnverified: async (rows) => ({ attempted: rows.length, persisted: rows.length, failed: 0, errors: [] }),
  };
  return { gateTargets, persisted, deps };
}

async function runWith(
  deps: PrePaidNoveltyDiscoveryDeps,
  hubspot: { persisted: number; accepted: number } | null,
  options: { withCanonical?: boolean; bank?: { persisted: number; accepted: number } } = {},
) {
  const order: string[] = [];
  const bankTargets: number[] = [];
  const out = await runPrePaidNoveltyDiscovery(
    {} as unknown as SupabaseClient,
    {
      provider: 'apollo',
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'industry_manufacturing_chemicals_automotive',
      requestedTarget: TARGET,
      requestedByUserId: 'u-1',
      partialGapSupported: true,
      ...(options.withCanonical === false ? {} : { resolveBatchId: async () => 'b-canon' }),
      ...(hubspot
        ? {
            drawHubSpotFreePool: async () => {
              order.push('hubspot');
              return {
                batchId: hubspot.persisted > 0 ? 'b-canon' : null,
                persistedCount: hubspot.persisted,
                acceptedCount: hubspot.accepted,
                telemetry: { status: 'ok' },
              };
            },
          }
        : {}),
      ...(options.bank
        ? {
            drawCompanyBank: async (drawInput: { requestedTarget: number }) => {
              order.push('bank');
              bankTargets.push(drawInput.requestedTarget);
              return {
                batchId: 'b-canon',
                persistedCount: options.bank!.persisted,
                acceptedCount: options.bank!.accepted,
                telemetry: { status: 'ok' },
              };
            },
          }
        : {}),
    } as Parameters<typeof runPrePaidNoveltyDiscovery>[1],
    deps,
  );
  return { out, order, bankTargets };
}

describe('HubSpot libre primero en la capa gratuita', () => {
  it('cierra la meta ⇒ no corre nada más y no hace falta pagar', async () => {
    const h = freeHarness([freeCompany(1)]);
    const { out, order } = await runWith(h.deps, { persisted: 5, accepted: 5 }, { bank: { persisted: 1, accepted: 1 } });
    assert.deepEqual(order, ['hubspot']);
    assert.equal(h.gateTargets.length, 0);
    assert.equal(out.providerRequired, false);
    assert.equal(out.residualGap, 0);
    assert.equal(out.acceptedBeforeProvider, TARGET);
    assert.equal(out.batchId, 'b-canon');
    assert.ok(out.telemetry['hubspot_free_pool_first']);
  });

  it('aporte parcial ⇒ registros y banco por el hueco, mismo lote, tope descontado', async () => {
    const h = freeHarness([1, 2, 3, 4, 5, 6, 7, 8, 9].map(freeCompany), 10);
    const { out, order, bankTargets } = await runWith(h.deps, { persisted: 4, accepted: 2 }, { bank: { persisted: 1, accepted: 1 } });
    assert.deepEqual(h.gateTargets, [TARGET - 2]);
    // tope 10 − 4 que escribió HubSpot = 6 filas como máximo para la capa oficial
    assert.deepEqual(h.persisted, [{ count: 6, batchId: 'b-canon' }]);
    assert.equal(order[0], 'hubspot');
    assert.equal(out.requestedTarget, TARGET);
    assert.equal(out.acceptedBeforeProvider, TARGET);
    assert.equal(out.residualGap, 0);
    assert.equal(out.persistedCount, 4 + 6);
    assert.equal(bankTargets.length, 0);
  });

  it('aporte parcial que no se completa ⇒ el hueco que queda es el de pago', async () => {
    const h = freeHarness([freeCompany(1)], 10);
    const { out } = await runWith(h.deps, { persisted: 2, accepted: 2 });
    assert.equal(out.acceptedBeforeProvider, 3);
    assert.equal(out.residualGap, TARGET - 3);
    assert.equal(out.providerRequired, true);
  });

  it('sin aporte ⇒ exactamente como antes (registros con la meta entera)', async () => {
    const h = freeHarness([freeCompany(1)]);
    const { out, order } = await runWith(h.deps, { persisted: 0, accepted: 0 });
    assert.deepEqual(order, ['hubspot']);
    assert.deepEqual(h.gateTargets, [TARGET]);
    assert.equal(out.acceptedBeforeProvider, 1);
  });

  it('sin lote canónico (ruta Lusha) ⇒ HubSpot no corre', async () => {
    const h = freeHarness([freeCompany(1)]);
    const { order } = await runWith(h.deps, { persisted: 5, accepted: 5 }, { withCanonical: false });
    assert.deepEqual(order, []);
    assert.deepEqual(h.gateTargets, [TARGET]);
  });
});

describe('cableado detrás de la bandera', () => {
  const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

  it('el asistente y Competidores lo inyectan; la bandera lo apaga', () => {
    const wizard = read('src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts');
    assert.match(wizard, /drawHubSpotFreePool:\s*\n?\s*resolveProductionHubSpotFreePoolDrawer\(/);
    const competitors = read('src/server/prospect-batches/competitor-search/competitor-free-sources.server.ts');
    assert.match(competitors, /drawHubSpotFreePool: \(drawInput\) =>/);
    const server = read('src/server/prospect-batches/hubspot-free-pool/hubspot-free-pool-draw.server.ts');
    assert.match(server, /if \(!isHubSpotFreePoolEnabled\(\)\) return null;/);
    const checker = read('src/server/agents/prospecting-toolkit/hubspot-duplicate-checker.ts');
    assert.match(checker, /if \(isHubSpotFreePoolEnabled\(\)\) \{/);
  });

  it('la aprobación nunca crea en HubSpot una empresa libre: la enlaza', () => {
    const actions = read('src/modules/prospect-batches/actions.ts');
    assert.match(actions, /if \(hsStatus === 'match' \|\| linkedHubSpotCompanyId\) \{/);
    assert.match(actions, /hsStatus === 'possible_match' \|\| blocksHubSpotCreate\(freePoolLink\)/);
  });
});
