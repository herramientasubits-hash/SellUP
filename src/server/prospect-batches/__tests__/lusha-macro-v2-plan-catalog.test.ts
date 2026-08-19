/**
 * lusha-macro-v2-plan-catalog.test.ts — el catálogo de planes de búsqueda de
 * Lusha para las 12 Macro Industrias dice la verdad, y no manda todavía.
 *
 * AGENT1-LUSHA-MACRO-V2-PLAN-CATALOG-1 § 8.
 *
 * ── Qué defecto fija esta suite ───────────────────────────────────────────────
 *
 * Un catálogo de IDs es la clase de dato que se revisa mal: `12` y `13` son
 * igual de plausibles leyéndolos, y un sub colgado del padre equivocado produce
 * un filtro que el proveedor ACEPTA y que devuelve otro sector. El error no
 * aparece en rojo, aparece como «Lusha trajo empresas raras» después de gastar.
 *
 * Por eso casi nada aquí se afirma contra una constante escrita al lado: los
 * IDs se comprueban contra `LUSHA_INDUSTRY_METADATA`, la captura literal del
 * endpoint gratuito del proveedor. Y por eso hay pruebas de MUTACIÓN: una
 * validación que nunca se ha visto fallar no es una garantía, es decoración.
 *
 * ── Qué NO se prueba, a propósito ─────────────────────────────────────────────
 *
 * Exclusividad de una rama entre macros. La sub 76 (`Food & Beverage`) está en
 * `consumer_goods` y en `agroindustry` porque las categorías del proveedor son
 * cubetas de recuperación, no propiedad. Hay una prueba que AFIRMA ese reuso,
 * para que quitarlo «limpiando duplicados» rompa el build.
 *
 * Sin red, sin proveedor, sin base, sin créditos. 0 llamadas a Lusha.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  LUSHA_MACRO_SEARCH_PLANS,
  LUSHA_MACRO_SEARCH_PLAN_MAX_BRANCHES,
  LUSHA_MACRO_SEARCH_PLAN_MIN_BRANCHES,
  resolveLushaMacroSearchPlan,
  resolveLushaMacroSearchBranches,
  resolveLushaMacroSearchPlanMaxBranchCount,
  validateLushaMacroSearchPlanCatalog,
  assertLushaMacroSearchPlanCatalogValid,
  describeLushaMacroSearchPlan,
  type LushaMacroSearchPlan,
} from '@/server/prospect-batches/lusha-macro-search-plan';
import {
  LUSHA_INDUSTRY_METADATA,
  LUSHA_MAIN_INDUSTRY_COUNT,
  LUSHA_SUB_INDUSTRY_COUNT,
  LUSHA_INDUSTRY_METADATA_CAPTURED_AT,
  findLushaMainIndustry,
  isKnownLushaMainIndustryId,
  isLushaSubIndustryOfMain,
} from '@/server/prospect-batches/lusha-industry-metadata';
import {
  MACRO_INDUSTRY_KEYS,
  MACRO_INDUSTRY_COUNT,
} from '@/modules/macro-industry-catalog/macro-industries';
import {
  resolveLushaMacroPlanMaxProviderCredits,
  resolveLushaMacroCatalogMaxProviderCredits,
  resolveLushaRunMaxProviderCredits,
  estimateLushaRunCredits,
} from '@/server/prospect-batches/lusha-run-liability';
import { LUSHA_PENDING_REVIEW_MAX_PAGES } from '@/server/prospect-batches/lusha-pending-review';
import { LUSHA_PREVIEW_EXPECTED_MAX_CREDITS } from '@/server/prospect-batches/lusha-preview';
// MULTIBRANCH-EXECUTOR-1 §§ 7/21 — el puente sector→plan, el techo de peticiones
// del ejecutor y la autoridad de elegibilidad que NO debe ensancharse.
import { resolveLushaSearchPlanForSector } from '@/server/prospect-batches/lusha-branch-plan-resolution';
import { resolveLushaProviderRequestsAllowed } from '@/server/prospect-batches/lusha-multibranch-execution';
import { getLushaSectorOptions } from '@/server/prospect-batches/lusha-sector-mapping';
import { isProspectLushaEligible } from '@/modules/prospect-batches/prospect-discovery-provider';

// ── La tabla aprobada, transcrita aparte del módulo ───────────────────────────
//
// Deliberadamente NO se deriva de `LUSHA_MACRO_SEARCH_PLANS`: si la expectativa
// se leyera del propio catálogo, cambiar un ID haría cambiar la expectativa con
// él y la prueba pasaría igual de verde. Esto es una segunda copia, escrita
// desde la aprobación de la dueña, y su única función es discrepar.
const APPROVED_PLAN_TABLE: ReadonlyArray<
  readonly [string, ReadonlyArray<readonly [number, number | null]>]
> = [
  ['transport_logistics', [[18, null]]],
  ['technology', [[17, null]]],
  ['insurance_financial_services', [[9, null]]],
  ['health_pharma', [[11, null], [12, 71], [12, 80]]],
  ['retail', [[16, null]]],
  ['property_construction', [[3, null], [15, null]]],
  ['industry_manufacturing_chemicals_automotive', [[12, null]]],
  ['government', [[10, null]]],
  ['energy_mining_environment', [[13, null], [19, null], [14, 98]]],
  ['consumer_goods', [[12, 76], [12, 70]]],
  ['services_company', [[14, null], [15, 6], [9, 92]]],
  ['agroindustry', [[8, null], [12, 76]]],
];

/** Copia mutable y profunda del catálogo, para las pruebas de mutación. */
function cloneCatalog(): LushaMacroSearchPlan[] {
  return LUSHA_MACRO_SEARCH_PLANS.map((plan) => ({
    macroKey: plan.macroKey,
    branches: plan.branches.map((branch) => ({ ...branch })),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────

describe('metadata autoritativa de Lusha (captura del proveedor)', () => {
  it('trae las 17 industrias principales y las 132 sub-industrias capturadas', () => {
    assert.equal(LUSHA_INDUSTRY_METADATA.length, LUSHA_MAIN_INDUSTRY_COUNT);
    assert.equal(LUSHA_MAIN_INDUSTRY_COUNT, 17);
    const subs = LUSHA_INDUSTRY_METADATA.reduce(
      (total, main) => total + main.subIndustries.length,
      0,
    );
    assert.equal(subs, LUSHA_SUB_INDUSTRY_COUNT);
    assert.equal(LUSHA_SUB_INDUSTRY_COUNT, 132);
    assert.equal(LUSHA_INDUSTRY_METADATA_CAPTURED_AT, '2026-08-18');
  });

  it('los ids 2 y 4 no existen: la captura no es un rango, es una lista', () => {
    // Si alguien «rellenara el hueco» asumiendo 1..19 correlativos, esto lo
    // atrapa. El proveedor no publica esos dos.
    assert.equal(isKnownLushaMainIndustryId(2), false);
    assert.equal(isKnownLushaMainIndustryId(4), false);
    assert.equal(isKnownLushaMainIndustryId(1), true);
    assert.equal(isKnownLushaMainIndustryId(19), true);
    assert.equal(isKnownLushaMainIndustryId(20), false);
  });

  it('los ids de sub-industria son únicos en todo el vocabulario', () => {
    // Es lo que hace que preguntar «¿existe el 98?» sea insuficiente y que la
    // pregunta correcta lleve el padre.
    const seen = new Map<number, number>();
    for (const main of LUSHA_INDUSTRY_METADATA) {
      for (const sub of main.subIndustries) {
        assert.equal(
          seen.has(sub.id),
          false,
          `sub ${sub.id} aparece bajo main ${seen.get(sub.id)} y ${main.id}`,
        );
        seen.set(sub.id, main.id);
      }
    }
  });

  it('un sub real bajo el padre equivocado se rechaza', () => {
    assert.equal(isLushaSubIndustryOfMain(14, 98), true); // Environmental Services
    assert.equal(isLushaSubIndustryOfMain(13, 98), false); // …no bajo Oil, Gas & Mining
  });
});

describe('catálogo de planes — cobertura de las 12 macro', () => {
  it('cubre exactamente las 12 claves canónicas, sin faltar ni sobrar', () => {
    assert.equal(LUSHA_MACRO_SEARCH_PLANS.length, MACRO_INDUSTRY_COUNT);
    assert.equal(MACRO_INDUSTRY_COUNT, 12);
    const keys = LUSHA_MACRO_SEARCH_PLANS.map((plan) => plan.macroKey);
    assert.deepEqual([...keys].sort(), [...MACRO_INDUSTRY_KEYS].sort());
    assert.equal(new Set(keys).size, 12);
  });

  it('respeta el orden canónico de MACRO_INDUSTRY_KEYS', () => {
    assert.deepEqual(
      LUSHA_MACRO_SEARCH_PLANS.map((plan) => plan.macroKey),
      [...MACRO_INDUSTRY_KEYS],
    );
  });

  it('el catálogo aprobado es válido de punta a punta', () => {
    assert.deepEqual(validateLushaMacroSearchPlanCatalog(), []);
    assert.doesNotThrow(() => assertLushaMacroSearchPlanCatalogValid());
  });

  it('Educación NO es una macro de SellUp aunque Lusha la publique', () => {
    // El main 6 existe en el proveedor…
    assert.equal(isKnownLushaMainIndustryId(6), true);
    assert.equal(findLushaMainIndustry(6)?.label, 'Education');
    // …y aun así ninguna macro de SellUp lo pide como industria principal.
    // Decisión de la dueña del 2026-08-13, no un olvido.
    assert.equal(
      (MACRO_INDUSTRY_KEYS as readonly string[]).includes('education'),
      false,
    );
    const usesEducationAsMain = LUSHA_MACRO_SEARCH_PLANS.some((plan) =>
      plan.branches.some((branch) => branch.mainIndustryId === 6),
    );
    assert.equal(usesEducationAsMain, false);
  });
});

describe('catálogo de planes — IDs exactos', () => {
  it('cada plan coincide rama a rama con la tabla aprobada', () => {
    assert.equal(APPROVED_PLAN_TABLE.length, 12);
    for (const [macroKey, expectedBranches] of APPROVED_PLAN_TABLE) {
      const plan = resolveLushaMacroSearchPlan(macroKey as never);
      assert.ok(plan, `falta plan para ${macroKey}`);
      const actual = plan.branches.map(
        (branch) => [branch.mainIndustryId, branch.subIndustryId ?? null] as const,
      );
      assert.deepEqual(
        actual,
        expectedBranches.map((pair) => [pair[0], pair[1]] as const),
        `plan divergente para ${macroKey}`,
      );
    }
  });

  it('cada main de cada rama existe en la captura del proveedor', () => {
    for (const plan of LUSHA_MACRO_SEARCH_PLANS) {
      for (const branch of plan.branches) {
        assert.equal(
          isKnownLushaMainIndustryId(branch.mainIndustryId),
          true,
          `${plan.macroKey}: main ${branch.mainIndustryId} no está en la captura`,
        );
      }
    }
  });

  it('cada sub de cada rama cuelga de SU main en la captura', () => {
    const pairs: string[] = [];
    for (const plan of LUSHA_MACRO_SEARCH_PLANS) {
      for (const branch of plan.branches) {
        if (branch.subIndustryId === null || branch.subIndustryId === undefined) continue;
        assert.equal(
          isLushaSubIndustryOfMain(branch.mainIndustryId, branch.subIndustryId),
          true,
          `${plan.macroKey}: sub ${branch.subIndustryId} no cuelga de main ${branch.mainIndustryId}`,
        );
        pairs.push(`${branch.mainIndustryId}:${branch.subIndustryId}`);
      }
    }
    // 8 ramas estrechadas: 12/71, 12/80, 14/98, 12/76 ×2, 12/70, 15/6, 9/92.
    assert.equal(pairs.length, 8);
  });

  it('ninguna rama declara varios mains ni varios subs', () => {
    for (const plan of LUSHA_MACRO_SEARCH_PLANS) {
      for (const branch of plan.branches) {
        assert.equal(typeof branch.mainIndustryId, 'number');
        assert.equal(Array.isArray(branch.mainIndustryId), false);
        const sub = branch.subIndustryId;
        assert.equal(
          sub === null || sub === undefined || typeof sub === 'number',
          true,
        );
        assert.equal(Array.isArray(sub), false);
        // El objeto no lleva las formas plurales prohibidas por § 1.
        assert.equal('mainIndustriesIds' in branch, false);
        assert.equal('subIndustriesIds' in branch, false);
      }
    }
  });

  it('las etiquetas son observabilidad: nada las usa para resolver', () => {
    // Resolver es por clave canónica, no por texto. Buscar por etiqueta no
    // existe como API.
    assert.equal(resolveLushaMacroSearchPlan('technology' as never)?.branches[0]?.mainIndustryId, 17);
    assert.equal(resolveLushaMacroSearchPlan('Tecnología' as never), null);
    assert.equal(resolveLushaMacroSearchPlan('technology ' as never), null);
    // Y la etiqueta declarada coincide con la capturada, para que un diff mienta menos.
    for (const plan of LUSHA_MACRO_SEARCH_PLANS) {
      for (const branch of plan.branches) {
        const main = findLushaMainIndustry(branch.mainIndustryId);
        assert.ok(main);
        const expected =
          branch.subIndustryId === null || branch.subIndustryId === undefined
            ? main.label
            : main.subIndustries.find((sub) => sub.id === branch.subIndustryId)?.label;
        assert.equal(branch.label, expected, `etiqueta caducada en ${plan.macroKey}`);
      }
    }
  });
});

describe('catálogo de planes — ramas y reuso', () => {
  it('ninguna macro pasa de 3 ramas y ninguna se queda en 0', () => {
    for (const plan of LUSHA_MACRO_SEARCH_PLANS) {
      assert.ok(plan.branches.length >= LUSHA_MACRO_SEARCH_PLAN_MIN_BRANCHES);
      assert.ok(plan.branches.length <= LUSHA_MACRO_SEARCH_PLAN_MAX_BRANCHES);
    }
    assert.equal(resolveLushaMacroSearchPlanMaxBranchCount(), 3);
    assert.equal(LUSHA_MACRO_SEARCH_PLAN_MAX_BRANCHES, 3);
  });

  it('el reparto de ramas es 6 simples, 3 dobles y 3 triples', () => {
    const counts = LUSHA_MACRO_SEARCH_PLANS.map((plan) => plan.branches.length);
    assert.equal(counts.filter((n) => n === 1).length, 6);
    assert.equal(counts.filter((n) => n === 2).length, 3);
    assert.equal(counts.filter((n) => n === 3).length, 3);
    assert.equal(counts.reduce((a, b) => a + b, 0), 21); // 6 + 6 + 9
  });

  it('la sub 76 la comparten consumer_goods y agroindustry A PROPÓSITO', () => {
    // Si alguien «deduplica» el catálogo, esta prueba cae. El reuso es la
    // decisión: las categorías del proveedor son cubetas de recuperación, no
    // propiedad exclusiva de una macro.
    const owners = LUSHA_MACRO_SEARCH_PLANS.filter((plan) =>
      plan.branches.some(
        (branch) => branch.mainIndustryId === 12 && branch.subIndustryId === 76,
      ),
    ).map((plan) => plan.macroKey);
    assert.deepEqual([...owners].sort(), ['agroindustry', 'consumer_goods']);
  });

  it('no hay validación de exclusividad entre macros', () => {
    // Prueba explícita de una AUSENCIA: duplicar una rama en otra macro debe
    // seguir siendo válido, o la regla de reuso sería letra muerta.
    const mutated = cloneCatalog();
    const retail = mutated.find((plan) => plan.macroKey === 'retail');
    assert.ok(retail);
    retail.branches = [
      ...retail.branches,
      { mainIndustryId: 12, subIndustryId: 76, label: 'Food & Beverage' },
    ];
    assert.deepEqual(validateLushaMacroSearchPlanCatalog(mutated), []);
  });

  it('una rama repetida DENTRO de un plan sí es inválida', () => {
    const mutated = cloneCatalog();
    const consumer = mutated.find((plan) => plan.macroKey === 'consumer_goods');
    assert.ok(consumer);
    consumer.branches = [
      ...consumer.branches,
      { mainIndustryId: 12, subIndustryId: 76, label: 'Food & Beverage' },
    ];
    const violations = validateLushaMacroSearchPlanCatalog(mutated);
    assert.ok(violations.some((v) => v.startsWith('duplicate_branch_in_plan: consumer_goods')));
  });

  it('resolver una macro sin plan devuelve null y ramas vacías', () => {
    assert.equal(resolveLushaMacroSearchPlan('education' as never), null);
    assert.deepEqual(resolveLushaMacroSearchBranches('education' as never), []);
  });
});

describe('pruebas de MUTACIÓN — la validación falla cuando debe', () => {
  it('quitar una macro → missing_macro_plan', () => {
    const mutated = cloneCatalog().filter((plan) => plan.macroKey !== 'government');
    const violations = validateLushaMacroSearchPlanCatalog(mutated);
    assert.ok(violations.includes('missing_macro_plan: government'));
    assert.ok(violations.some((v) => v.startsWith('macro_plan_count_mismatch')));
  });

  it('cambiar un ID conocido por uno inexistente → unknown_main_industry_id', () => {
    const mutated = cloneCatalog();
    const tech = mutated.find((plan) => plan.macroKey === 'technology');
    assert.ok(tech);
    tech.branches = [{ mainIndustryId: 2, label: 'no existe' }]; // 2 es un hueco real
    const violations = validateLushaMacroSearchPlanCatalog(mutated);
    assert.ok(violations.includes('unknown_main_industry_id: technology main=2'));
  });

  it('colgar la sub 98 del main 13 → sub_industry_not_under_main', () => {
    // El error que un array plano cometería: Environmental Services cuelga de
    // Business Services (14), no de Oil, Gas & Mining (13).
    const mutated = cloneCatalog();
    const energy = mutated.find((plan) => plan.macroKey === 'energy_mining_environment');
    assert.ok(energy);
    energy.branches = energy.branches.map((branch) =>
      branch.subIndustryId === 98 ? { ...branch, mainIndustryId: 13 } : branch,
    );
    const violations = validateLushaMacroSearchPlanCatalog(mutated);
    assert.ok(
      violations.includes(
        'sub_industry_not_under_main: energy_mining_environment main=13 sub=98',
      ),
    );
  });

  it('añadir una cuarta rama → too_many_branches', () => {
    const mutated = cloneCatalog();
    const services = mutated.find((plan) => plan.macroKey === 'services_company');
    assert.ok(services);
    services.branches = [
      ...services.branches,
      { mainIndustryId: 5, label: 'Community & Nonprofit Organizations' },
    ];
    const violations = validateLushaMacroSearchPlanCatalog(mutated);
    assert.ok(
      violations.some((v) => v.startsWith('too_many_branches: services_company branches=4')),
    );
  });

  it('reintroducir Educación como macro → education_is_not_a_sellup_macro', () => {
    const mutated = cloneCatalog();
    mutated.push({
      macroKey: 'education' as never,
      branches: [{ mainIndustryId: 6, label: 'Education' }],
    });
    const violations = validateLushaMacroSearchPlanCatalog(mutated);
    assert.ok(violations.includes('education_is_not_a_sellup_macro'));
    assert.ok(violations.includes('unknown_macro_key: education'));
  });

  it('dejar una macro sin ramas → empty_plan', () => {
    const mutated = cloneCatalog();
    const retail = mutated.find((plan) => plan.macroKey === 'retail');
    assert.ok(retail);
    retail.branches = [];
    assert.ok(validateLushaMacroSearchPlanCatalog(mutated).includes('empty_plan: retail'));
  });

  it('duplicar una macro → duplicate_macro_plan', () => {
    const mutated = cloneCatalog();
    mutated.push({ macroKey: 'retail', branches: [{ mainIndustryId: 16, label: 'Retail & Wholesale Trade' }] });
    assert.ok(
      validateLushaMacroSearchPlanCatalog(mutated).includes('duplicate_macro_plan: retail'),
    );
  });

  it('el catálogo real sigue intacto tras todas las mutaciones', () => {
    // Las mutaciones trabajan sobre copias. Si alguna hubiera tocado el
    // original, esto lo delata.
    assert.deepEqual(validateLushaMacroSearchPlanCatalog(), []);
    assert.equal(LUSHA_MACRO_SEARCH_PLANS.length, 12);
    assert.deepEqual(
      LUSHA_MACRO_SEARCH_PLANS.map((plan) => plan.branches.length),
      [1, 1, 1, 3, 1, 2, 1, 1, 3, 2, 3, 2],
    );
  });
});

describe('modelo de responsabilidad económica (PURO)', () => {
  it('el techo de una rama son 2 créditos, derivados y no escritos a mano', () => {
    assert.equal(LUSHA_PENDING_REVIEW_MAX_PAGES, 2);
    assert.equal(LUSHA_PREVIEW_EXPECTED_MAX_CREDITS, 1);
    assert.equal(resolveLushaRunMaxProviderCredits(), 2);
  });

  it('1 rama → 2, 2 ramas → 4, 3 ramas → 6', () => {
    const branch = { mainIndustryId: 17, label: 'x' };
    assert.equal(resolveLushaMacroPlanMaxProviderCredits({ branches: [branch] }), 2);
    assert.equal(resolveLushaMacroPlanMaxProviderCredits({ branches: [branch, branch] }), 4);
    assert.equal(
      resolveLushaMacroPlanMaxProviderCredits({ branches: [branch, branch, branch] }),
      6,
    );
  });

  it('el techo de cada plan real es ramas × 2', () => {
    for (const plan of LUSHA_MACRO_SEARCH_PLANS) {
      assert.equal(
        resolveLushaMacroPlanMaxProviderCredits(plan),
        plan.branches.length * 2,
        plan.macroKey,
      );
    }
  });

  it('el máximo del catálogo entero es 6', () => {
    assert.equal(resolveLushaMacroCatalogMaxProviderCredits(LUSHA_MACRO_SEARCH_PLANS), 6);
    const worst = LUSHA_MACRO_SEARCH_PLANS.filter((plan) => plan.branches.length === 3).map(
      (plan) => plan.macroKey,
    );
    assert.deepEqual(
      [...worst].sort(),
      ['energy_mining_environment', 'health_pharma', 'services_company'],
    );
  });

  it('sin plan la reserva sigue siendo 2 (ruta legacy intacta)', () => {
    // MULTIBRANCH-EXECUTOR-1 § 7 re-apunta este ratchet. Lo que protegía —que el
    // catálogo no moviera el gasto en vivo— ya no aplica: el ejecutor itera ramas
    // y la reserva DEBE seguirle. Lo que sigue protegiendo, y es lo que importa,
    // es que la AUSENCIA de plan no cambie ni un crédito.
    assert.equal(estimateLushaRunCredits(), 2);
    assert.equal(estimateLushaRunCredits(null), 2);
    assert.equal(estimateLushaRunCredits(), resolveLushaRunMaxProviderCredits());
  });

  it('con plan la reserva es ramas × 2, y sale de la MISMA función', () => {
    for (const plan of LUSHA_MACRO_SEARCH_PLANS) {
      assert.equal(
        estimateLushaRunCredits(plan),
        plan.branches.length * 2,
        `${plan.macroKey} debe reservar ramas × 2`,
      );
      // Sin segunda tabla: el techo por plan y la reserva son el mismo número.
      assert.equal(
        estimateLushaRunCredits(plan),
        resolveLushaMacroPlanMaxProviderCredits(plan),
      );
    }
  });

  it('🔴 el techo de peticiones del ejecutor y la reserva son el MISMO producto', () => {
    // Si divergieran, la corrida podría intentar gastar por encima de lo
    // reservado sin que ningún defecto fuera visible.
    for (const plan of LUSHA_MACRO_SEARCH_PLANS) {
      assert.equal(
        resolveLushaProviderRequestsAllowed(plan.branches.length),
        estimateLushaRunCredits(plan),
        `${plan.macroKey}: peticiones permitidas ≠ créditos reservados`,
      );
    }
  });
});

// ── Ratchets estáticos: el catálogo NO manda todavía ─────────────────────────

const SRC_ROOT = path.join(process.cwd(), 'src');

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      collectSourceFiles(full, acc);
      continue;
    }
    if (/\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full)) acc.push(full);
  }
  return acc;
}

