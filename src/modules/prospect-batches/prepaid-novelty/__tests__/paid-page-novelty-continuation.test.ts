/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 17, 19, 23 — la matriz de
 * novedad cero, sobre la decisión PURA.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { decidePaidPageContinuation } from '../paid-page-novelty-continuation';

test('§ 23(A) — página con filas pero sin novedad útil ⇒ no se compra la siguiente de la rama', () => {
  const decision = decidePaidPageContinuation({ rawFromPage: 10, novelUsefulFromPage: 0 });
  assert.equal(decision.continueBranch, false);
  assert.equal(decision.continueBranch === false && decision.stopReason, 'page_zero_novelty');
});

test('§ 23(B) — una sola empresa nueva y útil basta para permitir la página siguiente', () => {
  const decision = decidePaidPageContinuation({ rawFromPage: 10, novelUsefulFromPage: 1 });
  assert.equal(decision.continueBranch, true);
});

test('§ 23(C/D/E/F) — históricos, duplicados exactos, rechazos de precisión y duplicados entre ramas colapsan al MISMO desenlace', () => {
  // Las cuatro causas son distintas aguas arriba y aquí llegan como el mismo
  // hecho: la página pagada no dejó ni una empresa nueva y útil.
  for (const raw of [10, 7, 3, 1]) {
    const decision = decidePaidPageContinuation({ rawFromPage: raw, novelUsefulFromPage: 0 });
    assert.equal(decision.continueBranch, false);
    assert.equal(decision.continueBranch === false && decision.stopReason, 'page_zero_novelty');
  }
});

test('página vacía ⇒ se distingue del pozo seco, aunque la consecuencia sea la misma', () => {
  const decision = decidePaidPageContinuation({ rawFromPage: 0, novelUsefulFromPage: 0 });
  assert.equal(decision.continueBranch, false);
  assert.equal(decision.continueBranch === false && decision.stopReason, 'page_empty');
});

test('🔴 § 19 — la decisión NO puede detener la corrida: su vocabulario no incluye esa idea', () => {
  // La única forma de que esta primitiva parase el proveedor entero sería que
  // pudiera decirlo. Sus dos motivos son de RAMA y no existe un tercero.
  const reasons = new Set<string>();
  for (const raw of [0, 5]) {
    for (const novel of [0, 2]) {
      const d = decidePaidPageContinuation({ rawFromPage: raw, novelUsefulFromPage: novel });
      if (d.continueBranch === false) reasons.add(d.stopReason);
    }
  }
  assert.deepEqual([...reasons].sort(), ['page_empty', 'page_zero_novelty']);
});

test('entradas no finitas colapsan a parada, nunca a «sigue comprando»', () => {
  assert.equal(
    decidePaidPageContinuation({ rawFromPage: Number.NaN, novelUsefulFromPage: 3 }).continueBranch,
    false,
  );
  assert.equal(
    decidePaidPageContinuation({ rawFromPage: 10, novelUsefulFromPage: Number.NaN }).continueBranch,
    false,
  );
});
