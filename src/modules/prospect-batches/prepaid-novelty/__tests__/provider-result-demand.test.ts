/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 3, 4, 5 — el contrato de demanda, puro.
 *
 * Lo que estas pruebas defienden, dicho como defecto: que la cota residual pueda
 * AMPLIAR un techo, que pueda producir una demanda negativa o de cero que llegue
 * al proveedor, o que empiece a parecerse a una cifra económica.
 *
 * Offline: sin red, sin DB, sin proveedor, 0 créditos.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boundByRemainingTarget,
  fullTargetResultDemand,
  resolveProviderResultDemand,
  toProviderResultDemandMetadata,
} from '../provider-result-demand';

const outcome = (
  requestedTarget: number,
  acceptedBeforeProvider: number,
  residualGap: number,
  providerRequired = residualGap > 0,
) => ({ requestedTarget, acceptedBeforeProvider, residualGap, providerRequired });

test('§ 4 — objetivo 10 con 7 cerradas gratis deja demanda 3', () => {
  const demand = resolveProviderResultDemand(outcome(10, 7, 3), 10);

  assert.equal(demand.requestedTarget, 10);
  assert.equal(demand.acceptedBeforeProvider, 7);
  assert.equal(demand.remainingTarget, 3);
  assert.equal(demand.providerRequired, true);
  assert.equal(demand.source, 'prepaid_novelty_residual_gap');
});

test('§ 4 — hueco cerrado ⇒ `providerRequired: false` y demanda 0', () => {
  const demand = resolveProviderResultDemand(outcome(10, 10, 0), 10);

  assert.equal(demand.remainingTarget, 0);
  assert.equal(demand.providerRequired, false);
});

test('§ 4 — sin aporte gratuito la demanda es el objetivo entero', () => {
  const demand = resolveProviderResultDemand(outcome(10, 0, 10), 10);

  assert.equal(demand.remainingTarget, 10);
  assert.equal(demand.providerRequired, true);
});

test('sin capa previa el comportamiento es el anterior al corte', () => {
  const demand = resolveProviderResultDemand(null, 10);

  assert.equal(demand.requestedTarget, 10);
  assert.equal(demand.acceptedBeforeProvider, 0);
  assert.equal(demand.remainingTarget, 10);
  assert.equal(demand.source, 'prepaid_layer_absent');
  assert.deepEqual(demand, fullTargetResultDemand(10));
});

test('🔴 `providerRequired` se DERIVA del hueco resuelto, no se copia', () => {
  // Un outcome incoherente —hueco cerrado pero `providerRequired: true`— no puede
  // colarse: sería una corrida que paga por un objetivo que ya está cumplido.
  const demand = resolveProviderResultDemand(outcome(5, 5, 0, true), 5);
  assert.equal(demand.providerRequired, false);

  // Y al revés: hueco abierto con la bandera en false tampoco apaga al proveedor
  // por su cuenta, que dejaría al usuario con menos candidatos sin decirlo.
  const abierto = resolveProviderResultDemand(outcome(5, 1, 4, false), 5);
  assert.equal(abierto.providerRequired, true);
});

test('🔴 un hueco mayor que el objetivo NO autoriza pedir más', () => {
  const demand = resolveProviderResultDemand(outcome(5, 0, 99), 5);
  assert.equal(demand.remainingTarget, 5);
});

test('entradas basura degradan a 0, nunca a negativo ni a NaN', () => {
  const demand = resolveProviderResultDemand(
    outcome(Number.NaN, -3, Number.POSITIVE_INFINITY),
    7,
  );
  assert.equal(demand.requestedTarget, 0);
  assert.equal(demand.acceptedBeforeProvider, 0);
  assert.equal(demand.remainingTarget, 0);
  assert.equal(demand.providerRequired, false);

  assert.equal(fullTargetResultDemand(Number.NaN).remainingTarget, 0);
  assert.equal(fullTargetResultDemand(-4).remainingTarget, 0);
});

test('§ 6 — `boundByRemainingTarget` recorta y NUNCA amplía', () => {
  assert.equal(boundByRemainingTarget(5, 3), 3);
  assert.equal(boundByRemainingTarget(5, 0), 0);
  // 🔴 El caso que importa: hueco 9 sobre un techo de 5 sigue siendo 5. La capa
  // gratuita puede pedir menos; jamás autorizar más gasto del ya aprobado.
  assert.equal(boundByRemainingTarget(5, 9), 5);
  assert.equal(boundByRemainingTarget(5, Number.NaN), 0);
  assert.equal(boundByRemainingTarget(Number.NaN, 3), 0);
});

test('§ 5 — la metadata publica la demanda y NADA económico', () => {
  const meta = toProviderResultDemandMetadata(resolveProviderResultDemand(outcome(10, 7, 3), 10));

  assert.deepEqual(meta, {
    requested_target: 10,
    accepted_before_provider: 7,
    remaining_target: 3,
    provider_required: true,
    source: 'prepaid_novelty_residual_gap',
  });

  // 🔴 Ni créditos, ni dólares, ni ahorro: este bloque describe cuántas empresas
  // faltan, y P0-1 sigue sin decir qué cuesta una.
  for (const forbidden of ['credits', 'usd', 'cost', 'saved', 'reserved']) {
    for (const key of Object.keys(meta)) {
      assert.ok(!key.includes(forbidden), `la metadata no puede hablar de dinero (${key})`);
    }
  }
});
