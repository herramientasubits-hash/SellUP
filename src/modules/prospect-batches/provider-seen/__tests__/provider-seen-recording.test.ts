/**
 * ADDENDUM PROVIDER-SEEN § 4 y §§ 11.13, 11.14 — el momento en el que nace la
 * memoria, y los cuatro en los que no puede nacer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { planProviderSeenRecording } from '../provider-seen-recording';

const RESULTS = [
  { providerEntityId: 'id-1', domain: 'uno.example' },
  { providerEntityId: 'id-2', domain: null },
];

test('§ 11.13 — sin llamada al proveedor NO hay memoria', () => {
  const plan = planProviderSeenRecording({
    provider: 'lusha',
    providerCallMade: false,
    responseValid: false,
    results: [],
  });
  assert.equal(plan.record, false);
  assert.equal(plan.record === false && plan.reason, 'no_provider_call');
});

test('§ 11.13 — ni siquiera con resultados en la mano: sin petición no se vio nada', () => {
  // El caso real: hueco cerrado gratis. Las empresas existen, pero las trajo la
  // fuente del país. Recordarlas como «ya pagadas» sería inventar un gasto.
  const plan = planProviderSeenRecording({
    provider: 'lusha',
    providerCallMade: false,
    responseValid: true,
    results: RESULTS,
  });
  assert.equal(plan.record, false);
  assert.equal(plan.record === false && plan.reason, 'no_provider_call');
});

test('§ 11.14 — un fallo ANTES de respuesta válida no fabrica memoria', () => {
  const plan = planProviderSeenRecording({
    provider: 'lusha',
    providerCallMade: true,
    responseValid: false,
    results: [],
  });
  assert.equal(plan.record, false);
  assert.equal(plan.record === false && plan.reason, 'provider_response_invalid');
});

test('§ 11.14 — 🔴 la validez NO se deriva del tamaño de la lista', () => {
  // #303: Lusha devuelve `ok:true` con lista vacía para errores HTTP en la ruta
  // de teléfono. Un error con cuerpo poblado tampoco es una respuesta válida: el
  // veredicto lo da `responseValid`, y nada más.
  const errorWithBody = planProviderSeenRecording({
    provider: 'lusha',
    providerCallMade: true,
    responseValid: false,
    results: RESULTS,
  });
  assert.equal(errorWithBody.record, false);
  assert.equal(errorWithBody.record === false && errorWithBody.reason, 'provider_response_invalid');

  // Y al revés: una respuesta VÁLIDA sin filas no es un error, es un vacío.
  const validEmpty = planProviderSeenRecording({
    provider: 'lusha',
    providerCallMade: true,
    responseValid: true,
    results: [],
  });
  assert.equal(validEmpty.record, false);
  assert.equal(validEmpty.record === false && validEmpty.reason, 'no_identifiable_results');
});

test('§ 4 — una fuente que NO es proveedor de pago nunca genera memoria', () => {
  for (const source of ['co_siis', 'co_rues', 'hubspot', 'tavily', 'fixture']) {
    const plan = planProviderSeenRecording({
      provider: source,
      providerCallMade: true,
      responseValid: true,
      results: RESULTS,
    });
    assert.equal(plan.record, false, source);
    assert.equal(plan.record === false && plan.reason, 'provider_not_paid_source', source);
  }
});

test('§ 4 — respuesta válida de un proveedor de pago ⇒ memoria, con sus conteos', () => {
  const plan = planProviderSeenRecording({
    provider: 'lusha',
    providerCallMade: true,
    responseValid: true,
    results: [
      ...RESULTS,
      { providerEntityId: 'id-1', domain: 'uno.example' },
      { providerEntityId: null, domain: null },
    ],
  });

  assert.equal(plan.record, true);
  if (!plan.record) return;
  assert.equal(plan.observations.length, 2);
  assert.equal(plan.duplicateCount, 1);
  assert.equal(plan.unidentifiableCount, 1);
});
