/**
 * lusha-budget-gate-static.test.ts — el ORDEN real dentro de la server action.
 *
 * AGENT1-LUSHA-BUDGET-GATE-1 § 7/§ 10/§ 14.
 *
 * Por qué una suite estática y no sólo la de comportamiento: el seam puro
 * (`lusha-budget-gate.test.ts`) prueba que un bloqueo es incapaz de gastar, pero
 * no puede probar que la ACCIÓN REAL lo esté usando. Un `guardLushaRunBudget`
 * perfecto y no cableado deja el defecto exactamente donde estaba —que es la
 * forma que tuvo el fallo original: existía toda la maquinaria de reserva de
 * Agente 1 y la ruta Lusha simplemente no la llamaba.
 *
 * Estas aserciones son RATCHETS de posición: si alguien mueve la reserva por
 * debajo de la búsqueda, o resuelve la credencial antes de la puerta, fallan.
 *
 * Sin red, sin proveedor, sin base, sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const ACTION_PATH = 'src/modules/prospect-batches/lusha-pending-review-actions.ts';
const GATE_PATH = 'src/modules/prospect-batches/lusha-budget-gate.ts';
const LIABILITY_PATH = 'src/server/prospect-batches/lusha-run-liability.ts';
const UI_PATH = 'src/components/prospect-batches/chat-wizard/wizard-lusha-final-search.tsx';

const action = read(ACTION_PATH);
const gate = read(GATE_PATH);
const liability = read(LIABILITY_PATH);
const ui = read(UI_PATH);

/**
 * Quita comentarios de bloque y de línea.
 *
 * Necesario porque estas fuentes DOCUMENTAN a propósito lo que no hacen («no
 * copia el modelo de Apollo», «no es un presupuesto propio de Lusha»), y una
 * búsqueda de subcadena sobre la prosa daría un falso positivo justo por
 * explicarse bien.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Índice de la primera aparición; -1 se trata como fallo explícito. */
function at(source: string, needle: string): number {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `no se encontró "${needle}"`);
  return index;
}

