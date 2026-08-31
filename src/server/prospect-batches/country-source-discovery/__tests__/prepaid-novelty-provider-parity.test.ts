/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 11, 13, 14, 25 — paridad entre
 * proveedores y el todo-o-nada de las rutas que no saben reducir su objetivo.
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

function makeDeps(input: {
  acceptedNovel: number;
  requestedTarget: number;
  persistedCount?: number;
  exclusionSent?: string[];
}): { deps: PrePaidNoveltyDiscoveryDeps; persistCalls: number } {
  const state = { persistCalls: 0 };
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
    knownSuppressionDomains: input.exclusionSent ?? [],
  });

  const gateResult: PrePaidNoveltyGateResult = {
    context,
    // 🔴 CUT-L1 § 3 — el doble refleja el mundo real: lo conocido va en
    // `availableValues` y `sent` queda vacío, porque ningún proveedor vivo puede
    // recibir una exclusión.
    exclusionPlan: {
      available: (input.exclusionSent ?? []).length,
      availableValues: input.exclusionSent ?? [],
      sent: [],
      omittedDueToCap: 0,
    },
    // ADDENDUM PROVIDER-SEEN — el doble del gate declara las tres claves nuevas.
    // Memoria vacía: este fichero prueba la PARIDAD entre rutas, no la memoria.
    providerExclusionPlan: planProviderExclusions('lusha', {
      sellupKnownDomains: input.exclusionSent ?? [],
    }),
    providerSeen: PROVIDER_SEEN_LOAD_UNAVAILABLE,
    providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
    acceptedCompanies: accepted,
    telemetry: {},
  };

  const deps: PrePaidNoveltyDiscoveryDeps = {
    runGate: async () => gateResult,
    persist: async () => {
      state.persistCalls++;
      return {
        batchId: 'batch-free-1',
        writtenCount: input.persistedCount ?? input.acceptedNovel,
        skippedCount: 0,
        failed: false,
      };
    },
  };

  return { deps, get persistCalls() { return state.persistCalls; } } as never;
}

const BASE = {
  countryCode: 'CO',
  countryName: 'Colombia',
  macroIndustryKey: 'health_pharma',
  requestedByUserId: 'user-1',
  provider: 'lusha' as const,
};

test('§ 25 — con hueco cerrado, LAS DOS rutas evitan al proveedor por igual', async () => {
  for (const partialGapSupported of [true, false]) {
    const { deps } = makeDeps({ acceptedNovel: 5, requestedTarget: 5 });
    const outcome = await runPrePaidNoveltyDiscovery(
      CLIENT,
      { ...BASE, requestedTarget: 5, partialGapSupported },
      deps,
    );
    assert.equal(outcome.providerRequired, false, `partialGapSupported=${partialGapSupported}`);
    assert.equal(outcome.residualGap, 0);
    assert.equal(outcome.persistedCount, 5);
    assert.equal(outcome.batchId, 'batch-free-1');
  }
});

test('§ 14 — hueco PARCIAL: Lusha lo aprovecha; Apollo/Tavily no puede y no contribuye', async () => {
  const lusha = makeDeps({ acceptedNovel: 2, requestedTarget: 5 });
  const lushaOutcome = await runPrePaidNoveltyDiscovery(
    CLIENT,
    { ...BASE, requestedTarget: 5, partialGapSupported: true },
    lusha.deps,
  );
  assert.equal(lushaOutcome.residualGap, 3);
  assert.equal(lushaOutcome.acceptedBeforeProvider, 2);
  assert.equal(lushaOutcome.persistedCount, 2);

  const apollo = makeDeps({ acceptedNovel: 2, requestedTarget: 5 });
  const apolloOutcome = await runPrePaidNoveltyDiscovery(
    CLIENT,
    { ...BASE, requestedTarget: 5, partialGapSupported: false },
    apollo.deps,
  );
  // 🔴 Todo-o-nada: el ejecutor de pago de esa ruta no sabe aceptar un objetivo
  // reducido, así que persistir 2 gratis y dejarle buscar 5 más daría 7 donde el
  // usuario pidió 5. Se descarta el parcial — no costó nada averiguarlo.
  assert.equal(apolloOutcome.residualGap, 5);
  assert.equal(apolloOutcome.acceptedBeforeProvider, 0);
  assert.equal(apolloOutcome.persistedCount, 0);
  assert.equal(apolloOutcome.batchId, null);
  assert.equal(apollo.persistCalls, 0, 'ni siquiera se intenta persistir');
});

test('§ 13 — si la ingesta canónica guarda menos, el hueco se reabre en la ruta que sí lo soporta', async () => {
  const { deps } = makeDeps({ acceptedNovel: 5, requestedTarget: 5, persistedCount: 3 });
  const outcome = await runPrePaidNoveltyDiscovery(
    CLIENT,
    { ...BASE, requestedTarget: 5, partialGapSupported: true },
    deps,
  );
  assert.equal(outcome.persistedCount, 3);
  assert.equal(outcome.residualGap, 2);
  assert.equal(outcome.providerRequired, true);
});

test('§ 13 — la ruta todo-o-nada descarta su contribución si la escritura no cerró el objetivo', async () => {
  const { deps } = makeDeps({ acceptedNovel: 5, requestedTarget: 5, persistedCount: 3 });
  const outcome = await runPrePaidNoveltyDiscovery(
    CLIENT,
    { ...BASE, requestedTarget: 5, partialGapSupported: false },
    deps,
  );
  assert.equal(outcome.residualGap, 5);
  assert.equal(outcome.acceptedBeforeProvider, 0);
  assert.equal(outcome.providerRequired, true);
});

test('§ 11 · CUT-L1 — los conocidos LLEGAN a la ruta de pago cuando habrá proveedor, en ambas rutas', async () => {
  const { deps } = makeDeps({
    acceptedNovel: 0,
    requestedTarget: 5,
    exclusionSent: ['conocida.example', 'otra.example'],
  });
  const outcome = await runPrePaidNoveltyDiscovery(
    CLIENT,
    { ...BASE, requestedTarget: 5, partialGapSupported: true },
    deps,
  );
  // 🔴 CUT-L1 §§ 3, 7 — llegan para SEMBRAR la supresión cliente, no para viajar
  // en la petición. La paridad entre rutas que este fichero defiende es la misma.
  assert.deepEqual(
    [...outcome.knownSuppressionDomains],
    ['conocida.example', 'otra.example'],
  );
});