describe('ratchet — quién puede resolver planes en runtime (lista CERRADA)', () => {
  const SOURCES = collectSourceFiles(SRC_ROOT);

  /**
   * ── Historia de este ratchet, en dos re-apuntados ───────────────────────────
   *
   * 1. PLAN-CATALOG-1 prohibía TODA arista de runtime hacia el catálogo: el
   *    ejecutor no sabía ejecutar un plan y anunciarlo habría sido mentir.
   * 2. MULTIBRANCH-EXECUTOR-1 §§ 21/22 lo convirtió en LISTA CERRADA y añadió el
   *    ejecutor, pero mantuvo la propiedad «el catálogo no es la autoridad de
   *    elegibilidad», porque las rutas seguían siendo tres.
   * 3. ROUTING-CUTOVER-1 §§ 2/19 invierte esa última mitad a propósito: el
   *    catálogo AHORA SÍ es la autoridad de elegibilidad, y esa es la razón de ser
   *    del hito. Ver el bloque «completitud del catálogo ES elegibilidad» abajo.
   *
   * Lo que NO cambia —y es lo que sigue defendiendo esta prueba— es que la lista
   * de quién puede resolver planes en runtime está CERRADA. Un módulo nuevo que
   * importe el catálogo hace fallar esto, y quien la actualice tiene que justificar
   * por qué ese módulo puede resolver planes.
   */
  /**
   * Quién puede leer LOS PLANES en runtime. Lista de DOS.
   *
   * Se distingue de quién puede leer los TECHOS del catálogo
   * (`LUSHA_MACRO_SEARCH_PLAN_MAX_BRANCHES`) porque las dos cosas conceden poderes
   * muy distintos: un techo es una cota de gasto, y los planes son las industrias
   * que se le piden al proveedor. El ejecutor necesita lo primero y no debe poder
   * hacer lo segundo — resuelve el plan que le PASAN, nunca uno que él elija.
   *
   * `lusha-macro-capability` es la autoridad del cutover: resuelve elegibilidad y
   * plan por la MISMA puerta, que es lo que garantiza que no exista ruta sin plan
   * ni plan sin reserva calculable (§ 12).
   *
   * `lusha-branch-plan-resolution` sigue en la lista aunque ya no tenga
   * consumidores de runtime: es el puente de compatibilidad, y su presencia aquí
   * es inocua porque la prueba mide capacidad, no uso. Quien vigila que nadie lo
   * llame es la suite del cutover.
   */
  const PLAN_READERS = [
    'src/server/prospect-batches/lusha-macro-capability.ts',
    'src/server/prospect-batches/lusha-branch-plan-resolution.ts',
  ];
  /** Quién puede tener cualquier arista de runtime hacia el módulo del catálogo. */
  const RUNTIME_IMPORTERS = [
    ...PLAN_READERS,
    // Sólo `LUSHA_MACRO_SEARCH_PLAN_MAX_BRANCHES`, para derivar sus techos.
    'src/server/prospect-batches/lusha-multibranch-execution.ts',
  ];

  /** Los bindings que el fichero importa en runtime desde el catálogo. */
  function runtimeBindings(body: string): string[] {
    const named = /import\s+(?!type\b)\{([^}]*)\}\s*from\s+['"][^'"]*lusha-macro-search-plan['"]/g;
    const bindings: string[] = [];
    for (const match of body.matchAll(named)) {
      for (const raw of (match[1] ?? '').split(',')) {
        const binding = raw.trim();
        // `type X` dentro de las llaves tampoco crea arista de runtime.
        if (binding !== '' && !binding.startsWith('type ')) bindings.push(binding);
      }
    }
    return bindings;
  }

  it('sólo los módulos autorizados importan el catálogo en runtime', () => {
    const importers: string[] = [];
    for (const file of SOURCES) {
      if (file.endsWith('lusha-macro-search-plan.ts')) continue;
      const body = readFileSync(file, 'utf8');
      if (!body.includes('lusha-macro-search-plan')) continue;
      // `import type` no crea arista de runtime: siempre está permitido.
      const valueImport = /import\s+(?!type\b)[^;]*from\s+['"][^'"]*lusha-macro-search-plan['"]/;
      const dynamicImport = /import\s*\(\s*['"][^'"]*lusha-macro-search-plan['"]/;
      if (valueImport.test(body) || dynamicImport.test(body)) {
        importers.push(path.relative(process.cwd(), file));
      }
    }
    assert.deepEqual(
      [...importers].sort(),
      [...RUNTIME_IMPORTERS].sort(),
      `importadores de runtime inesperados: ${importers.join(', ')}`,
    );
  });

  it('🔴 sólo el puente puede LEER los planes; el resto, sólo los techos', () => {
    for (const file of SOURCES) {
      if (file.endsWith('lusha-macro-search-plan.ts')) continue;
      const relative = path.relative(process.cwd(), file);
      if (PLAN_READERS.includes(relative)) continue;
      const bindings = runtimeBindings(readFileSync(file, 'utf8'));
      for (const binding of bindings) {
        assert.ok(
          binding.startsWith('LUSHA_MACRO_SEARCH_PLAN_M'),
          `${relative} no debe leer los planes en runtime (importa ${binding})`,
        );
      }
    }
  });

  it('🔴 completitud del catálogo ES elegibilidad de proveedor (ROUTING-CUTOVER-1)', () => {
    // § 2 — la propiedad central del cutover, y la INVERSIÓN deliberada del
    // ratchet que #302 dejaba aquí.
    //
    // Antes se afirmaba lo contrario («completitud NO es elegibilidad») porque las
    // rutas eran tres y anunciar doce habría prometido rutas sin respaldo. Ese
    // respaldo ya existe: el ejecutor multi-rama corre planes, la reserva es
    // consciente del plan y la liquidación es veraz. Así que las 12 macro con plan
    // son las 12 rutas, y el conjunto se DERIVA — no se escribe.
    assert.equal(LUSHA_MACRO_SEARCH_PLANS.length, MACRO_INDUSTRY_COUNT);

    for (const plan of LUSHA_MACRO_SEARCH_PLANS) {
      assert.equal(
        isProspectLushaEligible({
          searchType: 'exploratory',
          macroIndustryKey: plan.macroKey,
          countryCode: 'CO',
        }),
        true,
        `${plan.macroKey} debe ser elegible tras el cutover`,
      );
    }

    // 🔴 Y el vocabulario legacy dejó de nombrar rutas. `healthcare` y `education`
    // eran los dos sectores que NO son claves de macro; ninguno es ya elegible.
    // (`technology` es la misma cadena en los dos vocabularios y sigue siendo ruta
    // por ser una MACRO, no por ser un sector.)
    for (const legacySectorKey of ['healthcare', 'education']) {
      assert.equal(
        isProspectLushaEligible({
          searchType: 'exploratory',
          macroIndustryKey: legacySectorKey,
          countryCode: 'CO',
        }),
        false,
        `el sector legacy ${legacySectorKey} no debe ser elegible`,
      );
    }

    // El catálogo legacy sigue publicando sus tres sectores: no se borró, se
    // desconectó de la decisión.
    assert.deepEqual(getLushaSectorOptions().map((option) => option.key).sort(), [
      'education',
      'healthcare',
      'technology',
    ]);
  });

  it('un sector admitido ejecuta su plan; sin macro equivalente sigue como hoy', () => {
    // technology: 1 rama (main 17) — idéntico a la búsqueda de hoy, reserva 2.
    const technology = resolveLushaSearchPlanForSector('technology');
    assert.equal(technology?.macroKey, 'technology');
    assert.equal(technology?.branches.length, 1);
    assert.equal(estimateLushaRunCredits(technology), 2);

    // healthcare: 3 ramas — la ganancia real. `main 11` a secas perdía
    // farmacéuticas (12/71) y dispositivos médicos (12/80).
    const health = resolveLushaSearchPlanForSector('healthcare');
    assert.equal(health?.macroKey, 'health_pharma');
    assert.equal(health?.branches.length, 3);
    assert.equal(estimateLushaRunCredits(health), 6);

    // education: sector VIVO en Lusha y NO macro de SellUp (decisión de la dueña,
    // 2026-08-13). Sin plan ⇒ búsqueda legacy única y reserva 2. No es un bloqueo.
    assert.equal(resolveLushaSearchPlanForSector('education'), null);
    assert.equal(estimateLushaRunCredits(resolveLushaSearchPlanForSector('education')), 2);

    // Un sector inexistente tampoco obtiene plan.
    assert.equal(resolveLushaSearchPlanForSector('energia'), null);
    assert.equal(resolveLushaSearchPlanForSector(null), null);
  });

  it('el mapper legacy se conserva; el censo del registry ya NO lo espeja', () => {
    // ROUTING-CUTOVER-1 § 5 — el mapper no se borra: sigue describiendo la
    // correspondencia histórica y lo usan las suites que documentan el
    // comportamiento anterior.
    const mapper = readFileSync(
      path.join(SRC_ROOT, 'server/prospect-batches/lusha-sector-mapping.ts'),
      'utf8',
    );
    assert.ok(mapper.includes("export type LushaSectorKey = 'healthcare' | 'education' | 'technology'"));

    // § 6 — pero el registry deja de tener su propio censo de tres sectores. Era un
    // segundo padrón de rutas, y además nombraba `education`, que no es una macro
    // de SellUp. Ahora su cobertura de industria se DERIVA del catálogo.
    const registry = readFileSync(
      path.join(SRC_ROOT, 'modules/prospect-batches/provider-routing/provider-registry.ts'),
      'utf8',
    );
    // Se afirma sobre la DECLARACIÓN, no sobre el texto: la cabecera del registry
    // nombra la constante retirada para explicar por qué se fue, y castigar esa
    // explicación sería castigar la documentación del cambio.
    assert.equal(registry.includes('const LUSHA_SUPPORTED_SECTORS'), false);
    // La cobertura de industria queda declarada ABIERTA: este registry no es
    // autoridad de industria para Lusha, y el plan 11D ya la ensanchaba antes de
    // resolver. Derivar aquí las 12 habría invertido la dependencia del paquete,
    // que es DATA-ONLY y tiene su propio ratchet de imports.
    assert.ok(registry.includes('supportedIndustries: COVERAGE_ALL'));
  });

  it('el catálogo es puro: no importa red, DB, env ni cliente de proveedor', () => {
    const body = readFileSync(
      path.join(SRC_ROOT, 'server/prospect-batches/lusha-macro-search-plan.ts'),
      'utf8',
    );
    for (const forbidden of [
      'process.env',
      'supabase',
      'lusha-client',
      'fetch(',
      'node-fetch',
      "from 'next",
    ]) {
      assert.equal(body.includes(forbidden), false, `catálogo impuro: ${forbidden}`);
    }
    const metadata = readFileSync(
      path.join(SRC_ROOT, 'server/prospect-batches/lusha-industry-metadata.ts'),
      'utf8',
    );
    for (const forbidden of ['process.env', 'fetch(', 'supabase']) {
      assert.equal(metadata.includes(forbidden), false, `metadata impura: ${forbidden}`);
    }
  });

  it('describir un plan no rompe y usa las etiquetas capturadas', () => {
    const energy = resolveLushaMacroSearchPlan('energy_mining_environment' as never);
    assert.ok(energy);
    assert.equal(
      describeLushaMacroSearchPlan(energy),
      'energy_mining_environment: Oil, Gas & Mining | Utilities | Business Services › Environmental Services',
    );
  });
});