describe('§7 — la acción reserva ANTES de poder gastar', () => {
  it('la acción importa y USA el seam de presupuesto', () => {
    assert.match(action, /import\s*\{[^}]*guardLushaRunBudget/);
    assert.match(action, /return guardLushaRunBudget\(/);
  });

  it('el techo de la corrida sale de `estimateLushaRunCredits`, no de un número escrito a mano', () => {
    assert.match(action, /const requiredCredits = estimateLushaRunCredits\(\);/);
    // Ningún literal de crédito suelto alimentando la reserva.
    assert.equal(/requestedCredits:\s*\d+/.test(action), false);
    assert.equal(/requiredCredits\s*=\s*\d+/.test(action), false);
  });

  it('`guardLushaRunBudget` aparece ANTES de `persistLushaPendingReviewBatch`', () => {
    assert.ok(at(action, 'return guardLushaRunBudget(') < at(action, 'persistLushaPendingReviewBatch('));
  });

  it('la reserva atómica aparece ANTES de la llamada al proveedor', () => {
    assert.ok(at(action, 'reserveWizardPilotCredits(') < at(action, 'searchLushaCompaniesV3('));
  });

  it('la credencial se resuelve DESPUÉS de la puerta y de forma perezosa (dentro de runSearch)', () => {
    // `getLushaApiKey` sólo puede aparecer como thunk dentro de `resolveApiKey`,
    // nunca invocada al construir las deps.
    assert.match(action, /resolveApiKey:\s*\(\)\s*=>\s*getLushaApiKey\(\)/);
    assert.ok(at(action, 'return guardLushaRunBudget(') < at(action, 'resolveApiKey: () => getLushaApiKey()'));
    // Ninguna invocación directa `await getLushaApiKey()` en la acción.
    assert.equal(/await\s+getLushaApiKey\(/.test(action), false);
  });

  it('la construcción del cliente de proveedor vive dentro del callback de búsqueda', () => {
    assert.ok(at(action, 'reserveLushaRunCredits(') < at(action, 'searchCompanies:'));
  });
});

describe('§10 — la puerta de flag sigue siendo la más externa', () => {
  it('`guardLushaPreviewEnabled` envuelve todo lo demás', () => {
    assert.match(action, /return guardLushaPreviewEnabled\(/);
    assert.ok(at(action, 'return guardLushaPreviewEnabled(') < at(action, 'return guardLushaRunBudget('));
  });

  it('la puerta de flag NO fue debilitada: sigue devolviendo el resultado deshabilitado sin correr nada', () => {
    assert.match(action, /buildLushaPendingReviewDisabledResult/);
    assert.match(
      action,
      /guardLushaPreviewEnabled\(\s*\n?\s*isLushaPreviewEnabled\(\),\s*\n?\s*buildLushaPendingReviewDisabledResult/,
    );
  });

  it('el flag se lee de `isLushaPreviewEnabled`, no de `process.env` en la acción', () => {
    assert.equal(/process\.env\.ENABLE_LUSHA_PREVIEW/.test(action), false);
  });
});

describe('§8 — se reutiliza el mecanismo de reserva existente, sin inventar un segundo', () => {
  it('usa las tres RPC de Agente 1 y la tabla de reservas existente', () => {
    for (const symbol of [
      'reserveWizardPilotCredits',
      'confirmWizardPilotCredits',
      'releaseWizardPilotCredits',
      'fetchWizardReservationRecord',
    ]) {
      assert.match(action, new RegExp(symbol), symbol);
    }
  });

  it('NO define una tabla, RPC o período de presupuesto propios de Lusha', () => {
    const sources = [code(action), code(gate), code(liability)];
    for (const forbidden of [
      'lusha_monthly_budget',
      'try_reserve_lusha',
      'lusha_budget_reservations',
      'lusha_budget_periods',
      'lusha_credits',
    ]) {
      for (const source of sources) {
        assert.equal(source.includes(forbidden), false, forbidden);
      }
    }
    // La ÚNICA fila de período que se lee es la global de Agente 1.
    assert.match(action, /readWizardBudgetPeriodSnapshot\(/);
    assert.equal(code(action).includes('wizard_monthly_budget_periods'), false);
  });

  it('lee el MISMO período que Apollo (misma zona horaria compartida)', () => {
    assert.match(action, /getPilotBudgetPeriodStart\(WIZARD_BUDGET_TIMEZONE\)/);
  });

  it('usa el cliente service_role compartido (el de sesión no ve la tabla)', () => {
    assert.match(action, /createWizardBudgetServiceClient\(\)/);
  });

  it('el `clientRequestId` es obligatorio: ancla la idempotencia de la reserva', () => {
    assert.match(action, /clientRequestId:\s*z\.string\(\)\.trim\(\)\.uuid\(\)/);
  });
});

describe('§4 — no se copia el modelo de costo de Apollo', () => {
  it('el módulo de responsabilidad NO importa el pricing de Apollo', () => {
    const imports = code(liability).match(/from\s+'[^']+'/g) ?? [];
    for (const forbidden of ['apollo-operation-pricing', 'apollo-cost-guardrails', 'apollo-two-round']) {
      assert.equal(
        imports.some((line) => line.includes(forbidden)),
        false,
        forbidden,
      );
    }
    // Sí importa las constantes de Lusha, que son su única fuente de verdad.
    assert.ok(imports.some((line) => line.includes('lusha-preview')));
    assert.ok(imports.some((line) => line.includes('lusha-pending-review')));
  });

  it('el techo se deriva de constantes importadas, no de literales', () => {
    assert.match(
      liability,
      /LUSHA_PENDING_REVIEW_MAX_PAGES\s*\*\s*LUSHA_PREVIEW_EXPECTED_MAX_CREDITS/,
    );
    // Sin "25" (Apollo dos rondas) ni "20" (Tavily) como techo de Lusha.
    assert.equal(/return\s+25\b/.test(liability), false);
    assert.equal(/return\s+20\b/.test(liability), false);
  });

  it('el USD sale del pricing inyectado, no de una constante local', () => {
    assert.match(liability, /pricingConfig\.unit_cost_usd/);
    assert.equal(/0\.08823529/.test(liability), false);
  });
});

describe('§11/§12 — alcance: nada de mapeo de sectores ni descubrimiento por país', () => {
  it('ni la acción ni los módulos nuevos tocan el mapeo de industrias', () => {
    for (const source of [code(action), code(gate), code(liability)]) {
      assert.equal(source.includes('lusha-sector-mapping'), false);
      assert.equal(source.includes('provider-registry'), false);
      assert.equal(source.includes('subIndustriesIds'), false);
    }
  });
});

describe('§6 — la UI avisa pero no autoriza', () => {
  it('reutiliza el comparador y el redactor compartidos', () => {
    assert.match(ui, /resolveLushaPreExecutionBudgetBlock/);
    assert.match(ui, /mapBudgetExceeded/);
  });

  it('el botón se deshabilita con un bloqueo conocido', () => {
    assert.match(ui, /disabled=\{status === 'loading' \|\| budgetBlock !== null\}/);
  });

  it('sin instantánea NO bloquea: el default de la prop es null y el comparador devuelve null', () => {
    assert.match(ui, /budgetPreflight = null/);
  });

  it('la UI NO recalcula el techo por su cuenta: lo lee del preflight del servidor', () => {
    assert.match(ui, /budgetPreflight\?\.lushaRequiredCredits/);
    assert.equal(/lushaRequiredCredits\s*=\s*\d/.test(ui), false);
  });

  it('la UI no construye clientes de proveedor ni lee credenciales', () => {
    for (const forbidden of ['lusha-client', 'getLushaApiKey', 'LUSHA_API_KEY']) {
      assert.equal(ui.includes(forbidden), false, forbidden);
    }
  });
});

describe('§ safety — este trabajo no añade migraciones', () => {
  it('ninguna fuente nueva referencia un número de migración nuevo', () => {
    for (const source of [code(action), code(gate), code(liability), code(ui)]) {
      assert.equal(/migrations?\/1[2-9]\d/.test(source), false);
      assert.equal(/supabase\/migrations/.test(source), false);
    }
  });
});
