/**
 * ADDENDUM PROVIDER-SEEN §§ 3, 5, 6, 10 — la memoria dentro de la capa previa al
 * pago, sobre el gate REAL.
 *
 * Lo que estas pruebas defienden, dicho como defecto: que encender la memoria
 * cambie lo que hoy se le pide al proveedor. Con memoria vacía —que es el estado
 * de Producción mientras no exista la tabla— la lista de exclusión tiene que
 * salir byte a byte la de antes de este PR. Si no, este PR movería el gasto.
 *
 * Offline: sin red, sin DB, sin proveedor, 0 créditos.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runPrePaidNoveltyGate } from '../run-prepaid-novelty-gate';
import { createInMemoryProviderSeenStore } from '@/server/prospect-batches/provider-seen/provider-seen-store';
import { collectProviderSeenObservations } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';

const BASE = {
  countryCode: 'MX', // país sin fuente gratuita cableada: aísla la exclusión
  macroIndustryKey: 'health_pharma',
  requestedTarget: 5,
} as const;

const KNOWN_DOMAINS = ['https://Conocida.com/x', 'conocida.com', null, 'otra.example'];

test('§ 6 — con memoria VACÍA la lista de exclusión es exactamente la de siempre', async () => {
  const sinMemoria = await runPrePaidNoveltyGate(
    { ...BASE, provider: 'lusha' },
    { listKnownExclusionDomains: async () => KNOWN_DOMAINS },
  );

  assert.deepEqual([...sinMemoria.exclusionPlan.sent], ['conocida.com', 'otra.example']);
  // La vista heredada y la dimensión de dominios del plan nuevo son LA MISMA
  // lista: se deriva, no se calcula dos veces.
  assert.deepEqual(
    [...sinMemoria.exclusionPlan.sent],
    [...sinMemoria.providerExclusionPlan.domains.sent],
  );
  assert.equal(sinMemoria.providerSeen.loaded, false);
  assert.equal(sinMemoria.providerSeen.unavailableReason, 'persistence_authority_pending');
  assert.equal(sinMemoria.context.providerSeenKnown, 0);
});

test('§ 6 — con memoria poblada, los dominios ya pagados se suman a la exclusión', async () => {
  const store = createInMemoryProviderSeenStore();
  await store.record({
    observations: collectProviderSeenObservations('lusha', [
      { providerEntityId: 'v1.aaa', domain: 'yapagada.example' },
      { providerEntityId: 'v1.bbb', domain: null },
    ]).observations,
    correlationId: 'run-anterior',
    observedAt: '2026-08-19T10:00:00.000Z',
  });

  const result = await runPrePaidNoveltyGate(
    { ...BASE, provider: 'lusha' },
    {
      listKnownExclusionDomains: async () => KNOWN_DOMAINS,
      providerSeenStore: store,
    },
  );

  assert.deepEqual(
    [...result.exclusionPlan.sent],
    ['conocida.com', 'otra.example', 'yapagada.example'],
  );
  assert.equal(result.providerSeen.loaded, true);
  assert.equal(result.providerSeen.idsAvailable, 2);
  assert.equal(result.providerSeen.domainsAvailable, 1);
  assert.equal(result.providerExclusionPlan.domains.bySource.provider_seen, 1);

  // 🔴 Los ids se conocen y se cuentan… pero NO viajan: el contrato humano de
  // Lusha sigue pendiente (§ 5).
  assert.equal(result.providerExclusionPlan.ids.available, 2);
  assert.deepEqual([...result.providerExclusionPlan.ids.sent], []);
  assert.equal(
    result.providerExclusionPlan.ids.unsupportedReason,
    'lusha_exclude_ids_contract_unconfirmed',
  );
});

test('§ 3 — la memoria NO reduce el hueco: lo ya visto no es lo ya nuestro', async () => {
  const store = createInMemoryProviderSeenStore();
  await store.record({
    observations: collectProviderSeenObservations(
      'lusha',
      Array.from({ length: 12 }, (_, i) => ({ providerEntityId: `id-${i}`, domain: null })),
    ).observations,
    correlationId: 'run-anterior',
    observedAt: '2026-08-19T10:00:00.000Z',
  });

  const result = await runPrePaidNoveltyGate(
    { ...BASE, provider: 'lusha' },
    { providerSeenStore: store },
  );

  // Doce empresas recordadas y el objetivo sigue entero: una empresa que el
  // proveedor nos mostró y que rechazamos no es una empresa que tengamos.
  assert.equal(result.context.providerSeenKnown, 12);
  assert.equal(result.context.residualGap, 5);
  assert.equal(result.context.acceptedBeforeProvider, 0);
  assert.equal(result.context.providerRequired, true);
});

test('§ 6 — Apollo no recibe exclusiones, aunque la memoria esté llena', async () => {
  const store = createInMemoryProviderSeenStore();
  await store.record({
    observations: collectProviderSeenObservations('apollo', [
      { providerEntityId: 'org-1', domain: 'apollo-vista.example' },
    ]).observations,
    correlationId: 'run-anterior',
    observedAt: '2026-08-19T10:00:00.000Z',
  });

  const result = await runPrePaidNoveltyGate(
    { ...BASE, provider: 'apollo' },
    {
      listKnownExclusionDomains: async () => KNOWN_DOMAINS,
      providerSeenStore: store,
    },
  );

  assert.deepEqual([...result.exclusionPlan.sent], []);
  assert.equal(result.providerExclusionPlan.domains.available, 3, 'se sabe, pero no viaja');
  assert.equal(result.providerExclusionPlan.domains.omittedDueToCapability, 3);
});

test('§ 12 — una memoria que revienta NO rompe la corrida: degrada a «no se cargó»', async () => {
  const result = await runPrePaidNoveltyGate(
    { ...BASE, provider: 'lusha' },
    {
      listKnownExclusionDomains: async () => KNOWN_DOMAINS,
      providerSeenStore: {
        load: async () => {
          throw new Error('memoria caída');
        },
        record: async () => {
          throw new Error('memoria caída');
        },
      },
    },
  );

  assert.equal(result.providerSeen.loaded, false);
  assert.deepEqual([...result.exclusionPlan.sent], ['conocida.com', 'otra.example']);
  assert.equal(result.context.residualGap, 5, 'fail-open: el proveedor hace lo de hoy');
});

test('§ 10 — la telemetría publica los nombres acordados, sin economía derivada', async () => {
  const result = await runPrePaidNoveltyGate(
    { ...BASE, provider: 'lusha' },
    { listKnownExclusionDomains: async () => KNOWN_DOMAINS },
  );

  const seen = result.telemetry.provider_seen as Record<string, unknown>;
  for (const key of [
    'country_source_attempted',
    'country_source_raw',
    'country_source_macro_confirmed',
    'country_source_known',
    'country_source_novel_accepted',
    'provider_seen_loaded',
    'provider_seen_ids_available',
    'provider_seen_domains_available',
    'provider_exclusion_ids_available',
    'provider_exclusion_domains_available',
    'provider_exclusion_ids_sent',
    'provider_exclusion_domains_sent',
    'paid_raw_results',
    'provider_seen_hits_after_response',
    'provider_new_ids_recorded',
    'provider_new_domains_recorded',
    'novel_after_provider_seen',
    'novel_useful_after_local_dedupe',
    'branch_page_novelty_yield',
    'branch_stop_reason',
    'requests_avoided',
    'pages_avoided',
  ]) {
    assert.ok(key in seen, `falta la clave acordada ${key}`);
  }

  for (const forbidden of ['credits_saved', 'usd_saved']) {
    assert.equal(forbidden in seen, false, forbidden);
  }
});
