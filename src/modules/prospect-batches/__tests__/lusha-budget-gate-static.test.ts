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
    // MULTIBRANCH-EXECUTOR-1 § 7 — la llamada ahora lleva el PLAN, porque el techo
    // depende de cuántas ramas ejecute (2/4/6). Lo que esta guarda protege no
    // cambia: la reserva sale de esa función y de ninguna otra cuenta.
    assert.match(action, /const requiredCredits = estimateLushaRunCredits\(searchPlan\);/);
    // ROUTING-CUTOVER-1 §§ 2/12 — el plan lo resuelve la autoridad del cutover, la
    // MISMA puerta que decidió la elegibilidad. Antes lo resolvía el puente de
    // compatibilidad a partir de un sector legacy; ahora no puede existir una ruta
    // admitida cuyo plan —y por tanto cuya reserva— no sea resoluble.
    assert.match(
      action,
      /const searchPlan = resolveLushaRoutedSearchPlan\(parsed\.data\.macroIndustryKey\)/,
    );
    assert.equal(action.includes('resolveLushaSearchPlanForSector'), false);
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
    //
    // 🔴 AGENT1-LUSHA-CUT-L5 §§ 6, 16 — la fuente del techo POR PETICIÓN dejó de
    // ser `lusha-preview` y pasó a ser `lusha-prospecting-contract`, el dueño del
    // contrato de BLOQUES de facturación. Y el techo de páginas se lee ahora de
    // `lusha-pending-review-limits` en vez de la re-exportación del writer, para
    // no cerrar el ciclo writer → liability → writer.
    //
    // Lo que esta guarda defiende no cambió: el techo sale de constantes de Lusha
    // IMPORTADAS, nunca de literales locales ni del modelo de Apollo.
    assert.ok(imports.some((line) => line.includes('lusha-prospecting-contract')));
    assert.ok(imports.some((line) => line.includes('lusha-pending-review-limits')));
  });

  it('el techo se deriva de constantes importadas, no de literales', () => {
    // CUT-L5 § 16 — páginas × créditos por petición, y el segundo factor sale del
    // contrato de bloques (`max(1, ceil(size / 25))`) en vez de la constante
    // «1 crédito por petición» que sólo era cierta para páginas de 10.
    assert.match(
      liability,
      /LUSHA_PENDING_REVIEW_MAX_PAGES\s*\*\s*resolveLushaMaxCreditsPerProviderRequest\(\)/,
    );
    assert.match(
      liability,
      /expectedLushaProspectingCreditsForPageSize\(LUSHA_PROSPECTING_PAGE_SIZE\)/,
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
  it('ni la acción ni los módulos nuevos redefinen la autoridad de industrias', () => {
    // Re-apuntada dos veces: MULTIBRANCH-EXECUTOR-1 §§ 2/21/22 y ahora
    // ROUTING-CUTOVER-1 §§ 2/6.
    //
    // Lo que prohibía —y sigue prohibiendo— es que la ruta del presupuesto se
    // convierta en una SEGUNDA autoridad de industrias. Lo que cambia es CUÁL es la
    // autoridad: el techo se enumera desde `LUSHA_ROUTABLE_MACRO_KEYS`, derivado
    // del catálogo de planes, en lugar de desde `getLushaSectorOptions`. Leer la
    // autoridad no es sustituirla, igual que antes.
    //
    // Lo que se sigue prohibiendo en duro: redefinir un catálogo propio, tocar la
    // lista del registry, y construir filtros de industria a mano.
    for (const source of [code(action), code(gate), code(liability)]) {
      assert.equal(source.includes('provider-registry'), false);
      assert.equal(source.includes('subIndustriesIds'), false);
      assert.equal(source.includes('mainIndustriesIds'), false);
      // Nadie redefine el tipo ni el catálogo de sectores.
      assert.equal(source.includes('LushaSectorKey ='), false);
      assert.equal(source.includes('SECTOR_CATALOG'), false);
      // § 2 — ni un segundo censo de macro industrias escrito a mano.
      assert.equal(source.includes('LUSHA_ROUTABLE_MACRO_KEYS = ['), false);
    }
    // 🔴 Ninguno de los tres toca ya el mapeo legacy: el cutover lo desconectó por
    // completo de la ruta del presupuesto.
    assert.equal(code(action).includes('lusha-sector-mapping'), false);
    assert.equal(code(gate).includes('lusha-sector-mapping'), false);
    assert.equal(code(liability).includes('lusha-sector-mapping'), false);
    // El módulo de responsabilidad enumera las rutas desde la autoridad del cutover.
    assert.match(code(liability), /LUSHA_ROUTABLE_MACRO_KEYS/);
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
    // MULTIBRANCH-EXECUTOR-1 § 9 + ROUTING-CUTOVER-1 § 12 — el techo pasa por el
    // resolvedor compartido, que elige la fila de la MACRO INDUSTRIA (antes: del
    // sector) con respaldo al valor de siempre. La propiedad protegida es la misma:
    // la UI LEE, no CALCULA.
    assert.match(
      ui,
      /resolveLushaPreflightRequiredCredits\(budgetPreflight, input\.macroIndustryKey\)/,
    );
    // 🔴 Y no queda ninguna lectura por sector: si volviera, las nueve macro sin
    // sector equivalente se quedarían sin fila y el aviso mentiría con un 2.
    assert.equal(/input\.sectorKey/.test(ui), false);
    assert.equal(/lushaRequiredCredits\s*=\s*\d/.test(ui), false);
    // Ni la función de responsabilidad ni el catálogo de planes entran al bundle.
    for (const forbidden of [
      'estimateLushaRunCredits',
      'lusha-run-liability',
      'lusha-macro-search-plan',
      'lusha-branch-plan-resolution',
    ]) {
      assert.equal(ui.includes(forbidden), false, forbidden);
    }
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
