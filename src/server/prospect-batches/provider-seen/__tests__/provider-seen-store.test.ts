/**
 * ADDENDUM PROVIDER-SEEN §§ 4, 13 y § 11.15 — la memoria sobrevive a la corrida
 * que la creó, y el puerto de Producción declara que todavía no persiste.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { collectProviderSeenObservations } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import {
  createInMemoryProviderSeenStore,
  NO_OP_PROVIDER_SEEN_STORE,
  PROVIDER_SEEN_LOAD_LIMIT,
  PROVIDER_SEEN_PERSISTENCE_STATUS,
  PROVIDER_SEEN_WRITE_SKIPPED_NO_AUTHORITY,
  PROVIDER_SEEN_WRITE_SKIPPED_NO_OBSERVATIONS,
  resolveProviderSeenStore,
} from '../provider-seen-store';

const T1 = '2026-08-20T10:00:00.000Z';
const T2 = '2026-08-21T10:00:00.000Z';

test('§ 11.15 — una corrida POSTERIOR carga la identidad que dejó la anterior', async () => {
  const store = createInMemoryProviderSeenStore();

  // Corrida 1: el proveedor devuelve tres empresas; dos se rechazarán aguas
  // abajo. La memoria no lo sabe ni le importa: recuerda las tres.
  const run1 = collectProviderSeenObservations('lusha', [
    { providerEntityId: 'v1.aaa', domain: 'uno.example' },
    { providerEntityId: 'v1.bbb', domain: null },
    { providerEntityId: null, domain: 'tres.example' },
  ]);
  const written = await store.record({
    observations: run1.observations,
    correlationId: 'run-1',
    observedAt: T1,
  });

  assert.equal(written.written, true);
  assert.equal(written.newIdsRecorded, 2);
  assert.equal(written.newDomainsRecorded, 2);

  // Corrida 2: sólo carga. Las tres identidades siguen ahí.
  const loaded = await store.load({ provider: 'lusha', limit: PROVIDER_SEEN_LOAD_LIMIT });
  assert.equal(loaded.length, 3);
  assert.deepEqual(
    loaded.map((r) => r.providerEntityId),
    ['v1.aaa', 'v1.bbb', null],
  );
  assert.deepEqual(loaded.map((r) => r.firstSeenCorrelation), ['run-1', 'run-1', 'run-1']);
});

test('§ 4 — volver a ver una empresa extiende la ventana, no la duplica ni reescribe el origen', async () => {
  const store = createInMemoryProviderSeenStore();
  const observations = collectProviderSeenObservations('lusha', [
    { providerEntityId: 'v1.aaa', domain: 'uno.example' },
  ]).observations;

  await store.record({ observations, correlationId: 'run-1', observedAt: T1 });
  const second = await store.record({ observations, correlationId: 'run-2', observedAt: T2 });

  assert.equal(second.refreshedCount, 1);
  assert.equal(second.newIdsRecorded, 0, 'ya la conocíamos: no es una identidad nueva');

  const [record] = await store.load({ provider: 'lusha', limit: 10 });
  assert.equal(record?.firstSeenAt, T1);
  assert.equal(record?.firstSeenCorrelation, 'run-1');
  assert.equal(record?.lastSeenAt, T2);
  assert.equal(record?.lastSeenCorrelation, 'run-2');
});

test('§ 4 — un dominio que llega tarde COMPLETA la fila; nunca la borra', async () => {
  const store = createInMemoryProviderSeenStore();
  await store.record({
    observations: collectProviderSeenObservations('lusha', [
      { providerEntityId: 'v1.aaa', domain: null },
    ]).observations,
    correlationId: 'run-1',
    observedAt: T1,
  });
  await store.record({
    observations: collectProviderSeenObservations('lusha', [
      { providerEntityId: 'v1.aaa', domain: 'tarde.example' },
    ]).observations,
    correlationId: 'run-2',
    observedAt: T2,
  });

  const [record] = await store.load({ provider: 'lusha', limit: 10 });
  assert.equal(record?.normalizedDomain, 'tarde.example');
});

test('§ 4 — la memoria está separada POR proveedor', async () => {
  const store = createInMemoryProviderSeenStore();
  await store.record({
    observations: collectProviderSeenObservations('lusha', [{ providerEntityId: 'x', domain: null }])
      .observations,
    correlationId: 'run-1',
    observedAt: T1,
  });
  await store.record({
    observations: collectProviderSeenObservations('apollo', [{ providerEntityId: 'x', domain: null }])
      .observations,
    correlationId: 'run-1',
    observedAt: T1,
  });

  assert.equal((await store.load({ provider: 'lusha', limit: 10 })).length, 1);
  assert.equal((await store.load({ provider: 'apollo', limit: 10 })).length, 1);
});

/**
 * 🔴 Ratchet invertido, no borrado (AGENT1-PROVIDER-SEEN-MEMORY-3): el resolutor ya
 * NO devuelve este puerto —la migración 123 está aplicada y `resolveProviderSeenStore`
 * construye el store persistente; eso se demuestra en `provider-seen-activation`—.
 *
 * Lo que este puerto sigue siendo, y por eso sigue probado, es el fail-soft
 * explícito: el valor por defecto del gate cuando nadie le inyecta memoria. Su
 * contrato es el que garantiza que «sin memoria» signifique «el gasto de siempre» y
 * no un error.
 */
