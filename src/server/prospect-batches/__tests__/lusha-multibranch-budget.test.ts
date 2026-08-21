/**
 * AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 §§ 24/25 — presupuesto consciente
 * del plan y aviso previo coherente.
 *
 * El defecto que estas pruebas impiden es económico y silencioso: reservar 2 para
 * una corrida que puede gastar 6. La reserva se decide ANTES de la primera
 * petición, así que si el techo y el gasto salen de dos cuentas distintas, el
 * sobrepaso ocurre en el proveedor y sólo aparece en la liquidación —donde la
 * migración 121 lo registra fielmente, pero ya se gastó—.
 *
 * La otra mitad es de honestidad con la usuaria: el aviso previo del wizard y la
 * reserva del servidor tienen que salir de la MISMA función, o la UI ofrecerá
 * corridas que la reserva rechaza (o retirará corridas que caben).
 *
 * Todo aquí es PURO: sin DB, sin RPC, sin proveedor.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateLushaRunCredits,
  resolveLushaRunMaxProviderCredits,
  resolveLushaMacroPlanMaxProviderCredits,
  resolveLushaRequiredCreditsByMacroIndustry,
} from '@/server/prospect-batches/lusha-run-liability';
// ROUTING-CUTOVER-1 § 12 — el plan sale de la autoridad del cutover. El puente de
// compatibilidad ya no participa en ninguna resolución de runtime.
import { resolveLushaRoutedSearchPlan } from '@/server/prospect-batches/lusha-macro-capability';
import { MACRO_INDUSTRY_KEYS } from '@/modules/macro-industry-catalog/macro-industries';
import { resolveLushaProviderRequestsAllowed } from '@/server/prospect-batches/lusha-multibranch-execution';
import {
  decideLushaCreditsToConfirm,
  shouldReleaseLushaReservation,
} from '@/modules/prospect-batches/lusha-budget-gate';
import {
  resolveLushaPreExecutionBudgetBlock,
  resolveLushaPreflightRequiredCredits,
  type WizardBudgetPreflight,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';

const plan = (branchCount: 1 | 2 | 3) => ({
  branches: [
    { mainIndustryId: 11, label: 'Healthcare' },
    { mainIndustryId: 12, subIndustryId: 71, label: 'Pharmaceuticals Manufacturing' },
    { mainIndustryId: 12, subIndustryId: 80, label: 'Medical Equipment' },
  ].slice(0, branchCount),
});

// ── § 24 ──────────────────────────────────────────────────────────────────────

describe('§ 24 — la reserva es consciente del plan', () => {
  it('1 rama → 2 · 2 ramas → 4 · 3 ramas → 6', () => {
    assert.equal(estimateLushaRunCredits(plan(1)), 2);
    assert.equal(estimateLushaRunCredits(plan(2)), 4);
    assert.equal(estimateLushaRunCredits(plan(3)), 6);
  });

  it('sin plan sigue reservando 2: la ruta legacy no cambia', () => {
    assert.equal(estimateLushaRunCredits(), 2);
    assert.equal(estimateLushaRunCredits(null), 2);
    assert.equal(estimateLushaRunCredits(undefined), 2);
    assert.equal(estimateLushaRunCredits(), resolveLushaRunMaxProviderCredits());
  });

  it('no hay una segunda tabla: la reserva ES el techo del plan', () => {
    for (const branchCount of [1, 2, 3] as const) {
      assert.equal(
        estimateLushaRunCredits(plan(branchCount)),
        resolveLushaMacroPlanMaxProviderCredits(plan(branchCount)),
      );
    }
  });

  it('🔴 el ejecutor no puede INTENTAR gastar por encima de lo reservado', () => {
    // Invariante central de § 20/§ 24: el techo de peticiones y los créditos
    // reservados son el MISMO número. El ejecutor rechaza la petición que lo
    // rebasaría (probado en la suite del ejecutor), así que un sobrepaso sólo
    // puede venir del proveedor cobrando más por petición — nunca de pedir más.
    for (const branchCount of [1, 2, 3] as const) {
      assert.equal(
        resolveLushaProviderRequestsAllowed(branchCount),
        estimateLushaRunCredits(plan(branchCount)),
      );
    }
  });

  it('el techo NO se codifica por clave de macro: sale del número de ramas', () => {
    // Un plan sintético de 2 ramas con la clave de una macro de 3 reserva 4, no 6.
    const health = resolveLushaRoutedSearchPlan('health_pharma');
    assert.equal(health?.branches.length, 3);
    assert.equal(estimateLushaRunCredits(health), 6);
    assert.equal(estimateLushaRunCredits({ branches: health!.branches.slice(0, 2) }), 4);
  });
});

describe('§ 24 — liquidación: se confirma lo que el proveedor reportó', () => {
  it('la rama 0 cierra temprano: reservado 6, real 1 → se confirma 1', () => {
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 6, creditsChargedTotal: 1 }),
      1,
    );
  });

  it('dos peticiones: reservado 6, real 2 → se confirma 2', () => {
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 6, creditsChargedTotal: 2 }),
      2,
    );
  });

  it('gasto NO verificable → se confirma la reserva entera (regla conservadora)', () => {
    // Sin cifra del proveedor no se sabe si cobró; devolver headroom que sí se
    // gastó dejaría el período mintiendo por encima de lo real.
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 6, creditsChargedTotal: null }),
      6,
    );
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 6, creditsChargedTotal: undefined }),
      6,
    );
  });

  it('real > reservado → se confirma lo REPORTADO, sin recortar (vía M121)', () => {
    // § 20 — el sobrepaso se registra tal cual (`confirmed_with_overage`); un clamp
    // sería un undercount del gasto real.
    assert.equal(
      decideLushaCreditsToConfirm({ creditsReserved: 6, creditsChargedTotal: 8 }),
      8,
    );
  });

  it('cero peticiones y cero cobro → se LIBERA, no se confirma', () => {
    assert.equal(
      shouldReleaseLushaReservation({ pagesRequested: 0, creditsChargedTotal: null }),
      true,
    );
    // Con una sola petición hecha ya no se libera: el proveedor pudo cobrarla.
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

// ── § 25 ──────────────────────────────────────────────────────────────────────

const preflight = (available: number): WizardBudgetPreflight => ({
  availableCredits: available,
  requiredCreditsByProvider: { tavily: 5, apollo_organizations: 25 } as never,
  lushaRequiredCredits: 2,
  lushaRequiredCreditsByMacroIndustry: resolveLushaRequiredCreditsByMacroIndustry(),
});

describe('§ 25 — el aviso previo pide lo mismo que la reserva', () => {
  it('la tabla publica exactamente las MACRO ROUTABLE (ROUTING-CUTOVER-1 § 12)', () => {
    // Inversión deliberada del ratchet de #302, que exigía los tres sectores
    // legacy. Tras el cutover la ruta transporta claves de macro, así que una
    // tabla indexada por sectores no tendría ni una fila coincidente: las doce
    // macro caerían al respaldo de 2 y el aviso prometería 2 para corridas de 6.
    const byMacro = resolveLushaRequiredCreditsByMacroIndustry();
    assert.deepEqual(Object.keys(byMacro).sort(), [...MACRO_INDUSTRY_KEYS].sort());
    // 🔴 Y `education` no aparece: no es una macro de SellUp.
    assert.equal(Object.hasOwn(byMacro, 'education'), false);
  });

  it('macro de 1 rama (technology) → 2 requeridos', () => {
    assert.equal(resolveLushaPreflightRequiredCredits(preflight(100), 'technology'), 2);
    assert.equal(
      resolveLushaPreflightRequiredCredits(preflight(100), 'technology'),
      estimateLushaRunCredits(resolveLushaRoutedSearchPlan('technology')),
    );
  });

  it('macro de 3 ramas (health_pharma) → 6 requeridos', () => {
    assert.equal(resolveLushaPreflightRequiredCredits(preflight(100), 'health_pharma'), 6);
    assert.equal(
      resolveLushaPreflightRequiredCredits(preflight(100), 'health_pharma'),
      estimateLushaRunCredits(resolveLushaRoutedSearchPlan('health_pharma')),
    );
  });

  it('macro de 2 ramas (consumer_goods) → 4: la cifra intermedia es real', () => {
    assert.equal(resolveLushaPreflightRequiredCredits(preflight(100), 'consumer_goods'), 4);
    assert.equal(
      estimateLushaRunCredits(resolveLushaRoutedSearchPlan('consumer_goods')),
      4,
    );
  });

  it('`education` no tiene fila y cae al respaldo, sin inventar un techo', () => {
    // No es una macro routable, así que no está en la tabla. El respaldo publicado
    // (el techo de una rama) es lo que devuelve, y quien decide de verdad sigue
    // siendo la reserva atómica.
    assert.equal(resolveLushaPreflightRequiredCredits(preflight(100), 'education'), 2);
  });

  it('disponible < requerido → el aviso retira la oferta', () => {
    // 5 disponibles no alcanzan para los 6 de salud, y sí para los 2 de technology.
    const block = resolveLushaPreExecutionBudgetBlock(preflight(5), 'health_pharma');
    assert.equal(block?.reason, 'insufficient_for_run');
    assert.equal(block?.availableCredits, 5);
    assert.equal(block?.requiredCredits, 6);
    assert.equal(resolveLushaPreExecutionBudgetBlock(preflight(5), 'technology'), null);
  });

  it('la comparación es ESTRICTA: 6 disponibles y 6 requeridos CABE', () => {
    assert.equal(resolveLushaPreExecutionBudgetBlock(preflight(6), 'healthcare'), null);
  });

  it('0 disponibles → agotado', () => {
    assert.equal(
      resolveLushaPreExecutionBudgetBlock(preflight(0), 'healthcare')?.reason,
      'exhausted',
    );
  });

  it('🔴 sin instantánea NO se bloquea: la reserva sigue siendo la autoridad', () => {
    assert.equal(resolveLushaPreExecutionBudgetBlock(null, 'health_pharma'), null);
    assert.equal(resolveLushaPreExecutionBudgetBlock(undefined, 'health_pharma'), null);
    assert.equal(resolveLushaPreflightRequiredCredits(null, 'health_pharma'), null);
  });

  it('sin tabla por sector se conserva el aviso de hoy (respaldo)', () => {
    // Un cliente servido por un despliegue anterior conserva su aviso en lugar de
    // quedarse sin ninguno.
    const legacy: WizardBudgetPreflight = {
      availableCredits: 3,
      requiredCreditsByProvider: { tavily: 5, apollo_organizations: 25 } as never,
      lushaRequiredCredits: 2,
    };
    assert.equal(resolveLushaPreflightRequiredCredits(legacy, 'health_pharma'), 2);
    assert.equal(resolveLushaPreExecutionBudgetBlock(legacy, 'health_pharma'), null);
  });

  it('sin techo resoluble NO se inventa una cifra y no se bloquea', () => {
    const noCeiling: WizardBudgetPreflight = {
      availableCredits: 0,
      requiredCreditsByProvider: { tavily: 5, apollo_organizations: 25 } as never,
      lushaRequiredCredits: null,
      lushaRequiredCreditsByMacroIndustry: null,
    };
    assert.equal(resolveLushaPreflightRequiredCredits(noCeiling, 'health_pharma'), null);
    assert.equal(resolveLushaPreExecutionBudgetBlock(noCeiling, 'health_pharma'), null);
  });

  it('un sector que no está en la tabla usa el respaldo', () => {
    assert.equal(resolveLushaPreflightRequiredCredits(preflight(100), 'energia'), 2);
    assert.equal(resolveLushaPreflightRequiredCredits(preflight(100), null), 2);
    assert.equal(resolveLushaPreflightRequiredCredits(preflight(100)), 2);
  });
});
