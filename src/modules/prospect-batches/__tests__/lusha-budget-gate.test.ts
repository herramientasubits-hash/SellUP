/**
 * lusha-budget-gate.test.ts — la ruta Lusha de Agente 1 obedece el MISMO modelo
 * económico que Apollo/Tavily.
 *
 * AGENT1-LUSHA-BUDGET-GATE-1 § 13.
 *
 * El defecto que estas pruebas fijan: `generateLushaPendingReviewBatchAction`
 * tenía UNA puerta (el flag). Con el flag encendido resolvía la credencial,
 * construía el cliente y llamaba a Lusha sin que nada hubiera comprobado que el
 * período global tenía sitio — mientras la ruta Apollo/Tavily no puede dar un
 * paso sin `try_reserve_wizard_credits`.
 *
 * Lo que se prueba aquí NO es «hay una comprobación de presupuesto». Eso lo
 * cumpliría un `if` decorativo. Se prueba la propiedad ESTRUCTURAL: con el
 * presupuesto denegado, el contador de creaciones de cliente de proveedor, el de
 * búsquedas y el de escrituras quedan todos en 0, porque `run()` es lo único que
 * los toca.
 *
 * Sin red, sin proveedor, sin base, sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  guardLushaRunBudget,
  decideLushaCreditsToConfirm,
  shouldReleaseLushaReservation,
  resolveLushaBudgetExceededDetail,
  LUSHA_BUDGET_BLOCKED_ERROR,
  LUSHA_BUDGET_UNAVAILABLE_ERROR,
  type LushaBudgetReserveOutcome,
  type LushaBudgetExceededDetail,
} from '@/modules/prospect-batches/lusha-budget-gate';
import {
  resolveLushaRunLiability,
  resolveLushaRunMaxProviderCredits,
  assertLushaRunLiabilityCoherent,
  estimateLushaRunCredits,
  toLushaRunLiabilityMetadata,
  LUSHA_RUN_LIABILITY_SOURCE,
} from '@/server/prospect-batches/lusha-run-liability';
import {
  LUSHA_PENDING_REVIEW_MAX_PAGES,
  LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS,
} from '@/server/prospect-batches/lusha-pending-review';
import { LUSHA_PREVIEW_EXPECTED_MAX_CREDITS } from '@/server/prospect-batches/lusha-preview';
import {
  resolveLushaPreExecutionBudgetBlock,
  resolveWizardPreExecutionBudgetBlock,
  type WizardBudgetPreflight,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';
import { guardLushaPreviewEnabled } from '@/modules/prospect-batches/lusha-preview-flag-guard';

// ── Doble del proveedor, con contadores ───────────────────────────────────────
//
// Espeja la estructura real: la credencial se resuelve, luego se construye el
// cliente, luego se busca, luego se escribe. Cada paso incrementa su contador,
// así que «0» es una afirmación sobre lo que NO ocurrió, no sobre una intención.

type ProviderSpy = {
  credentialResolutions: number;
  clientCreations: number;
  searches: number;
  writes: number;
};

function newProviderSpy(): ProviderSpy {
  return { credentialResolutions: 0, clientCreations: 0, searches: 0, writes: 0 };
}

/**
 * Forma única del resultado en las pruebas del seam.
 *
 * Explícita a propósito: si `blocked()` y `run()` devolvieran formas inferidas
 * distintas, TypeScript colapsaría el genérico a la primera y las aserciones
 * sobre el camino bloqueado dejarían de comprobar tipos.
 */
type GateOutcome = {
  ok: boolean;
  code?: string;
  message?: string;
  budgetExceeded?: LushaBudgetExceededDetail | null;
  creditsChargedTotal?: number | null;
  pagesRequested?: number;
};

/** Lo ÚNICO que toca al proveedor. Se pasa como `run()` del seam. */
async function runLushaWork(
  spy: ProviderSpy,
  creditsChargedTotal: number | null = 1,
  pagesRequested = 1,
): Promise<GateOutcome> {
  spy.credentialResolutions += 1;
  spy.clientCreations += 1;
  spy.searches += 1;
  spy.writes += 1;
  return { ok: true, creditsChargedTotal, pagesRequested };
}

