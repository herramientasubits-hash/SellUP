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

test('§ 6 · CUT-L1 — con memoria VACÍA la lista de CONOCIDOS es la de siempre', async () => {
  const sinMemoria = await runPrePaidNoveltyGate(
    { ...BASE, provider: 'lusha' },
    { listKnownExclusionDomains: async () => KNOWN_DOMAINS },
  );

  // 🔴 AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION §§ 1, 3 — la recogida, la
  // normalización y el dedupe son los de siempre; lo que cambió es el destino.
  // Antes se afirmaba sobre `sent` (lo que viajaba a Lusha); hoy `sent` está vacío
  // por contrato HUMANO y la evidencia vive en `availableValues`.
  assert.deepEqual(
    [...sinMemoria.exclusionPlan.availableValues],
    ['conocida.com', 'otra.example'],
  );
  assert.deepEqual([...sinMemoria.exclusionPlan.sent], [], '🔴 y nada viaja');
  assert.deepEqual(
    [...sinMemoria.context.knownSuppressionDomains],
    ['conocida.com', 'otra.example'],
    '🔴 el contexto lleva el conocimiento, no el envío',
  );
  // La vista heredada y la dimensión de dominios del plan nuevo son LA MISMA
  // lista: se deriva, no se calcula dos veces.
  assert.deepEqual(
    [...sinMemoria.exclusionPlan.availableValues],
    [...sinMemoria.providerExclusionPlan.domains.availableValues],
  );
  assert.equal(sinMemoria.providerSeen.loaded, false);
  // 🔴 El motivo dejó de ser «autoridad pendiente» en AGENT1-PROVIDER-SEEN-MEMORY-3:
  // con la 123 aplicada, ese texto habría mandado a quien lo leyera a buscar una
  // migración ya puesta. El de ahora es verdad tanto si no se consultó como si no
  // había nada como si la lectura falló.
  assert.equal(sinMemoria.providerSeen.unavailableReason, 'no_provider_seen_memory_loaded');
  assert.equal(sinMemoria.context.providerSeenKnown, 0);
});

test('§ 6 · CUT-L1 — con memoria poblada, los dominios ya pagados se suman a lo CONOCIDO', async () => {
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

  // 🔴 CUT-L1 § 3 — `provider_seen` sigue APORTANDO al conocimiento local, que es
  // lo que siembra la supresión cliente. Que no viaje al proveedor no lo hace
  // menos útil: es la única capa que queda.
  assert.deepEqual(
    [...result.exclusionPlan.availableValues],
    ['conocida.com', 'otra.example', 'yapagada.example'],
  );
  assert.deepEqual([...result.exclusionPlan.sent], []);
  assert.equal(result.providerSeen.loaded, true);
  assert.equal(result.providerSeen.idsAvailable, 2);
  assert.equal(result.providerSeen.domainsAvailable, 1);
  assert.equal(result.providerExclusionPlan.domains.bySource.provider_seen, 1);

  // 🔴 Los ids se conocen y se cuentan… pero NO viajan: el contrato HUMANO de
  // Lusha confirmó que V3 no tiene exclusión server-side (CUT-L1 § 1).
  assert.equal(result.providerExclusionPlan.ids.available, 2);
  assert.deepEqual([...result.providerExclusionPlan.ids.sent], []);
  assert.equal(
    result.providerExclusionPlan.ids.unsupportedReason,
    'lusha_v3_no_server_side_exclusion_human_confirmed',
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
  // 🔴 CUT-L1 § 1 — y el motivo de Apollo sigue siendo el SUYO, no el de Lusha:
  // las dos capacidades están apagadas por razones distintas.
  assert.equal(
    result.providerExclusionPlan.domains.unsupportedReason,
    'apollo_exclusion_contract_unverified',
  );
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
  assert.deepEqual(
    [...result.exclusionPlan.availableValues],
    ['conocida.com', 'otra.example'],
  );
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
