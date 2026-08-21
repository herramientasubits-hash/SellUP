/**
 * wizard-budget-preflight.test.ts — núcleo PURO del bloqueo previo.
 *
 * AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1.
 *
 * Lo que se fija aquí no es «hay un aviso», sino las tres propiedades que
 * impiden que este bloqueo se convierta en un problema peor que el que resuelve:
 *
 *   1. Sin instantánea NO se bloquea. Una lectura fallida no puede dejar a todo
 *      el mundo sin poder ejecutar.
 *   2. La comparación es ESTRICTA. Con 25 disponibles y 25 requeridos la corrida
 *      cabe exacta y debe ofrecerse, porque es lo que la reserva atómica
 *      aceptaría.
 *   3. «Se agotó» sólo con saldo 0 o negativo; con saldo positivo insuficiente,
 *      lo que bloquea es el tamaño de esta corrida.
 *
 * Sin red, sin DOM, sin base, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWizardPreExecutionBudgetBlock,
  type WizardBudgetPreflight,
} from '../wizard-budget-preflight';

function preflight(available: number, apollo = 25, tavily = 20): WizardBudgetPreflight {
  return {
    availableCredits: available,
    requiredCreditsByProvider: { apollo_organizations: apollo, tavily },
  };
}

describe('§ 1 — el caso real de Producción: available 5 / required 25', () => {
  it('bloquea, y lo hace como «no alcanza para esta corrida», no como «se agotó»', () => {
    const block = resolveWizardPreExecutionBudgetBlock(preflight(5), 'apollo_organizations');
    assert.deepEqual(block, {
      reason: 'insufficient_for_run',
      availableCredits: 5,
      requiredCredits: 25,
    });
  });

  it('el mismo saldo también bloquea una corrida de Tavily (5 < 20)', () => {
    const block = resolveWizardPreExecutionBudgetBlock(preflight(5), 'tavily');
    assert.equal(block?.reason, 'insufficient_for_run');
    assert.equal(block?.requiredCredits, 20);
  });
});

describe('§ 2 — presupuesto suficiente: no se bloquea nada', () => {
  it('available = required no bloquea (comparación estricta)', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(preflight(25), 'apollo_organizations'), null);
  });

  it('available > required no bloquea', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(preflight(40), 'apollo_organizations'), null);
  });

  it('available = required también para Tavily', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(preflight(20), 'tavily'), null);
  });
});

describe('§ 3 — presupuesto agotado', () => {
  it('available = 0 bloquea como «exhausted»', () => {
    const block = resolveWizardPreExecutionBudgetBlock(preflight(0), 'apollo_organizations');
    assert.equal(block?.reason, 'exhausted');
    assert.equal(block?.availableCredits, 0);
  });

  it('un saldo negativo (sobreconsumo) también es «exhausted», nunca un número inventado', () => {
    const block = resolveWizardPreExecutionBudgetBlock(preflight(-3), 'apollo_organizations');
    assert.equal(block?.reason, 'exhausted');
    assert.equal(block?.availableCredits, -3);
  });
});

describe('§ 4 — sin instantánea NO se bloquea (la RPC sigue siendo la autoridad)', () => {
  it('`null` no bloquea', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(null, 'apollo_organizations'), null);
  });

  it('`undefined` no bloquea', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(undefined, 'apollo_organizations'), null);
  });

  it('un coste ausente para el proveedor elegido no bloquea', () => {
    const partial = {
      availableCredits: 5,
      requiredCreditsByProvider: { tavily: 20 },
    } as unknown as WizardBudgetPreflight;
    assert.equal(resolveWizardPreExecutionBudgetBlock(partial, 'apollo_organizations'), null);
  });

  it('un coste no finito no bloquea', () => {
    const broken = preflight(5);
    broken.requiredCreditsByProvider.apollo_organizations = Number.NaN;
    assert.equal(resolveWizardPreExecutionBudgetBlock(broken, 'apollo_organizations'), null);
  });

  it('un coste 0 o negativo no sostiene un bloqueo', () => {
    assert.equal(resolveWizardPreExecutionBudgetBlock(preflight(5, 0), 'apollo_organizations'), null);
    assert.equal(resolveWizardPreExecutionBudgetBlock(preflight(5, -1), 'apollo_organizations'), null);
  });

  it('un saldo no finito no bloquea', () => {
    const broken = preflight(Number.NaN);
    assert.equal(resolveWizardPreExecutionBudgetBlock(broken, 'apollo_organizations'), null);
  });
});
