/**
 * apollo-run-budget-ledger.test.ts
 *
 * AGENT1-APOLLO-DURABLE-RUN-BUDGET § 2 — el DEFECTO primero, la corrección
 * después.
 *
 * ── El defecto que se reproduce ──────────────────────────────────────────────
 *
 * El control anterior era `recorded <= reservedCredits`, evaluado DESPUÉS de
 * gastar, con `reservedCredits` viajando en el `runInput`. Aquí se reproduce su
 * aritmética exacta —`sumRecordedOperationCredits`, que suma `entry.credits`—
 * y se muestra qué autorizaba de más. Después, la misma situación contra el
 * ledger nuevo.
 *
 * G1 · el defecto: una operación indeterminada libera presupuesto.
 * G2 · el defecto: el tope se reinicia en cada invocación.
 * G3 · la corrección: se reserva ANTES, y lo que no cabe no se llama.
 * G4 · la corrección: reintento idempotente por operación.
 * G5 · la corrección: liquidar por debajo devuelve remanente; nunca por encima.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { sumRecordedOperationCredits } from '../checkpoint-merge';
import {
  createRunBudgetLedger,
  reserveOperation,
  settleOperation,
  markOperationIndeterminate,
  committedCredits,
  remainingCredits,
  hydrateRunBudgetLedger,
  hasIndeterminateSpend,
} from '../run-budget-ledger';

const MAX = 15;

// ── G1 · el defecto, con la aritmética real del control anterior ─────────────

describe('§ G1 — DEFECTO: una operación indeterminada liberaba presupuesto', () => {
  test('la suma antigua trata el cobro sin confirmar como gratis', () => {
    // Dos páginas cobradas y una tercera cuya respuesta se perdió: pudo cobrar.
    const recorded = [
      { operation_id: 'p1', operation_key: 'organizations_search' as const, round_number: 1, usage_key: null, credits: 1, billing_unknown: false },
      { operation_id: 'p2', operation_key: 'organizations_search' as const, round_number: 1, usage_key: null, credits: 1, billing_unknown: false },
      { operation_id: 'p3', operation_key: 'organizations_search' as const, round_number: 1, usage_key: null, credits: 0, billing_unknown: true },
    ];
    assert.equal(
      sumRecordedOperationCredits(recorded),
      2,
      '🔴 la operación indeterminada suma 0: el presupuesto la trata como gratuita',
    );

    // El ledger nuevo, sobre los MISMOS hechos, la cuenta como comprometida.
    let ledger = createRunBudgetLedger(MAX);
    for (const id of ['p1', 'p2', 'p3']) {
      const r = reserveOperation(ledger, { operationId: id, operationKey: 'organizations_search', estimatedCredits: 1 });
      assert.equal(r.ok, true);
      if (r.ok) ledger = r.ledger;
    }
    ledger = settleOperation(ledger, { operationId: 'p1', credits: 1 });
    ledger = settleOperation(ledger, { operationId: 'p2', credits: 1 });
    ledger = markOperationIndeterminate(ledger, { operationId: 'p3', observedCredits: null });

    assert.equal(committedCredits(ledger), 3, 'la indeterminada sigue comprometida');
    assert.equal(hasIndeterminateSpend(ledger), true);
  });
});

// ── G2 · el defecto: el tope se reiniciaba por invocación ────────────────────

describe('§ G2 — DEFECTO: cada continuación empezaba con el máximo intacto', () => {
  test('el ledger durable NO reinicia el máximo al rehidratarse', () => {
    let ledger = createRunBudgetLedger(MAX);
    for (let i = 0; i < 14; i++) {
      const r = reserveOperation(ledger, { operationId: `op-${i}`, operationKey: 'organizations_search', estimatedCredits: 1 });
      if (r.ok) ledger = r.ledger;
    }
    assert.equal(remainingCredits(ledger), 1);

    // La continuación replica el MISMO `runInput`, con `reservedCredits: 15`.
    // Si el máximo se tomara del llamador, el remanente volvería a 15.
    const rehydrated = hydrateRunBudgetLedger(ledger, MAX);
    assert.equal(
      remainingCredits(rehydrated),
      1,
      '🔴 aquí es donde un `runInput` replicado reiniciaba el tope',
    );
    assert.equal(rehydrated.maxCredits, MAX);
  });
});

// ── G3 · la corrección: reserva previa ───────────────────────────────────────

describe('§ G3 — lo que no cabe no se llama', () => {
  test('una operación que excedería el remanente se RECHAZA', () => {
    let ledger = createRunBudgetLedger(3);
    const a = reserveOperation(ledger, { operationId: 'a', operationKey: 'organizations_search', estimatedCredits: 2 });
    assert.equal(a.ok, true);
    if (a.ok) ledger = a.ledger;

    const b = reserveOperation(ledger, { operationId: 'b', operationKey: 'organization_enrichment', estimatedCredits: 2 });
    assert.equal(b.ok, false, 'no cabe: 2 pedidos contra 1 de remanente');
    if (!b.ok) {
      assert.equal(b.reason, 'insufficient_budget');
      assert.equal(b.remainingCredits, 1);
      assert.equal(b.requestedCredits, 2);
    }
    // Y el rechazo NO consume nada.
    assert.equal(remainingCredits(ledger), 1);
  });

  test('el último crédito lo toma UNA sola reserva', () => {
    let ledger = createRunBudgetLedger(1);
    const primera = reserveOperation(ledger, { operationId: 'x', operationKey: 'organizations_search', estimatedCredits: 1 });
    assert.equal(primera.ok, true);
    if (primera.ok) ledger = primera.ledger;

    const segunda = reserveOperation(ledger, { operationId: 'y', operationKey: 'organizations_search', estimatedCredits: 1 });
    assert.equal(segunda.ok, false, 'el segundo ejecutor no puede reservar lo mismo');
  });
});

// ── G4 · reintento y respuesta perdida ───────────────────────────────────────

describe('§ G4 — un reintento de la MISMA operación no reserva dos veces', () => {
  test('reservar dos veces el mismo operationId compromete UNA', () => {
    let ledger = createRunBudgetLedger(2);
    const primera = reserveOperation(ledger, { operationId: 'op', operationKey: 'organization_enrichment', estimatedCredits: 1 });
    assert.equal(primera.ok, true);
    if (primera.ok) {
      ledger = primera.ledger;
      assert.equal(primera.alreadyReserved, false);
    }

    const reintento = reserveOperation(ledger, { operationId: 'op', operationKey: 'organization_enrichment', estimatedCredits: 1 });
    assert.equal(reintento.ok, true);
    if (reintento.ok) assert.equal(reintento.alreadyReserved, true, 'idempotente por operación');

    assert.equal(committedCredits(ledger), 1, 'un solo cargo posible, un solo compromiso');
  });

  test('respuesta perdida: la reserva se conserva aunque no se sepa el coste', () => {
    let ledger = createRunBudgetLedger(2);
    const r = reserveOperation(ledger, { operationId: 'perdida', operationKey: 'organizations_search', estimatedCredits: 1 });
    if (r.ok) ledger = r.ledger;
    ledger = markOperationIndeterminate(ledger, { operationId: 'perdida', observedCredits: null });
    assert.equal(remainingCredits(ledger), 1, 'no devuelve el crédito que pudo cobrarse');
  });
});

// ── G5 · liquidación ─────────────────────────────────────────────────────────

describe('§ G5 — liquidar sólo puede devolver, nunca inventar', () => {
  test('un `no_match` que no cobra devuelve el crédito reservado', () => {
    let ledger = createRunBudgetLedger(5);
    const r = reserveOperation(ledger, { operationId: 'e1', operationKey: 'organization_enrichment', estimatedCredits: 1 });
    if (r.ok) ledger = r.ledger;
    assert.equal(remainingCredits(ledger), 4);
    ledger = settleOperation(ledger, { operationId: 'e1', credits: 0 });
    assert.equal(remainingCredits(ledger), 5, 'lo que no costó vuelve al remanente');
  });

  test('una liquidación por ENCIMA de lo reservado se cuenta entera', () => {
    let ledger = createRunBudgetLedger(5);
    const r = reserveOperation(ledger, { operationId: 'e1', operationKey: 'organizations_search', estimatedCredits: 1 });
    if (r.ok) ledger = r.ledger;
    ledger = settleOperation(ledger, { operationId: 'e1', credits: 3 });
    assert.equal(committedCredits(ledger), 3, 'el coste real manda, aunque supere la estimación');
    assert.equal(remainingCredits(ledger), 2);
  });

  test('liquidar una operación que nunca se reservó no crea presupuesto', () => {
    const ledger = settleOperation(createRunBudgetLedger(5), { operationId: 'fantasma', credits: 4 });
    assert.equal(committedCredits(ledger), 0, 'no se inventa una entrada');
    assert.equal(ledger.entries.length, 0);
  });
});
