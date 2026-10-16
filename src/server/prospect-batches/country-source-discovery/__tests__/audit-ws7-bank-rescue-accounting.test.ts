/**
 * AUDIT-A1-WS7 (16-10) — capa gratuita + rescate + banco:
 *
 *   · con banco, `persistedCount` sumaba `free` y no `freeWithRescue`: las sin web
 *     que el rescate de Claude devolvió a revisión desaparecían de lo escrito por
 *     la capa gratuita (y se atribuían a la ruta de pago);
 *   · el banco escribía con `subindustries: []`: una búsqueda con subindustrias
 *     cerraba la meta con empresas genéricas de la macro. Ahora viajan al escritor.
 *
 *   LIVE_PROVIDER_CALLS = 0 · CREDITS = 0 · PRODUCTION_WRITES = 0
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '../run-prepaid-novelty-discovery.server';
import type { CountrySourceCompany } from '../country-source-types';
import type { PrePaidNoveltyGateResult } from '../run-prepaid-novelty-gate';
import { buildBankPipelineOutput, type BankFirstDrawInput } from '../../company-bank/prepaid-bank-draw.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';

const TARGET = 6;

function company(i: number, domain: string | null): CountrySourceCompany {
  return {
    recordIdentityKey: `tax:90${i}`,
    legalName: `EMPRESA ${i}`,
    normalizedLegalName: `empresa ${i}`,
    taxId: `90${i}`,
    taxIdentifierType: 'nit',
    countryCode: 'CO',
    city: null,
    region: null,
    domain,
    declaredIndustry: 'Tecnología',
    industryCode: '6201',
    coarseSector: null,
  } as unknown as CountrySourceCompany;
}

function deps(companies: CountrySourceCompany[]): PrePaidNoveltyDiscoveryDeps {
  return {
    maxDeliveredCandidates: 10,
    runGate: async (gateInput) =>
      ({
        context: buildPrePaidNoveltyContext({
          requestedTarget: gateInput.requestedTarget,
          countryCode: 'CO',
          macroIndustryKey: 'technology',
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
      }) as unknown as PrePaidNoveltyGateResult,
    persist: async (_client, input) => ({
      batchId: input.batchId ?? 'b-canon',
      writtenCount: input.companies.length,
      skippedCount: 0,
      failed: false,
    }),
    recordUnverified: async (rows) => ({ attempted: rows.length, persisted: rows.length, failed: 0, errors: [] }),
  };
}

describe('AUDIT-A1-WS7 — rescate + banco', () => {
  it('las rescatadas cuentan en persistedCount también cuando corre el banco', async () => {
    // 2 con web (se escriben) + 3 sin web (van a Descartadas y el rescate admite 2).
    const companies = [company(1, 'e1.com.co'), company(2, 'e2.com.co'), company(3, null), company(4, null), company(5, null)];
    const bankCalls: BankFirstDrawInput[] = [];
    const out = await runPrePaidNoveltyDiscovery(
      {} as unknown as SupabaseClient,
      {
        provider: 'apollo',
        countryCode: 'CO',
        countryName: 'Colombia',
        macroIndustryKey: 'technology',
        requestedTarget: TARGET,
        requestedByUserId: 'u-1',
        partialGapSupported: true,
        resolveBatchId: async () => 'b-canon',
        subindustries: ['Ciberseguridad'],
        rescueUnverifiedFreeLayer: async () => ({ ran: true, ok: true, admitted: 2 }),
        drawCompanyBank: async (drawInput: BankFirstDrawInput) => {
          bankCalls.push(drawInput);
          return { batchId: 'b-canon', persistedCount: 1, acceptedCount: 1, telemetry: { status: 'ok' } };
        },
      } as Parameters<typeof runPrePaidNoveltyDiscovery>[1],
      deps(companies),
    );

    const sentToDiscards = out.telemetry['unverified_sent_to_discards'];
    assert.equal(typeof sentToDiscards, 'number');
    assert.ok((sentToDiscards as number) > 0, 'las sin web van a Descartadas');
    assert.equal(bankCalls.length, 1, 'quedó hueco: el banco corre');
    // El banco recibe las subindustrias pedidas.
    assert.deepEqual(bankCalls[0].subindustries, ['Ciberseguridad']);
    // Lo escrito por la capa gratuita (con web) + 2 rescatadas + 1 del banco.
    assert.equal(out.persistedCount, 2 + 2 + 1);
    assert.equal(out.batchId, 'b-canon');
  });

  it('sin subindustrias el banco no recibe el campo (búsqueda sectorial de siempre)', async () => {
    const bankCalls: BankFirstDrawInput[] = [];
    await runPrePaidNoveltyDiscovery(
      {} as unknown as SupabaseClient,
      {
        provider: 'apollo',
        countryCode: 'CO',
        countryName: 'Colombia',
        macroIndustryKey: 'technology',
        requestedTarget: TARGET,
        requestedByUserId: 'u-1',
        partialGapSupported: true,
        resolveBatchId: async () => 'b-canon',
        drawCompanyBank: async (drawInput: BankFirstDrawInput) => {
          bankCalls.push(drawInput);
          return { batchId: 'b-canon', persistedCount: 0, acceptedCount: 0, telemetry: {} };
        },
      } as Parameters<typeof runPrePaidNoveltyDiscovery>[1],
      deps([company(1, 'e1.com.co')]),
    );
    assert.equal(bankCalls.length, 1);
    assert.equal('subindustries' in bankCalls[0], false);
  });

  it('buildBankPipelineOutput lleva las subindustrias a la entrada del escritor', () => {
    const base = { industryName: 'Tecnología', countryCode: 'CO', countryName: 'Colombia', requestedTarget: 3, candidates: [] };
    assert.deepEqual(buildBankPipelineOutput(base).input.subindustries, []);
    assert.deepEqual(buildBankPipelineOutput({ ...base, subindustries: ['Ciberseguridad'] }).input.subindustries, ['Ciberseguridad']);
  });
});

describe('AUDIT-A1-WS7 — «juzgadas» en la telemetría de Competidores', () => {
  const base = {
    provider: 'apollo',
    countryCode: 'CO',
    countryName: 'Colombia',
    macroIndustryKey: 'technology',
    requestedTarget: TARGET,
    requestedByUserId: 'u-1',
    partialGapSupported: true,
    resolveBatchId: async () => 'b-canon',
  };

  it('si el juez falla, no juzgó ninguna (antes contaba todas las aceptadas por la puerta)', async () => {
    const out = await runPrePaidNoveltyDiscovery(
      {} as unknown as SupabaseClient,
      { ...base, selectFreeCompanies: async () => null } as Parameters<typeof runPrePaidNoveltyDiscovery>[1],
      deps([company(1, 'e1.com.co'), company(2, 'e2.com.co')]),
    );
    assert.deepEqual(out.telemetry['competitor_selection'], {
      gate_accepted: 2,
      judged: 0,
      selected: 0,
      selection_failed: true,
    });
  });

  it('con juez, juzgadas = las que vio y elegidas = las que devolvió', async () => {
    const companies = [company(1, 'e1.com.co'), company(2, 'e2.com.co'), company(3, 'e3.com.co')];
    const out = await runPrePaidNoveltyDiscovery(
      {} as unknown as SupabaseClient,
      {
        ...base,
        selectFreeCompanies: async (list: readonly CountrySourceCompany[]) => [list[0]],
      } as Parameters<typeof runPrePaidNoveltyDiscovery>[1],
      deps(companies),
    );
    const selection = out.telemetry['competitor_selection'] as Record<string, unknown>;
    assert.equal(selection.judged, 3);
    assert.equal(selection.selected, 1);
    assert.equal(selection.selection_failed, false);
  });
});
