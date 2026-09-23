/**
 * AGENT1-LUSHA-PAGE-NOVELTY-POLICY-1 — la política de paginación, sobre la
 * decisión PURA.
 *
 * Lo que estas pruebas fijan, dicho como defecto: sin ellas, una página no vacía
 * cuya novedad LOCAL sea cero vuelve a cerrar la rama, y la corrida devuelve sin
 * usar una petición que su reserva ya había comprometido. Ese es exactamente el
 * coste que midió el lote `9a5ac2c8` (1 de 2 peticiones usadas) y el resultado
 * que el lote `54f94a91` demostró recuperable (su página 1 rindió MÁS novedad
 * que la 0).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { decidePaidPageContinuation } from '../paid-page-novelty-continuation';

test('🔴 página con filas y CERO novedad útil ⇒ la rama CONTINÚA', () => {
  // Ésta es la inversión del corte. «Ya la vimos» habla de NUESTRO historial y no
  // predice el contenido de la página siguiente.
  const decision = decidePaidPageContinuation({ rawFromPage: 10, novelUsefulFromPage: 0 });
  assert.equal(decision.continueBranch, true);
});

test('las cuatro causas de cero novedad —histórico, duplicado exacto, precisión, dedupe entre ramas— dejaron de cerrar la rama', () => {
  for (const raw of [10, 7, 3, 1]) {
    assert.equal(
      decidePaidPageContinuation({ rawFromPage: raw, novelUsefulFromPage: 0 }).continueBranch,
      true,
      `raw=${raw}`,
    );
  }
});

test('una empresa nueva y útil sigue permitiendo la página siguiente', () => {
  assert.equal(
    decidePaidPageContinuation({ rawFromPage: 10, novelUsefulFromPage: 1 }).continueBranch,
    true,
  );
});

test('🔴 página realmente VACÍA ⇒ la rama para: releer el vacío no es una apuesta, es un hecho', () => {
  const decision = decidePaidPageContinuation({ rawFromPage: 0, novelUsefulFromPage: 0 });
  assert.equal(decision.continueBranch, false);
  assert.equal(decision.continueBranch === false && decision.stopReason, 'page_empty');
});

test('🔴 agotamiento declarado por el proveedor ⇒ la rama para', () => {
  const decision = decidePaidPageContinuation({
    rawFromPage: 25,
    novelUsefulFromPage: 0,
    providerReportedExhaustion: true,
  });
  assert.equal(decision.continueBranch, false);
  assert.equal(
    decision.continueBranch === false && decision.stopReason,
    'provider_reported_exhaustion',
  );
});

test('🔴 «no se sabe» NUNCA es agotamiento: ausente o false continúan', () => {
  // El requisito es una señal FIABLE. `totalAvailable` no lo es hoy —el cliente
  // declara «Response shape not confirmed in live test» y no hay ni una
  // observación persistida en 15 corridas reales— y por eso ningún llamador la
  // pasa. Que la ausencia continúe es lo que impide inventar una parada.
  for (const estado of [undefined, false] as const) {
    assert.equal(
      decidePaidPageContinuation({
        rawFromPage: 25,
        novelUsefulFromPage: 0,
        ...(estado === undefined ? {} : { providerReportedExhaustion: estado }),
      }).continueBranch,
      true,
      `providerReportedExhaustion=${String(estado)}`,
    );
  }
});

test('la página vacía manda sobre el agotamiento: el hecho observado va primero', () => {
  const decision = decidePaidPageContinuation({
    rawFromPage: 0,
    novelUsefulFromPage: 0,
    providerReportedExhaustion: true,
  });
  assert.equal(decision.continueBranch === false && decision.stopReason, 'page_empty');
});

test('🔴 § 19 — la decisión sigue sin poder detener la CORRIDA: su vocabulario es de rama', () => {
  const reasons = new Set<string>();
  for (const raw of [0, 5]) {
    for (const novel of [0, 2]) {
      for (const exhausted of [undefined, true] as const) {
        const d = decidePaidPageContinuation({
          rawFromPage: raw,
          novelUsefulFromPage: novel,
          ...(exhausted === undefined ? {} : { providerReportedExhaustion: exhausted }),
        });
        if (d.continueBranch === false) reasons.add(d.stopReason);
      }
    }
  }
  assert.deepEqual([...reasons].sort(), ['page_empty', 'provider_reported_exhaustion']);
});

test('🔴 una cuenta de filas no finita se trata como página vacía, nunca como permiso para comprar', () => {
  const decision = decidePaidPageContinuation({
    rawFromPage: Number.NaN,
    novelUsefulFromPage: 3,
  });
  assert.equal(decision.continueBranch, false);
  assert.equal(decision.continueBranch === false && decision.stopReason, 'page_empty');
});

test('una novedad no finita ya no puede cerrar la rama, porque la novedad dejó de decidir', () => {
  assert.equal(
    decidePaidPageContinuation({ rawFromPage: 10, novelUsefulFromPage: Number.NaN }).continueBranch,
    true,
  );
});
