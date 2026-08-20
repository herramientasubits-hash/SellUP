/**
 * ADDENDUM PROVIDER-SEEN §§ 4, 5, 11.12, 11.23 — qué identidad se recuerda.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProviderSeenMemory,
  collectProviderSeenObservations,
  countProviderSeenHits,
  isProviderSeenKnown,
  isProviderSeenPaidProvider,
  PROVIDER_SEEN_PAID_PROVIDERS,
  providerSeenObservationKey,
  resolveProviderSeenObservation,
} from '../provider-seen-identity';

test('§ 11.12 — una empresa SIN dominio sigue siendo identificable por el id del proveedor', () => {
  const observation = resolveProviderSeenObservation('lusha', {
    providerEntityId: 'v1.AbC-123',
    domain: null,
  });

  assert.notEqual(observation, null);
  assert.equal(observation?.providerEntityId, 'v1.AbC-123');
  assert.equal(observation?.normalizedDomain, null);
  // 🔴 No se fabrica un dominio para rellenar el hueco (§ 22(I) del hito base).
  assert.equal(providerSeenObservationKey(observation!), 'lusha:company:id:v1.AbC-123');
});

test('§ 4 — una empresa sin id Y sin dominio no se recuerda, y se CUENTA', () => {
  assert.equal(
    resolveProviderSeenObservation('lusha', { providerEntityId: null, domain: 'Clínica S.A.S.' }),
    null,
  );

  const batch = collectProviderSeenObservations('lusha', [
    { providerEntityId: null, domain: null },
    { providerEntityId: '  ', domain: '   ' },
    { providerEntityId: 'id-1', domain: null },
  ]);

  assert.equal(batch.observations.length, 1);
  assert.equal(batch.unidentifiableCount, 2, 'no desaparecen en silencio');
});

test('§ 4 — el dominio se normaliza con el MISMO normalizador que la lista de exclusión', () => {
  const observation = resolveProviderSeenObservation('lusha', {
    providerEntityId: null,
    domain: 'https://WWW.Acme.com/contacto?x=1',
  });
  // Si se guardara con otra normalización, un dominio recordado no coincidiría
  // jamás con uno enviado y la memoria sería inerte sin que nada fallara.
  assert.equal(observation?.normalizedDomain, 'acme.com');
});

test('§ 4 — el lote deduplica por identidad y conserva el orden de llegada', () => {
  const batch = collectProviderSeenObservations('lusha', [
    { providerEntityId: 'id-b', domain: 'b.example' },
    { providerEntityId: 'id-a', domain: 'a.example' },
    { providerEntityId: 'id-b', domain: 'b.example' },
  ]);

  assert.deepEqual(
    batch.observations.map((o) => o.providerEntityId),
    ['id-b', 'id-a'],
  );
  assert.equal(batch.duplicateCount, 1);
});

test('§ 4 — la frontera de proveedores de PAGO es cerrada', () => {
  assert.deepEqual([...PROVIDER_SEEN_PAID_PROVIDERS], ['lusha', 'apollo']);
  for (const free of ['co_siis', 'co_rues', 'hubspot', 'tavily', 'fixture', 'mock', '']) {
    assert.equal(isProviderSeenPaidProvider(free), false, free);
  }
});

test('§ 11.15 — la memoria se consulta por id O por dominio, nunca por una clave combinada', () => {
  const memory = buildProviderSeenMemory([
    { providerEntityId: 'id-1', normalizedDomain: null },
    { providerEntityId: null, normalizedDomain: 'conocida.example' },
  ]);

  // Coincide por id aunque el dominio sea distinto.
  assert.equal(
    isProviderSeenKnown(memory, {
      provider: 'lusha',
      entityType: 'company',
      providerEntityId: 'id-1',
      normalizedDomain: 'otra.example',
    }),
    true,
  );
  // Coincide por dominio aunque el id sea distinto.
  assert.equal(
    isProviderSeenKnown(memory, {
      provider: 'lusha',
      entityType: 'company',
      providerEntityId: 'id-nuevo',
      normalizedDomain: 'conocida.example',
    }),
    true,
  );
  // Ninguna de las dos ⇒ nueva.
  assert.equal(
    isProviderSeenKnown(memory, {
      provider: 'lusha',
      entityType: 'company',
      providerEntityId: 'id-nuevo',
      normalizedDomain: 'nueva.example',
    }),
    false,
  );

  const batch = collectProviderSeenObservations('lusha', [
    { providerEntityId: 'id-1', domain: null },
    { providerEntityId: null, domain: 'conocida.example' },
    { providerEntityId: 'id-9', domain: 'nueva.example' },
  ]);
  assert.equal(countProviderSeenHits(memory, batch.observations), 2);
});

test('§ 11.23 — recordar NO exige que exista un prospect_candidate', () => {
  // La observación se construye a partir de la respuesta cruda del proveedor. No
  // hay ninguna referencia a candidato, lote, cuenta ni escritura de negocio: por
  // construcción, una empresa rechazada aguas abajo se recuerda igual.
  const batch = collectProviderSeenObservations('lusha', [
    { providerEntityId: 'rechazada-por-precision', domain: 'rechazada.example' },
  ]);
  assert.equal(batch.observations.length, 1);
  assert.deepEqual(Object.keys(batch.observations[0]!).sort(), [
    'entityType',
    'normalizedDomain',
    'provider',
    'providerEntityId',
  ]);
});
