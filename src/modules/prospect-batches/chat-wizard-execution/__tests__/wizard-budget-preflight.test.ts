/**
 * wizard-budget-preflight.test.ts — núcleo PURO del bloqueo previo.
 *
 * AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 ·
 * AGENT1-WIZARD-BUDGET-UI-APOLLO-DECOUPLE-1.
 *
 * Lo que se fija aquí no es «hay un aviso», sino las propiedades que impiden que
 * este bloqueo se convierta en un problema peor que el que resuelve:
 *
 *   1. Sin instantánea NO se bloquea. Una lectura fallida no puede dejar a todo
 *      el mundo sin poder ejecutar.
 *   2. La comparación es ESTRICTA. Con 20 disponibles y 20 requeridos la corrida
 *      cabe exacta y debe ofrecerse, porque es lo que la reserva atómica
 *      aceptaría.
 *   3. «Se agotó» sólo con saldo 0 o negativo; con saldo positivo insuficiente,
 *      lo que bloquea es el tamaño de esta corrida.
 *   4. Apollo NUNCA se bloquea por ESTE pool. Desde
 *      AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 (#386) reserva su propia cuota
 *      de Providers & Consumption, no `wizard_monthly_budget_periods` — así que
 *      `availableCredits` (el saldo de ESE pool) no puede sostener un bloqueo
 *      para Apollo, con cualquier saldo. Tavily sigue exactamente igual que
 *      antes: sigue financiado por este pool.
 *
 * Sin red, sin DOM, sin base, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWizardPreExecutionBudgetBlock,
  type WizardBudgetPreflight,
} from '../wizard-budget-preflight';

/**
 * Forma REAL que produce `resolveWizardBudgetPreflightForSurface` desde
 * AGENT1-WIZARD-BUDGET-UI-APOLLO-DECOUPLE-1: sin entrada de Apollo, porque
 * Apollo ya no se financia con este pool.
 */
function preflight(available: number, tavily = 20): WizardBudgetPreflight {
  return {
    availableCredits: available,
    requiredCreditsByProvider: { tavily },
  };
}

describe('§ 1 — Tavily: el caso real de Producción: available 5 / required 20', () => {
  it('bloquea, y lo hace como «no alcanza para esta corrida», no como «se agotó»', () => {
    const block = resolveWizardPreExecutionBudgetBlock(preflight(5), 'tavily');
    assert.deepEqual(block, {
      reason: 'insufficient_for_run',
      availableCredits: 5,
      requiredCredits: 20,
    });
  });
});

describe('§ 1B — Apollo: AGENT1-WIZARD-BUDGET-UI-APOLLO-DECOUPLE-1 — este pool ya NO lo financia', () => {
  it('con el pool agotado (0 disponibles) Apollo no se bloquea', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(preflight(0), 'apollo_organizations'), null);
  });

  it('con saldo negativo (sobreconsumo del pool) Apollo tampoco se bloquea', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(preflight(-3), 'apollo_organizations'), null);
  });

  it('el mismo saldo (5) que bloquea a Tavily NO bloquea a Apollo', () => {
    assert.notEqual(resolveWizardPreExecutionBudgetBlock(preflight(5), 'tavily'), null);
    assert.equal(resolveWizardPreExecutionBudgetBlock(preflight(5), 'apollo_organizations'), null);
  });

  it('defensa en profundidad: aunque `requiredCreditsByProvider` trajera una entrada vieja de Apollo, sigue sin bloquear', () => {
    // La rama explícita del resolutor es la autoridad, no la ausencia de la
    // clave: un preflight que por error siguiera publicando el viejo techo de
    // Apollo (25) contra un saldo insuficiente (5) tampoco puede bloquearlo.
    const withLegacyApolloEntry = {
      availableCredits: 5,
      requiredCreditsByProvider: { tavily: 20, apollo_organizations: 25 },
    } as WizardBudgetPreflight;
    assert.equal(
      resolveWizardPreExecutionBudgetBlock(withLegacyApolloEntry, 'apollo_organizations'),
      null,
    );
  });
});

describe('§ 2 — presupuesto suficiente para Tavily: no se bloquea nada', () => {
  it('available = required no bloquea (comparación estricta)', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(preflight(20), 'tavily'), null);
  });

  it('available > required no bloquea', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(preflight(40), 'tavily'), null);
  });
});

describe('§ 3 — presupuesto agotado (Tavily, sin cambios)', () => {
  it('available = 0 bloquea como «exhausted»', () => {
    const block = resolveWizardPreExecutionBudgetBlock(preflight(0), 'tavily');
    assert.equal(block?.reason, 'exhausted');
    assert.equal(block?.availableCredits, 0);
  });

  it('un saldo negativo (sobreconsumo) también es «exhausted», nunca un número inventado', () => {
    const block = resolveWizardPreExecutionBudgetBlock(preflight(-3), 'tavily');
    assert.equal(block?.reason, 'exhausted');
    assert.equal(block?.availableCredits, -3);
  });
});

describe('§ 4 — sin instantánea NO se bloquea (la RPC sigue siendo la autoridad)', () => {
  it('`null` no bloquea', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(null, 'tavily'), null);
  });

  it('`undefined` no bloquea', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(undefined, 'tavily'), null);
  });

  it('un coste ausente para el proveedor elegido no bloquea', () => {
    const partial = {
      availableCredits: 5,
      requiredCreditsByProvider: {},
    } as WizardBudgetPreflight;
    assert.equal(resolveWizardPreExecutionBudgetBlock(partial, 'tavily'), null);
  });

  it('un coste no finito no bloquea', () => {
    const broken = preflight(5);
    broken.requiredCreditsByProvider.tavily = Number.NaN;
    assert.equal(resolveWizardPreExecutionBudgetBlock(broken, 'tavily'), null);
  });

  it('un coste 0 o negativo no sostiene un bloqueo', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(preflight(5, 0), 'tavily'), null);
    assert.equal(resolveWizardPreExecutionBudgetBlock(preflight(5, -1), 'tavily'), null);
  });

  it('un saldo no finito no bloquea', () => {
    const broken = preflight(Number.NaN);
    assert.equal(resolveWizardPreExecutionBudgetBlock(broken, 'tavily'), null);
  });
});
