/**
 * AGENT1-COUNTRY-SOURCE-PERSISTENCE-CONTRACT-1 § 12 — "sólo lo PERSISTIDO
 * puede cerrar gap", caso límite: la ingesta canónica NO guarda absolutamente
 * nada (`persistedCount = 0`, `failed = true`), no sólo una pérdida parcial.
 *
 * `prepaid-novelty-provider-parity.test.ts` ya cubre la reapertura PARCIAL
 * (persistedCount=3 de 5). Este archivo cubre específicamente el caso de
 * fallo TOTAL de escritura que el contrato describe:
 *
 *   empresa gratuita aceptada + writer falla ⇒ persistedCount = 0 ⇒
 *   acceptedBeforeProvider = 0 ⇒ residualGap se reabre por completo ⇒
 *   providerRequired = true.
 *
 * Doble local para `runGate`/`persist` — cero Supabase, cero proveedor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { SupabaseClient } from '@supabase/supabase-js';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_UNAVAILABLE } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '../run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import type { CountrySourceCompany } from '../country-source-types';
import type { PrePaidNoveltyGateResult } from '../run-prepaid-novelty-gate';

const CLIENT = {} as unknown as SupabaseClient;

function company(key: string): CountrySourceCompany {
  return {
    recordIdentityKey: key,
    legalName: `SINTETICA ${key}`,
    normalizedLegalName: `sintetica ${key}`,
    taxId: `9000${key}`,
    taxIdentifierType: 'NIT',
    countryCode: 'CO',
    city: null,
    region: null,
    domain: null,
    declaredIndustry: 'Fabricación de productos farmacéuticos',
    industryCode: '2100',
    coarseSector: 'MANUFACTURA',
  };
}

function makeTotalFailureDeps(input: {
  acceptedNovel: number;
  requestedTarget: number;
}): { deps: PrePaidNoveltyDiscoveryDeps; persistCalls: () => number } {
  let persistCalls = 0;
  const accepted = Array.from({ length: input.acceptedNovel }, (_, i) => company(`c${i}`));
  const context = buildPrePaidNoveltyContext({
    requestedTarget: input.requestedTarget,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: {
      sourceKey: 'co_siis_discovery',
      attempted: true,
      rawReturned: input.acceptedNovel,
      macroConfirmed: input.acceptedNovel,
      ambiguous: 0,
      rejected: 0,
      sellupKnown: 0,
      hubspotKnown: 0,
      acceptedNovel: input.acceptedNovel,
      failed: false,
      failureCode: null,
    },
  });

  const gateResult: PrePaidNoveltyGateResult = {
    context,
    exclusionPlan: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0 },
    providerExclusionPlan: planProviderExclusions('lusha', {}),
    providerSeen: PROVIDER_SEEN_LOAD_UNAVAILABLE,
    providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
    acceptedCompanies: accepted,
    telemetry: {},
  };

  const deps: PrePaidNoveltyDiscoveryDeps = {
    runGate: async () => gateResult,
    persist: async () => {
      persistCalls++;
      // El writer falló por completo: 0 candidatos guardados, failed=true —
      // exactamente lo que `persistCountrySourceCandidates` devuelve cuando
      // el catch envuelve un error del writer genérico.
      return { batchId: null, writtenCount: 0, skippedCount: 0, failed: true };
    },
  };

  return { deps, persistCalls: () => persistCalls };
}

test('§ 12 — fallo TOTAL de escritura (partialGapSupported=true): el hueco se reabre entero', async () => {
  const { deps, persistCalls } = makeTotalFailureDeps({ acceptedNovel: 5, requestedTarget: 5 });
  const outcome = await runPrePaidNoveltyDiscovery(
    CLIENT,
    {
      provider: 'lusha',
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedTarget: 5,
      requestedByUserId: 'user-1',
      partialGapSupported: true,
    },
    deps,
  );

  assert.equal(persistCalls(), 1, 'la persistencia sí se intenta — la fuente aceptó algo');
  assert.equal(outcome.persistedCount, 0);
  assert.equal(outcome.acceptedBeforeProvider, 0);
  assert.equal(outcome.residualGap, 5, 'el hueco vuelve a ser el objetivo COMPLETO');
  assert.equal(outcome.providerRequired, true);
  assert.equal(outcome.batchId, null);
});

test('§ 12 — fallo TOTAL de escritura (partialGapSupported=false): se descarta como no-contribución', async () => {
  const { deps, persistCalls } = makeTotalFailureDeps({ acceptedNovel: 5, requestedTarget: 5 });
  const outcome = await runPrePaidNoveltyDiscovery(
    CLIENT,
    {
      provider: 'lusha',
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedTarget: 5,
      requestedByUserId: 'user-1',
      partialGapSupported: false,
    },
    deps,
  );

  assert.equal(persistCalls(), 1);
  assert.equal(outcome.persistedCount, 0);
  assert.equal(outcome.acceptedBeforeProvider, 0);
  assert.equal(outcome.residualGap, 5);
  assert.equal(outcome.providerRequired, true);
  assert.equal(outcome.batchId, null);
});

test('mutación § 17 — si el fix se revirtiera y persistedCount NO reabriera el hueco, esta prueba lo atraparía', async () => {
  // Sanity check inverso: confirma que el test anterior es sensible al bug.
  // Con acceptedNovel=5 y SIN pasar por withFreeSourcePersistenceOutcome, un
  // bug reintroducido reportaría residualGap=0 (el de la fuente, ignorando
  // que nada se guardó). Esta prueba fallaría en ese escenario, que es
  // exactamente lo que debe pasar.
  const { deps } = makeTotalFailureDeps({ acceptedNovel: 5, requestedTarget: 5 });
  const outcome = await runPrePaidNoveltyDiscovery(
    CLIENT,
    {
      provider: 'lusha',
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedTarget: 5,
      requestedByUserId: 'user-1',
      partialGapSupported: true,
    },
    deps,
  );
  assert.notEqual(outcome.residualGap, 0, 'un hueco 0 con 0 persistidos sería el bug exacto que § 12 prohíbe');
});
