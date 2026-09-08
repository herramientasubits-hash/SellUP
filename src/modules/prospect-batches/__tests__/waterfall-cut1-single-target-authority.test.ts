/**
 * waterfall-cut1-single-target-authority.test.ts
 *
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 1 — UN solo dueño del umbral.
 *
 * ── 🔴 Qué defiende esta suite ───────────────────────────────────────────────
 *
 * Antes del corte convivían TRES literales `10` que decían ser el mismo número:
 *
 *   WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES  (wizard-apollo-executor)
 *   WIZARD_TARGET_PERSISTIBLE_CANDIDATES         (wizard-tavily-executor)
 *   TARGET_ELIGIBLE_COMPANIES_DEFAULT            (apollo-two-round/config)
 *
 * más un tope absoluto (`TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX = 10`) que
 * permitía a una variable de entorno mover el objetivo de UNA de las rutas.
 * Mantenerlos iguales era un acuerdo, no una invariante: bastaba tocar uno para
 * que la aceptación se calculara contra un objetivo y la metadata del lote
 * publicara otro ("5/10").
 *
 * D1 · el objetivo del producto es 5 y vive en UN solo archivo.
 * D2 · las tres rutas lo derivan; ninguna vuelve a declarar un literal.
 * D3 · el entorno puede BAJAR el objetivo, nunca subirlo por encima de 5.
 * D4 · bajar el objetivo NO bajó la amplitud ya pagada (per_page, páginas,
 *      resultados por ronda, resultados crudos) ni el techo de presupuesto.
 * D5 · guarda estática: ningún módulo de producción reintroduce un literal.
 *
 * 0 proveedores · 0 créditos · 0 red · 0 Producción · 0 escrituras · 0 migraciones.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { WIZARD_TARGET_USEFUL_COMPANIES } from '../wizard-target-authority';
import {
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
  WIZARD_APOLLO_TARGET_INTERNAL,
} from '../chat-wizard-execution/wizard-apollo-executor';
import { WIZARD_TARGET_PERSISTIBLE_CANDIDATES } from '../chat-wizard-execution/wizard-tavily-executor';
import {
  TARGET_ELIGIBLE_COMPANIES_DEFAULT,
  TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX,
  MAX_RESULTS_PER_ROUND_DEFAULT,
  MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX,
  MAX_ENRICHMENTS_PER_RUN_DEFAULT,
  MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
  MAX_SEARCH_ROUNDS_DEFAULT,
  resolveApolloTwoRoundConfig,
  defaultApolloTwoRoundConfig,
} from '@/server/agents/prospecting-toolkit/apollo-two-round/config';
import {
  APOLLO_CONTRACT_MAX_PER_PAGE,
  WIZARD_APOLLO_MAX_PAGES_HARD_CAP,
} from '@/server/agents/prospecting-toolkit/apollo-organizations-pagination-budget';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

/**
 * Quita comentarios de línea y de bloque antes de grepear.
 *
 * Un comentario que NOMBRA el literal viejo ("antes `10`") no es el literal
 * vivo. Grepear crudo confunde documentar el cambio con no haberlo hecho.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ── D1 · una sola autoridad, y vale 5 ────────────────────────────────────────

describe('CORTE 1 § D1 — el objetivo del wizard es 5 y tiene un solo dueño', () => {
  test('la autoridad vale 5', () => {
    assert.equal(WIZARD_TARGET_USEFUL_COMPANIES, 5);
  });

  test('la autoridad es un entero positivo utilizable como umbral', () => {
    assert.ok(Number.isSafeInteger(WIZARD_TARGET_USEFUL_COMPANIES));
    assert.ok(WIZARD_TARGET_USEFUL_COMPANIES > 0);
  });
});

// ── D2 · las tres rutas derivan ──────────────────────────────────────────────

describe('CORTE 1 § D2 — las tres rutas derivan del mismo número', () => {
  test('Apollo, Tavily y la config de dos rondas coinciden con la autoridad', () => {
    assert.equal(WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES, WIZARD_TARGET_USEFUL_COMPANIES);
    assert.equal(WIZARD_TARGET_PERSISTIBLE_CANDIDATES, WIZARD_TARGET_USEFUL_COMPANIES);
    assert.equal(TARGET_ELIGIBLE_COMPANIES_DEFAULT, WIZARD_TARGET_USEFUL_COMPANIES);
  });

  test('el slot del lote se reserva antes de saber el proveedor: los dos coinciden', () => {
    assert.equal(WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES, WIZARD_TARGET_PERSISTIBLE_CANDIDATES);
  });

  test('la config resuelta por defecto usa el objetivo único', () => {
    assert.equal(
      defaultApolloTwoRoundConfig().targetEligibleCompanies,
      WIZARD_TARGET_USEFUL_COMPANIES,
    );
  });

  test('el objetivo NO es la amplitud de búsqueda (25 sigue intacto)', () => {
    assert.equal(WIZARD_APOLLO_TARGET_INTERNAL, 25);
    assert.notEqual(WIZARD_APOLLO_TARGET_INTERNAL, WIZARD_TARGET_USEFUL_COMPANIES);
  });
});

// ── D3 · el entorno sólo puede bajar ─────────────────────────────────────────

describe('CORTE 1 § D3 — el entorno puede bajar el objetivo, nunca subirlo', () => {
  test('el tope absoluto es la propia autoridad', () => {
    assert.equal(TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX, WIZARD_TARGET_USEFUL_COMPANIES);
  });

  test('un override por encima del objetivo se recorta y queda auditado', () => {
    const resolution = resolveApolloTwoRoundConfig({ targetEligibleCompanies: '10' });
    assert.equal(resolution.config.targetEligibleCompanies, WIZARD_TARGET_USEFUL_COMPANIES);
    assert.equal(resolution.sources.targetEligibleCompanies, 'env_clamped_to_absolute_max');
  });

  test('un override por debajo del objetivo sigue valiendo', () => {
    const resolution = resolveApolloTwoRoundConfig({ targetEligibleCompanies: '3' });
    assert.equal(resolution.config.targetEligibleCompanies, 3);
    assert.equal(resolution.sources.targetEligibleCompanies, 'env_override');
  });

  test('un override ilegible cae al objetivo, no a un número inventado', () => {
    for (const raw of ['abc', '2.5', '-1', '0', '+5', '1e3', '']) {
      const resolution = resolveApolloTwoRoundConfig({ targetEligibleCompanies: raw });
      assert.equal(
        resolution.config.targetEligibleCompanies,
        WIZARD_TARGET_USEFUL_COMPANIES,
        `"${raw}" debería caer al objetivo único`,
      );
    }
  });
});

// ── D4 · bajar el objetivo no bajó la amplitud ni el presupuesto ─────────────

describe('CORTE 1 § D4 — el umbral es SUFICIENCIA, no un límite de resultados', () => {
  test('per_page y páginas por ronda no se movieron', () => {
    assert.equal(APOLLO_CONTRACT_MAX_PER_PAGE, 100);
    assert.equal(WIZARD_APOLLO_MAX_PAGES_HARD_CAP, 5);
  });

  test('el objetivo no se coló en el tamaño de página', () => {
    // 🔴 Deliberadamente NO se afirma nada sobre `WIZARD_APOLLO_MAX_PAGES_HARD_
    // CAP`: vale 5, igual que el objetivo, por pura coincidencia numérica. Un
    // `notEqual` ahí no probaría independencia, sólo prohibiría que dos números
    // sin relación coincidieran. Lo que sí prueba independencia es que el
    // tamaño de página siga siendo 100 con un objetivo de 5.
    assert.notEqual(APOLLO_CONTRACT_MAX_PER_PAGE, WIZARD_TARGET_USEFUL_COMPANIES);
    assert.ok(APOLLO_CONTRACT_MAX_PER_PAGE > WIZARD_TARGET_USEFUL_COMPANIES * 10);
  });

  test('la amplitud por ronda y de resultados crudos sigue por encima del objetivo', () => {
    assert.equal(MAX_RESULTS_PER_ROUND_DEFAULT, 10);
    assert.equal(MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX, 20);
    assert.ok(MAX_RESULTS_PER_ROUND_DEFAULT >= WIZARD_TARGET_USEFUL_COMPANIES);
    assert.ok(MAX_RAW_RESULTS_PER_RUN_ABSOLUTE_MAX >= WIZARD_TARGET_USEFUL_COMPANIES);
  });

  test('las rondas y el techo de presupuesto no se tocaron', () => {
    assert.equal(MAX_SEARCH_ROUNDS_DEFAULT, 2);
    assert.equal(MAX_ENRICHMENTS_PER_RUN_DEFAULT, 2);
    assert.equal(MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX, 6);
  });
});

// ── D5 · guarda estática contra la reaparición del literal ───────────────────

describe('CORTE 1 § D5 — ningún módulo de producción redeclara el objetivo', () => {
  const productionModules = [
    'src/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor.ts',
    'src/modules/prospect-batches/chat-wizard-execution/wizard-tavily-executor.ts',
    'src/server/agents/prospecting-toolkit/apollo-two-round/config.ts',
  ];

  for (const relativePath of productionModules) {
    test(`${path.basename(relativePath)} deriva de la autoridad`, () => {
      const source = stripComments(readSource(relativePath));
      assert.ok(
        source.includes('WIZARD_TARGET_USEFUL_COMPANIES'),
        'el módulo debe leer la autoridad en código vivo, no sólo en un comentario',
      );
    });

    test(`${path.basename(relativePath)} no asigna un literal al objetivo`, () => {
      const source = stripComments(readSource(relativePath));
      const literalAssignment =
        /(TARGET_ELIGIBLE_COMPANIES_(?:DEFAULT|ABSOLUTE_MAX)|WIZARD_(?:APOLLO_)?TARGET_PERSISTIBLE_CANDIDATES)\s*=\s*\d+/;
      assert.equal(
        literalAssignment.test(source),
        false,
        'el objetivo volvió a declararse como número literal en este módulo',
      );
    });
  }

  test('la autoridad es el único archivo que escribe el número', () => {
    const source = stripComments(
      readSource('src/modules/prospect-batches/wizard-target-authority.ts'),
    );
    assert.match(source, /export const WIZARD_TARGET_USEFUL_COMPANIES = 5;/);
  });
});