const RESERVED: LushaBudgetReserveOutcome = {
  status: 'reserved',
  reservationId: 'res-1',
  creditsReserved: 2,
};

function blockedOutcome(availableCredits: number | null): LushaBudgetReserveOutcome {
  return {
    status: 'blocked',
    code: 'BUDGET_EXCEEDED',
    message: 'insufficient_budget',
    budgetSnapshot: availableCredits === null ? null : { availableCredits },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('§5 — máxima responsabilidad económica de una corrida Lusha', () => {
  it('el techo se DERIVA de las páginas y del crédito por petición, no se escribe a mano', () => {
    assert.equal(
      resolveLushaRunMaxProviderCredits(),
      LUSHA_PENDING_REVIEW_MAX_PAGES * LUSHA_PREVIEW_EXPECTED_MAX_CREDITS,
    );
  });

  it('el techo derivado coincide con el que el writer ya publicaba (expectedMaxCredits)', () => {
    assert.doesNotThrow(() => assertLushaRunLiabilityCoherent());
    assert.equal(resolveLushaRunMaxProviderCredits(), LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS);
  });

  it('NO adopta el modelo de costo de Apollo (25 créditos de dos rondas)', () => {
    // El peor caso de Apollo con dos rondas es 25; el de Lusha es su propio
    // techo. Reservar 25 aquí bloquearía corridas que caben de sobra.
    assert.notEqual(estimateLushaRunCredits(), 25);
    assert.equal(estimateLushaRunCredits(), 2);
  });

  it('el USD sale del pricing por crédito que se le pasa (migración 081), no de la observación 1/25', () => {
    const liability = resolveLushaRunLiability({
      provider_key: 'lusha',
      operation_key: 'company_prospecting_v3',
      unit: 'per_credit',
      unit_cost_usd: 0.08823529,
    });
    assert.equal(liability.maxProviderCredits, 2);
    assert.ok(liability.estimatedMaxCostUsd !== null);
    assert.ok(Math.abs(liability.estimatedMaxCostUsd - 0.17647058) < 1e-9);
    assert.equal(liability.pricingMissingWarning, null);
  });

  it('sin pricing NO inventa un costo: USD null + advertencia, pero el techo en créditos sigue existiendo', () => {
    const liability = resolveLushaRunLiability(null);
    assert.equal(liability.estimatedMaxCostUsd, null);
    assert.match(liability.pricingMissingWarning ?? '', /pricing config not found/);
    // Lo que la reserva necesita es el crédito, no el USD: un pricing ausente no
    // puede impedir la protección económica.
    assert.equal(liability.normalizedBudgetCredits, 2);
  });

  it('los metadatos no llevan secretos y declaran su fuente', () => {
    const meta = toLushaRunLiabilityMetadata(resolveLushaRunLiability(null));
    assert.equal(meta.source, LUSHA_RUN_LIABILITY_SOURCE);
    assert.equal(meta.max_provider_credits, 2);
    assert.equal(JSON.stringify(meta).includes('api'), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('§7 — con presupuesto denegado NO se crea cliente de proveedor', () => {
  it('presupuesto suficiente → la corrida ocurre (control positivo)', async () => {
    const spy = newProviderSpy();
    const out = await guardLushaRunBudget<GateOutcome>(
      async () => RESERVED,
      () => ({ ok: false, creditsChargedTotal: null, pagesRequested: 0 }),
      () => runLushaWork(spy),
      2,
    );
    assert.equal(out.ok, true);
    assert.equal(spy.clientCreations, 1);
    assert.equal(spy.searches, 1);
  });

  it('presupuesto INSUFICIENTE → 0 credenciales, 0 clientes, 0 búsquedas, 0 escrituras', async () => {
    const spy = newProviderSpy();
    const out = await guardLushaRunBudget<GateOutcome>(
      async () => blockedOutcome(1),
      (block) => ({ ok: false, code: block.code, budgetExceeded: block.budgetExceeded }),
      () => runLushaWork(spy),
      2,
    );
    assert.equal(out.ok, false);
    assert.deepEqual(spy, {
      credentialResolutions: 0,
      clientCreations: 0,
      searches: 0,
      writes: 0,
    });
  });

  it('presupuesto en CERO → mismo bloqueo, y el motivo es «agotado»', async () => {
    const spy = newProviderSpy();
    const out = await guardLushaRunBudget<GateOutcome>(
      async () => blockedOutcome(0),
      (block) => ({ ok: false, code: block.code, budgetExceeded: block.budgetExceeded }),
      () => runLushaWork(spy),
      2,
    );
    assert.equal(spy.searches, 0);
    assert.equal(out.budgetExceeded?.reason, 'exhausted');
    assert.equal(out.budgetExceeded?.availableCredits, 0);
    assert.equal(out.budgetExceeded?.requiredCredits, 2);
  });

  it('saldo positivo por debajo del techo → «no alcanza para esta corrida», no «se agotó»', async () => {
    const out = await guardLushaRunBudget<GateOutcome>(
      async () => blockedOutcome(1),
      (block) => ({ ok: false, budgetExceeded: block.budgetExceeded }),
      () => runLushaWork(newProviderSpy()),
      2,
    );
    assert.equal(out.budgetExceeded?.reason, 'insufficient_for_run');
  });

  it('RESERVA DENEGADA por otra guardrail (piloto pausado, período cerrado…) → tampoco se gasta', async () => {
    const spy = newProviderSpy();
    for (const code of [
      'PILOT_PAUSED',
      'NOT_IN_PILOT',
      'BUDGET_PERIOD_NOT_CONFIGURED',
      'BUDGET_PERIOD_CLOSED',
      'EXECUTION_CREDIT_LIMIT_EXCEEDED',
      'CONCURRENT_EXECUTION_ACTIVE',
      'BUDGET_RESERVATION_FAILED',
    ]) {
      const out = await guardLushaRunBudget<GateOutcome>(
        async () => ({ status: 'blocked', code, message: code, budgetSnapshot: null }),
        (block) => ({ ok: false, code: block.code }),
        () => runLushaWork(spy),
        2,
      );
      assert.equal(out.ok, false, code);
      assert.equal(out.code, LUSHA_BUDGET_BLOCKED_ERROR, code);
    }
    assert.equal(spy.clientCreations, 0);
    assert.equal(spy.searches, 0);
  });

  it('FAIL-CLOSED: si la reserva no puede ni intentarse, se bloquea (no se ejecuta a ciegas)', async () => {
    const spy = newProviderSpy();
    const out = await guardLushaRunBudget<GateOutcome>(
      async () => {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
      },
      (block) => ({ ok: false, code: block.code, message: block.message }),
      () => runLushaWork(spy),
      2,
    );
    assert.equal(out.code, LUSHA_BUDGET_UNAVAILABLE_ERROR);
    assert.equal(spy.searches, 0);
    // El mensaje crudo del error NO se filtra al cliente.
    assert.equal(/SERVICE_ROLE/.test(out.message ?? ''), false);
  });

  it('sin instantánea del período se bloquea igual, pero SIN cifras inventadas', async () => {
    const out = await guardLushaRunBudget<GateOutcome>(
      async () => blockedOutcome(null),
      (block) => ({ ok: false, budgetExceeded: block.budgetExceeded }),
      () => runLushaWork(newProviderSpy()),
      2,
    );
    assert.equal(out.budgetExceeded, null);
  });

  it('`already_reserved` es una reserva válida: la corrida procede sobre ella', async () => {
    const spy = newProviderSpy();
    const out = await guardLushaRunBudget<GateOutcome>(
      async () => ({ status: 'already_reserved', reservationId: 'res-1', creditsReserved: 2 }),
      () => ({ ok: false, creditsChargedTotal: null, pagesRequested: 0 }),
      () => runLushaWork(spy),
      2,
    );
    assert.equal(out.ok, true);
    assert.equal(spy.searches, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('§10 — orden entre la puerta de flag y la de presupuesto', () => {
  it('flag OFF → no se reserva NI se gasta (la puerta de flag sigue siendo la de fuera)', async () => {
    const spy = newProviderSpy();
    let reserveAttempts = 0;
    type Outcome = { ok: boolean; blockedBy: 'flag' | 'budget' | null };
    const out = await guardLushaPreviewEnabled<Outcome>(
      false,
      () => ({ ok: false, blockedBy: 'flag' }),
      async () =>
        guardLushaRunBudget<Outcome>(
          async () => {
            reserveAttempts += 1;
            return RESERVED;
          },
          () => ({ ok: false, blockedBy: 'budget' }),
          async () => {
            await runLushaWork(spy);
            return { ok: true, blockedBy: null };
          },
          2,
        ),
    );
    assert.equal(out.blockedBy, 'flag');
    // Un flag apagado no debe ni tocar el presupuesto: reservar créditos para una
    // corrida imposible los inmovilizaría por nada.
    assert.equal(reserveAttempts, 0);
    assert.equal(spy.searches, 0);
  });

  it('flag ON + presupuesto bloqueado → se intenta reservar, y se para ahí', async () => {
    const spy = newProviderSpy();
    let reserveAttempts = 0;
    type Outcome = { ok: boolean; blockedBy: 'flag' | 'budget' | null };
    const out = await guardLushaPreviewEnabled<Outcome>(
      true,
      () => ({ ok: false, blockedBy: 'flag' }),
      async () =>
        guardLushaRunBudget<Outcome>(
          async () => {
            reserveAttempts += 1;
            return blockedOutcome(0);
          },
          () => ({ ok: false, blockedBy: 'budget' }),
          async () => {
            await runLushaWork(spy);
            return { ok: true, blockedBy: null };
          },
          2,
        ),
    );
    assert.equal(out.blockedBy, 'budget');
    assert.equal(reserveAttempts, 1);
    assert.equal(spy.credentialResolutions, 0);
    assert.equal(spy.clientCreations, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('§9 — reconciliación del gasto real', () => {
  it('gasto real MENOR que la reserva → se confirma el real y el headroom vuelve al período', () => {
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: 1 }),
      1,
    );
  });

  it('gasto real IGUAL a la reserva → se confirma la reserva entera', () => {
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: 2 }),
      2,
    );
  });

  it('gasto NO VERIFICABLE (null) → se confirma la reserva entera, nunca menos', () => {
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: null }),
      2,
    );
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: undefined }),
      2,
    );
  });

  it('un 0 REPORTADO por el proveedor se respeta (no es lo mismo que «no reportado»)', () => {
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: 0 }),
      0,
    );
  });

  it('SOBREPASO registrado → se confirma lo reportado, no se recorta a la reserva', () => {
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: 5 }),
      5,
    );
  });

  it('valores absurdos (negativo, NaN) caen al sesgo conservador', () => {
    assert.equal(decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: -3 }), 2);
    assert.equal(decideLushaCreditsToConfirm({ creditsReserved: 2, creditsChargedTotal: NaN }), 2);
  });

  it('sólo se LIBERA cuando no se pidió ninguna página y no hay cobro', () => {
    assert.equal(
      shouldReleaseLushaReservation({ pagesRequested: 0, creditsChargedTotal: null }),
      true,
    );
  });

  it('un fallo DESPUÉS de la primera petición se confirma, no se libera (el proveedor pudo cobrar)', () => {
    assert.equal(
      shouldReleaseLushaReservation({ pagesRequested: 1, creditsChargedTotal: null }),
      false,
    );
    assert.equal(
      shouldReleaseLushaReservation({ pagesRequested: 0, creditsChargedTotal: 1 }),
      false,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('§6 — aviso previo: mismo comparador que Tavily, sin ensanchar el radio', () => {
  // AGENT1-WIZARD-BUDGET-UI-APOLLO-DECOUPLE-1 — la fixture ya no trae una
  // entrada de Apollo: desde #386 Apollo no se financia con este pool, así que
  // `requiredCreditsByProvider` real tampoco la trae (ver
  // wizard-budget-preflight.server.ts). Tavily sigue exactamente igual.
  const preflight = (available: number, lusha: number | null): WizardBudgetPreflight => ({
    availableCredits: available,
    requiredCreditsByProvider: { tavily: 20 },
    lushaRequiredCredits: lusha,
  });

  it('presupuesto suficiente → no bloquea', () => {
    assert.equal(resolveLushaPreExecutionBudgetBlock(preflight(10, 2)), null);
  });

  it('cabe EXACTO → se ofrece (la comparación es estricta, igual que en Apollo)', () => {
    assert.equal(resolveLushaPreExecutionBudgetBlock(preflight(2, 2)), null);
  });

  it('el presupuesto real de agosto (0 disponibles) bloquea Lusha por «agotado»', () => {
    const block = resolveLushaPreExecutionBudgetBlock(preflight(0, 2));
    assert.deepEqual(block, {
      reason: 'exhausted',
      availableCredits: 0,
      requiredCredits: 2,
    });
  });

  it('1 disponible y 2 requeridos → «no alcanza para esta corrida»', () => {
    assert.equal(
      resolveLushaPreExecutionBudgetBlock(preflight(1, 2))?.reason,
      'insufficient_for_run',
    );
  });

  it('sin instantánea NO bloquea (un fallo de diagnóstico no puede bloquear a nadie)', () => {
    assert.equal(resolveLushaPreExecutionBudgetBlock(null), null);
    assert.equal(resolveLushaPreExecutionBudgetBlock(undefined), null);
  });

  it('techo de Lusha no resoluble → NO bloquea, y NO cae al número de otro proveedor', () => {
    assert.equal(resolveLushaPreExecutionBudgetBlock(preflight(1, null)), null);
    // Con 1 disponible, el techo de Tavily (20) sí bloquearía. Que Lusha no
    // bloquee prueba que no está leyendo la casilla equivocada.
    assert.notEqual(resolveWizardPreExecutionBudgetBlock(preflight(1, null), 'tavily'), null);
  });

  it('NO hay regresión cruzada: el número de Tavily no cambia, y Apollo sigue sin bloquearse por este pool', () => {
    const p = preflight(21, 2);
    // 21 disponibles: cabe Tavily (20), cabe Lusha (2).
    assert.equal(resolveWizardPreExecutionBudgetBlock(p, 'tavily'), null);
    // AGENT1-WIZARD-BUDGET-UI-APOLLO-DECOUPLE-1 — Apollo ya no se compara contra
    // este pool en absoluto, así que ningún saldo de este pool puede bloquearlo.
    assert.equal(resolveWizardPreExecutionBudgetBlock(p, 'apollo_organizations'), null);
    assert.equal(resolveLushaPreExecutionBudgetBlock(p), null);
  });

  it('un preflight SIN campo de Lusha (forma vieja) no bloquea nada', () => {
    const legacy = {
      availableCredits: 1,
      requiredCreditsByProvider: { tavily: 20, apollo_organizations: 25 },
    } as WizardBudgetPreflight;
    assert.equal(resolveLushaPreExecutionBudgetBlock(legacy), null);
  });

  it('Lusha NO entra en la unión de proveedores elegibles (sigue oculto)', async () => {
    const { WIZARD_RUN_SELECTABLE_PROVIDERS } = await import(
      '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability'
    );
    assert.equal((WIZARD_RUN_SELECTABLE_PROVIDERS as readonly string[]).includes('lusha'), false);
    assert.deepEqual([...WIZARD_RUN_SELECTABLE_PROVIDERS], ['tavily', 'apollo_organizations']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('§3 — un solo presupuesto global, no uno de Lusha', () => {
  it('el detalle del bloqueo tiene la MISMA forma que el de Apollo (mismo redactor)', () => {
    const detail = resolveLushaBudgetExceededDetail({ availableCredits: 1 }, 2);
    assert.deepEqual(Object.keys(detail ?? {}).sort(), [
      'availableCredits',
      'reason',
      'requiredCredits',
    ]);
  });

  it('un disponible no finito no sostiene un aviso', () => {
    assert.equal(resolveLushaBudgetExceededDetail({ availableCredits: NaN }, 2), null);
  });
});