test('§ 13 — el puerto que no persiste lo DICE en vez de fingirlo', async () => {
  assert.equal(PROVIDER_SEEN_PERSISTENCE_STATUS, 'schema_applied');

  const store = NO_OP_PROVIDER_SEEN_STORE;

  // Lee vacío ⇒ 0 aciertos ⇒ 0 exclusiones nuevas ⇒ la corrida gasta lo de hoy.
  assert.deepEqual([...(await store.load({ provider: 'lusha', limit: 10 }))], []);

  const written = await store.record({
    observations: collectProviderSeenObservations('lusha', [
      { providerEntityId: 'v1.aaa', domain: 'uno.example' },
    ]).observations,
    correlationId: 'run-1',
    observedAt: T1,
  });
  assert.equal(written.written, false);
  assert.equal(written.skippedReason, PROVIDER_SEEN_WRITE_SKIPPED_NO_AUTHORITY);
  assert.equal(written.newIdsRecorded, 0);

  // 🔴 Y el resolutor NO devuelve este puerto: si volviera a hacerlo, la memoria
  // estaría apagada sin que nadie lo hubiera decidido.
  assert.notEqual(resolveProviderSeenStore(), NO_OP_PROVIDER_SEEN_STORE);
});

test('§ 4 — la carga es SIEMPRE acotada: una memoria sin cota encarecería lo gratuito', async () => {
  const store = createInMemoryProviderSeenStore();
  await store.record({
    observations: collectProviderSeenObservations(
      'lusha',
      Array.from({ length: 20 }, (_, i) => ({ providerEntityId: `id-${i}`, domain: null })),
    ).observations,
    correlationId: 'run-1',
    observedAt: T1,
  });

  assert.equal((await store.load({ provider: 'lusha', limit: 5 })).length, 5);
  assert.equal((await store.load({ provider: 'lusha', limit: 0 })).length, 0);
});

// ─── AGENT1-PROVIDER-SEEN-MEMORY-2 — la mezcla, dicha una sola vez ────────────

test('§ 4 — un dominio NUEVO sobre el mismo id REEMPLAZA al que el proveedor dejó de emitir', async () => {
  const store = createInMemoryProviderSeenStore();
  await store.record({
    observations: collectProviderSeenObservations('lusha', [
      { providerEntityId: 'v1.aaa', domain: 'old.example' },
    ]).observations,
    correlationId: 'run-1',
    observedAt: T1,
  });
  await store.record({
    observations: collectProviderSeenObservations('lusha', [
      { providerEntityId: 'v1.aaa', domain: 'new.example' },
    ]).observations,
    correlationId: 'run-2',
    observedAt: T2,
  });

  const [record] = await store.load({ provider: 'lusha', limit: 10 });
  // 🔴 Conservar el primero para siempre haría que la fila afirmara un emparejamiento
  // que el proveedor ya no emite, mientras `lastSeenAt` la presenta como fresca. El
  // coste se dice en voz alta: esta memoria no guarda HISTORIA de dominios.
  assert.equal(record?.normalizedDomain, 'new.example');
  assert.equal(record?.firstSeenAt, T1, 'y el origen sigue sin moverse');
});

test('§ 4 — una observación SIN dominio nunca borra el que ya había', async () => {
  const store = createInMemoryProviderSeenStore();
  await store.record({
    observations: collectProviderSeenObservations('lusha', [
      { providerEntityId: 'v1.aaa', domain: 'sigue.example' },
    ]).observations,
    correlationId: 'run-1',
    observedAt: T1,
  });
  await store.record({
    observations: collectProviderSeenObservations('lusha', [
      { providerEntityId: 'v1.aaa', domain: null },
    ]).observations,
    correlationId: 'run-2',
    observedAt: T2,
  });

  const [record] = await store.load({ provider: 'lusha', limit: 10 });
  assert.equal(record?.normalizedDomain, 'sigue.example');
  assert.equal(record?.lastSeenAt, T2, 'la ventana sí avanza');
});

test('§ 4 — una escritura MÁS VIEJA no hace retroceder la ventana ni la correlación', async () => {
  // La convergencia tiene que depender del CONJUNTO de escrituras, no de cuál llegó
  // última: con un last-write-wins simple, dos escritores concurrentes dejarían filas
  // distintas según cómo los planificara el servidor.
  const store = createInMemoryProviderSeenStore();
  const observations = collectProviderSeenObservations('lusha', [
    { providerEntityId: 'v1.aaa', domain: null },
  ]).observations;

  await store.record({ observations, correlationId: 'run-nuevo', observedAt: T2 });
  await store.record({ observations, correlationId: 'run-viejo', observedAt: T1 });

  const [record] = await store.load({ provider: 'lusha', limit: 10 });
  assert.equal(record?.lastSeenAt, T2);
  assert.equal(record?.lastSeenCorrelation, 'run-nuevo');
});

test('§ 4 — un lote vacío se reporta, no se finge escrito', async () => {
  const store = createInMemoryProviderSeenStore();
  const result = await store.record({ observations: [], correlationId: 'run-1', observedAt: T1 });
  assert.equal(result.written, false);
  assert.equal(result.skippedReason, PROVIDER_SEEN_WRITE_SKIPPED_NO_OBSERVATIONS);
});
