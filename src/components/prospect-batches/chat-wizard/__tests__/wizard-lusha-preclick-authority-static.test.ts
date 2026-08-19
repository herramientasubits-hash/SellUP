/**
 * wizard-lusha-preclick-authority-static.test.ts — ratchets de FUENTE del fix de
 * doble autoridad de presupuesto.
 *
 * AGENT1-LUSHA-PRECLICK-UX-CONSISTENCY-FIX-1 § P0.
 *
 * Las pruebas de render (wizard-lusha-preflight-authority-runtime) ya fallan si
 * el aviso genérico vuelve a la ruta de Lusha. Estos ratchets vigilan las tres
 * formas de "arreglarlo" que dejarían la pantalla verde y el diseño roto:
 *
 *   1. copiar la lógica de Lusha al padre (una tercera estimación viviendo en dos
 *      sitios, lista para divergir como divergió la copia estática);
 *   2. cablear un número literal —el `6` de health_pharma— en vez de leer el
 *      preflight plan-aware;
 *   3. debilitar el preflight genérico para todos en lugar de hacerlo consciente
 *      de la ruta, que arrastraría a Apollo/Tavily.
 *
 * Sólo lee ficheros. Sin red, sin proveedor, sin base, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), 'utf8');

const summary = read('src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx');
const finalSearch = read('src/components/prospect-batches/chat-wizard/wizard-lusha-final-search.tsx');
const preflight = read(
  'src/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight.ts',
);

describe('§ P0 — el preflight genérico es CONSCIENTE DE LA RUTA', () => {
  it('el bloque genérico se evalúa sólo fuera de la ruta Lusha', () => {
    assert.match(
      summary,
      /const preExecutionBudgetBlock =\s*\n?\s*!useLushaFinalSearch && budgetProvider/,
    );
  });

  it('el padre NO reimplementa el cálculo plan-aware de Lusha', () => {
    // Ni lo importa ni lo invoca: la prosa puede nombrarlo, el código no.
    assert.doesNotMatch(summary, /import[\s\S]{0,200}?resolveLusha\w+/);
    assert.doesNotMatch(summary, /resolveLushaPreExecutionBudgetBlock\(/);
    assert.doesNotMatch(summary, /resolveLushaPreflightRequiredCredits\(/);
    assert.doesNotMatch(summary, /lushaRequiredCredits(ByMacroIndustry)?\b\s*[[.?]/);
  });

  it('nadie cablea el techo de una macro concreta', () => {
    for (const [name, src] of [
      ['summary', summary],
      ['finalSearch', finalSearch],
    ] as const) {
      assert.doesNotMatch(
        src,
        /requiredCredits\s*[=:]\s*\d/,
        `${name} cablea un techo literal`,
      );
    }
  });

  it('Lusha sigue siendo la única autoridad visual de su propia ruta', () => {
    assert.match(finalSearch, /resolveLushaPreExecutionBudgetBlock\(budgetPreflight, input\.macroIndustryKey\)/);
    assert.match(finalSearch, /data-testid="lusha-budget-preflight-notice"/);
  });
});

describe('§ P0 — Apollo/Tavily conservan su preflight, y el servidor su autoridad', () => {
  it('el comparador genérico sigue existiendo y sin cambios de regla', () => {
    assert.match(preflight, /export function resolveWizardPreExecutionBudgetBlock/);
    assert.match(preflight, /availableCredits >= requiredCredits/);
  });

  it('el padre sigue llamándolo para la ruta no-Lusha', () => {
    assert.match(summary, /resolveWizardPreExecutionBudgetBlock\(budgetPreflight, budgetProvider\)/);
    assert.match(summary, /data-testid="wizard-budget-preflight-notice"/);
  });

  it('la pantalla de Lusha sigue sin auto-ejecutar nada', () => {
    // Sin efectos: la única vía de gasto sigue siendo el onClick del CTA.
    assert.doesNotMatch(finalSearch, /useEffect\(/);
    assert.doesNotMatch(finalSearch, /useLayoutEffect\(/);
  });
});

describe('§ P0 — la copia de costo no vuelve a llevar cifras estáticas', () => {
  it('ningún espejo de forma de búsqueda sobrevive', () => {
    assert.doesNotMatch(finalSearch, /LUSHA_MAX_PAGES/);
    assert.doesNotMatch(finalSearch, /LUSHA_EXPECTED_RESULTS_PER_PAGE/);
    assert.doesNotMatch(finalSearch, /LUSHA_EXPECTED_MAX_RESULTS/);
  });

  it('el aviso no promete páginas ni empresas globales', () => {
    assert.doesNotMatch(finalSearch, /hasta \$\{?\d/);
    assert.doesNotMatch(finalSearch, /páginas de Lusha/);
    assert.doesNotMatch(finalSearch, /empresas devueltas\)/);
  });
});
