/**
 * lusha-macro-v2-routing-cutover.test.ts — la elegibilidad Lusha son las 12 Macro
 * Industrias, y sólo ellas.
 *
 * AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 §§ 7, 8, 9, 10, 11, 12, 13, 14, 17, 18,
 * 19, 20.
 *
 * ── Qué defiende esta suite ───────────────────────────────────────────────────
 *
 * Tres propiedades que se rompen de formas distintas y por eso se prueban por
 * separado:
 *
 *   1. COMPLETITUD — las 12 macro aprobadas resuelven capacidad, plan, número de
 *      ramas y reserva, y los cuatro salen del MISMO plan. Un 11/12 es el modo de
 *      fallo realista aquí, no un 0/12: basta que una clave no pase una validación
 *      de longitud para que la macro más ancha del catálogo desaparezca sin ruido.
 *   2. CIERRE — Educación, lo desconocido, lo vacío y los slugs antiguos NO son
 *      rutas. Educación es el caso peligroso porque SÍ existe en Lusha: el
 *      proveedor la publica con main propio, así que el error no sería «no se
 *      encuentra» sino «se encuentra y devuelve colegios».
 *   3. CABLEADO — la ruta que el wizard ejecuta DE VERDAD usa la autoridad nueva.
 *      Un resolvedor correcto que nadie llama pasa todas las pruebas de unidad y
 *      no cambia nada en producción; § 18 existe justamente para eso.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  MACRO_INDUSTRY_KEYS,
  MACRO_INDUSTRY_COUNT,
  MACRO_INDUSTRIES,
  isMacroIndustryKey,
  type MacroIndustryKey,
} from '@/modules/macro-industry-catalog/macro-industries';
import {
  LUSHA_ROUTABLE_MACRO_KEYS,
  resolveLushaMacroCapability,
  resolveLushaRoutedSearchPlan,
  resolveLushaRoutedBranchCount,
  resolveLushaMacroMatchKeywords,
  isLushaMacroRoutable,
  validateLushaRoutingCompleteness,
  assertLushaRoutingCompleteness,
} from '@/server/prospect-batches/lusha-macro-capability';
import { LUSHA_MACRO_SEARCH_PLANS } from '@/server/prospect-batches/lusha-macro-search-plan';
import {
  estimateLushaRunCredits,
  resolveLushaRequiredCreditsByMacroIndustry,
} from '@/server/prospect-batches/lusha-run-liability';
import {
  isProspectLushaEligible,
  resolveProspectDiscoveryProvider,
} from '@/modules/prospect-batches/prospect-discovery-provider';
import {
  resolveWizardLushaCriteria,
  resolveWizardMacroIndustryKey,
} from '@/modules/prospect-batches/wizard-lusha-criteria';
import { resolveProspectWizardRoute } from '@/modules/prospect-batches/prospect-wizard-route';
import {
  resolveLushaPreExecutionBudgetBlock,
  resolveLushaPreflightRequiredCredits,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';
import { DEFAULT_PROVIDER_REGISTRY } from '@/modules/prospect-batches/provider-routing';
import { WIZARD_RUN_SELECTABLE_PROVIDERS } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';

// ─── Tabla aprobada (§ 3) ─────────────────────────────────────────────────────

/**
 * Las 12 macro con su número de ramas y su responsabilidad esperada.
 *
 * 🔑 La responsabilidad NO se afirma contra estos números y se acabó: se afirma
 * que el número DERIVADO del plan coincide con ellos. La tabla es el enunciado
 * externo del hito; el runtime tiene que llegar a él por su cuenta, y si algún día
 * el plan cambia, esta tabla es el sitio donde la discrepancia se ve.
 */
const APPROVED: ReadonlyArray<{
  macroKey: MacroIndustryKey;
  branches: number;
  liability: number;
}> = [
  { macroKey: 'transport_logistics', branches: 1, liability: 2 },
  { macroKey: 'technology', branches: 1, liability: 2 },
  { macroKey: 'insurance_financial_services', branches: 1, liability: 2 },
  { macroKey: 'health_pharma', branches: 3, liability: 6 },
  { macroKey: 'retail', branches: 1, liability: 2 },
  { macroKey: 'property_construction', branches: 2, liability: 4 },
  { macroKey: 'industry_manufacturing_chemicals_automotive', branches: 1, liability: 2 },
  { macroKey: 'government', branches: 1, liability: 2 },
  { macroKey: 'energy_mining_environment', branches: 3, liability: 6 },
  { macroKey: 'consumer_goods', branches: 2, liability: 4 },
  { macroKey: 'services_company', branches: 3, liability: 6 },
  { macroKey: 'agroindustry', branches: 2, liability: 4 },
];

/** La clave canónica más larga del catálogo. Se DERIVA, no se escribe. */
const LONGEST_MACRO_KEY: MacroIndustryKey = [...MACRO_INDUSTRY_KEYS].sort(
  (a, b) => b.length - a.length,
)[0];

const SUPPORTED_COUNTRY = 'CO';

/** Catálogo Macro-v2 sintético: una fila por macro, con su slug publicado. */
function buildMacroCatalog(): ActiveIndustryCatalog {
  return {
    version: '2.0.0',
    industries: MACRO_INDUSTRIES.map((definition, index) => ({
      id: `industry-${definition.key}`,
      name: definition.displayName,
      slug: definition.slug,
      description: null,
      sortOrder: index + 1,
    })),
    subindustries: [],
  };
}

const MACRO_CATALOG = buildMacroCatalog();

function wizardState(industryId: string | null) {
  return {
    countryCode: SUPPORTED_COUNTRY,
    industryId,
    subindustryIds: [] as string[],
    additionalCriteriaRaw: null,
  };
}

// ─── 1–6 · Las 12 macro son ruta, plan, ramas y reserva (§§ 11, 12, 17) ───────

describe('12/12 — cada macro industria aprobada es una ruta Lusha completa', () => {
  it('la tabla de este hito cubre exactamente las 12 claves canónicas', () => {
    assert.equal(APPROVED.length, MACRO_INDUSTRY_COUNT);
    assert.deepEqual(
      APPROVED.map((row) => row.macroKey),
      [...MACRO_INDUSTRY_KEYS],
    );
  });

  for (const row of APPROVED) {
    describe(row.macroKey, () => {
      // 1. clave canónica válida
      it('es una MacroIndustryKey canónica', () => {
        assert.equal(isMacroIndustryKey(row.macroKey), true);
      });

      // 2. capacidad Lusha = soportada
      it('la capacidad Lusha existe y está en el censo derivado', () => {
        const capability = resolveLushaMacroCapability(row.macroKey);
        assert.ok(capability, `${row.macroKey} debe tener capacidad Lusha`);
        assert.equal(capability.macroKey, row.macroKey);
        assert.equal(isLushaMacroRoutable(row.macroKey), true);
        assert.ok(
          LUSHA_ROUTABLE_MACRO_KEYS.includes(row.macroKey),
          `${row.macroKey} debe estar en LUSHA_ROUTABLE_MACRO_KEYS`,
        );
      });

      // 3. plan canónico correcto
      it('devuelve SU plan canónico, la misma referencia del catálogo', () => {
        const plan = resolveLushaRoutedSearchPlan(row.macroKey);
        const canonical = LUSHA_MACRO_SEARCH_PLANS.find((p) => p.macroKey === row.macroKey);
        assert.ok(plan);
        assert.equal(plan.macroKey, row.macroKey);
        // Misma referencia: si fueran objetos distintos, dos lugares podrían
        // estar leyendo dos planes que se parecen.
        assert.equal(plan, canonical);
      });

      // 4. número de ramas correcto
      it(`ejecuta ${row.branches} rama(s), derivadas del plan`, () => {
        const plan = resolveLushaRoutedSearchPlan(row.macroKey);
        assert.equal(plan?.branches.length, row.branches);
        assert.equal(resolveLushaRoutedBranchCount(row.macroKey), row.branches);
        assert.equal(resolveLushaMacroCapability(row.macroKey)?.branchCount, row.branches);
      });

      // 5. responsabilidad correcta, DERIVADA
      it(`reserva ${row.liability} créditos, y el número sale del plan`, () => {
        const plan = resolveLushaRoutedSearchPlan(row.macroKey);
        assert.equal(estimateLushaRunCredits(plan), row.liability);
        // El producto tiene que ser ramas × 2, no una tabla paralela.
        assert.equal(row.liability, row.branches * 2);
      });

      // 6. sin traducción a sector legacy
      it('es elegible SIN pasar por ningún sector legacy', () => {
        assert.equal(
          isProspectLushaEligible({
            searchType: 'exploratory',
            macroIndustryKey: row.macroKey,
            countryCode: SUPPORTED_COUNTRY,
          }),
          true,
        );
        const decision = resolveProspectDiscoveryProvider({
          lushaPreviewEnabled: true,
          searchType: 'exploratory',
          macroIndustryKey: row.macroKey,
          countryCode: SUPPORTED_COUNTRY,
        });
        assert.equal(decision.provider, 'lusha');
        assert.equal(decision.reason, 'criteria_compatible');
      });

      it('el wizard la resuelve desde el catálogo publicado y la enruta', () => {
        const state = wizardState(`industry-${row.macroKey}`);
        assert.equal(resolveWizardMacroIndustryKey(state, MACRO_CATALOG), row.macroKey);

        const decision = resolveWizardLushaCriteria(state, MACRO_CATALOG, true);
        assert.equal(decision.provider, 'lusha');
        assert.equal(decision.input?.macroIndustryKey, row.macroKey);
      });
    });
  }
});

// ─── § 11 · las multi-rama son alcanzables ────────────────────────────────────

describe('§ 11 — la elegibilidad NO está limitada a las macro de una sola rama', () => {
  const MULTI: ReadonlyArray<[MacroIndustryKey, number]> = [
    ['property_construction', 2],
    ['health_pharma', 3],
    ['energy_mining_environment', 3],
    ['consumer_goods', 2],
    ['services_company', 3],
    ['agroindustry', 2],
  ];

  for (const [macroKey, branches] of MULTI) {
    it(`${macroKey} (${branches} ramas) es alcanzable por la ruta moderna`, () => {
      const state = wizardState(`industry-${macroKey}`);
      const decision = resolveWizardLushaCriteria(state, MACRO_CATALOG, true);
      assert.equal(decision.provider, 'lusha');
      assert.equal(decision.input?.macroIndustryKey, macroKey);
      assert.equal(resolveLushaRoutedBranchCount(macroKey), branches);
      assert.equal(estimateLushaRunCredits(resolveLushaRoutedSearchPlan(macroKey)), branches * 2);
    });
  }

  it('las seis multi-rama son exactamente las que el catálogo declara', () => {
    const derived = LUSHA_MACRO_SEARCH_PLANS.filter((plan) => plan.branches.length > 1)
      .map((plan) => plan.macroKey)
      .sort();
    assert.deepEqual(derived, MULTI.map(([key]) => key).sort());
  });
});

// ─── § 10 · salud, directa ────────────────────────────────────────────────────

describe('§ 10 — health_pharma resuelve su plan DIRECTAMENTE', () => {
  it('main 11 + 12/71 + 12/80, sin convertir a `healthcare` y volver', () => {
    const plan = resolveLushaRoutedSearchPlan('health_pharma');
    assert.ok(plan);
    assert.deepEqual(
      plan.branches.map((branch) => [branch.mainIndustryId, branch.subIndustryId ?? null]),
      [
        [11, null],
        [12, 71],
        [12, 80],
      ],
    );
  });

  it('`healthcare` —el sector legacy— NO es una ruta moderna', () => {
    // Ratchet directo del § 10: si alguien reintrodujera la traducción
    // health_pharma → healthcare → health_pharma, el sector legacy volvería a ser
    // nombrable desde la superficie moderna y esto se pondría rojo.
    assert.equal(resolveLushaMacroCapability('healthcare'), null);
    assert.equal(
      isProspectLushaEligible({
        searchType: 'exploratory',
        macroIndustryKey: 'healthcare',
        countryCode: SUPPORTED_COUNTRY,
      }),
      false,
    );
  });
});

// ─── § 9 · la colisión `technology` ───────────────────────────────────────────

describe('§ 9 — `technology` es la MISMA cadena en los dos vocabularios', () => {
  it('resuelve por la autoridad moderna: main 17, una rama, reserva 2', () => {
    const capability = resolveLushaMacroCapability('technology');
    assert.ok(capability);
    assert.equal(capability.macroKey, 'technology');
    assert.equal(capability.branchCount, 1);
    assert.deepEqual(
      capability.plan.branches.map((branch) => branch.mainIndustryId),
      [17],
    );
    assert.equal(estimateLushaRunCredits(capability.plan), 2);
  });

  it('UNA sola decisión de elegibilidad y UN solo plan — sin ambigüedad', () => {
    // Que la cadena exista también en el vocabulario legacy no puede producir dos
    // resultados. El plan resuelto por la autoridad moderna y el que el catálogo
    // publica son el mismo objeto, así que no hay dos planes que elegir.
    const viaCapability = resolveLushaRoutedSearchPlan('technology');
    const canonical = LUSHA_MACRO_SEARCH_PLANS.find((plan) => plan.macroKey === 'technology');
    assert.equal(viaCapability, canonical);

    const decisions = [true, true].map(() =>
      resolveProspectDiscoveryProvider({
        lushaPreviewEnabled: true,
        searchType: 'exploratory',
        macroIndustryKey: 'technology',
        countryCode: SUPPORTED_COUNTRY,
      }),
    );
    assert.deepEqual(decisions[0], decisions[1]);
    assert.equal(decisions[0].provider, 'lusha');
  });

  it('la ruta moderna no necesita ningún respaldo legacy para technology', () => {
    const state = wizardState('industry-technology');
    const decision = resolveWizardLushaCriteria(state, MACRO_CATALOG, true);
    assert.equal(decision.input?.macroIndustryKey, 'technology');
  });
});

// ─── 13–16 · negativos, fail-closed (§§ 4, 7) ────────────────────────────────

describe('§§ 4/7 — fail-closed: lo que NO es una ruta Lusha', () => {
  const CLOSED: ReadonlyArray<[string, string | null | undefined]> = [
    ['education (existe en Lusha, NO es macro de SellUp)', 'education'],
    ['random', 'random'],
    ['cadena vacía', ''],
    ['sólo espacios', '   '],
    ['slug de subindustria antiguo', 'hospitales-y-clinicas'],
    ['slug kebab-case de una macro (no es la clave)', 'health-pharma'],
    ['nombre visible de una macro', 'Salud & Farmacéuticos'],
    ['clave macro con mayúsculas', 'HEALTH_PHARMA'],
    ['null', null],
    ['undefined', undefined],
  ];

  for (const [label, value] of CLOSED) {
    it(`${label} → sin capacidad, sin plan, sin ruta`, () => {
      assert.equal(resolveLushaMacroCapability(value), null);
      assert.equal(isLushaMacroRoutable(value), false);
      assert.equal(resolveLushaRoutedSearchPlan(value), null);
      assert.equal(resolveLushaRoutedBranchCount(value), null);
      assert.equal(
        isProspectLushaEligible({
          searchType: 'exploratory',
          macroIndustryKey: value,
          countryCode: SUPPORTED_COUNTRY,
        }),
        false,
      );
    });
  }

  it('un valor cerrado degrada a `default_ai`, NUNCA a un bloqueo', () => {
    // La distinción importa: `blocked_lusha_disabled` significa «el proveedor
    // oculto no participa» y sólo lo produce el flag. Una industria sin ruta tiene
    // su camino normal —el discovery de Agente 1— y confundir las dos cosas es lo
    // que dejó «Empresas por criterios» sin forma de ejecutar en su día.
    for (const [, value] of CLOSED) {
      const decision = resolveProspectDiscoveryProvider({
        lushaPreviewEnabled: true,
        searchType: 'exploratory',
        macroIndustryKey: value,
        countryCode: SUPPORTED_COUNTRY,
      });
      assert.equal(decision.provider, 'default_ai');
      assert.equal(decision.reason, 'sector_not_mapped');
    }
  });

  it('🔴 Educación NO es la ruta decimotercera, ni por alias ni por mapeo', () => {
    // (a) no es clave canónica…
    assert.equal(isMacroIndustryKey('education'), false);
    // (b) …no está en el censo de rutas…
    assert.equal(LUSHA_ROUTABLE_MACRO_KEYS.includes('education' as MacroIndustryKey), false);
    // (c) …no tiene plan…
    assert.equal(
      LUSHA_MACRO_SEARCH_PLANS.some((plan) => (plan.macroKey as string) === 'education'),
      false,
    );
    // (d) …y ninguna otra macro la absorbe. `services_company` es la tentación
    // obvia y la que la dueña descartó explícitamente el 2026-08-13.
    const services = resolveLushaMacroCapability('services_company');
    assert.ok(services);
    assert.equal(
      services.plan.branches.some((branch) => branch.mainIndustryId === 6),
      false,
      'ninguna rama de services_company puede pedir el main 6 (Education) de Lusha',
    );
    for (const plan of LUSHA_MACRO_SEARCH_PLANS) {
      assert.equal(
        plan.branches.some((branch) => branch.mainIndustryId === 6),
        false,
        `${plan.macroKey} no puede pedir el main 6 (Education)`,
      );
    }
    // (e) el invariante de completitud lo declara.
    assert.deepEqual(validateLushaRoutingCompleteness(), []);
  });

  it('un catálogo legacy v1 (8 industrias, sin macro) no produce ninguna ruta', () => {
    const legacyCatalog: ActiveIndustryCatalog = {
      version: '1.0.0',
      industries: [
        { id: 'legacy-salud', name: 'Salud', slug: 'salud', description: null, sortOrder: 1 },
        {
          id: 'legacy-educacion',
          name: 'Educación',
          slug: 'educacion',
          description: null,
          sortOrder: 2,
        },
      ],
      subindustries: [],
    };
    for (const industry of legacyCatalog.industries) {
      const state = wizardState(industry.id);
      assert.equal(resolveWizardMacroIndustryKey(state, legacyCatalog), null);
      const decision = resolveWizardLushaCriteria(state, legacyCatalog, true);
      assert.equal(decision.provider, 'default_ai');
      assert.equal(decision.input, null);
    }
  });
});

// ─── 17 · la clave más larga (§ 8) ───────────────────────────────────────────

describe('§ 8 — la clave canónica más larga sobrevive de punta a punta', () => {
  it('la más larga es `industry_manufacturing_chemicals_automotive`', () => {
    assert.equal(LONGEST_MACRO_KEY, 'industry_manufacturing_chemicals_automotive');
    // 🔴 43 > 40. El contrato anterior era `z.string().trim().min(1).max(40)`, así
    // que ESTA clave —y sólo ésta— habría sido rechazada como entrada inválida
    // después de que la UI ya la ofreciera: un 11/12 silencioso.
    assert.ok(LONGEST_MACRO_KEY.length > 40, 'la clave más larga supera el viejo max(40)');
    assert.equal(LONGEST_MACRO_KEY.length, 43);
  });

  it('atraviesa wizard → validación → routing → plan sin truncarse ni rechazarse', () => {
    // wizard: catálogo → clave
    const state = wizardState(`industry-${LONGEST_MACRO_KEY}`);
    assert.equal(resolveWizardMacroIndustryKey(state, MACRO_CATALOG), LONGEST_MACRO_KEY);

    // routing
    const decision = resolveWizardLushaCriteria(state, MACRO_CATALOG, true);
    assert.equal(decision.provider, 'lusha');
    // la clave llega ENTERA, carácter a carácter
    assert.equal(decision.input?.macroIndustryKey, LONGEST_MACRO_KEY);
    assert.equal(decision.input?.macroIndustryKey.length, 43);

    // capacidad + plan + reserva
    const capability = resolveLushaMacroCapability(decision.input?.macroIndustryKey);
    assert.ok(capability);
    assert.equal(capability.macroKey, LONGEST_MACRO_KEY);
    assert.equal(estimateLushaRunCredits(capability.plan), 2);
  });

  it('el esquema de la acción es un ENUM canónico, no una cadena con techo', () => {
    // § 8 — la propiedad se prueba sobre el TEXTO del esquema porque el módulo es
    // `'use server'` y no se puede importar aquí sin arrastrar Supabase.
    const source = stripComments(
      readFileSync(
        path.join(SRC_ROOT, 'modules/prospect-batches/lusha-pending-review-actions.ts'),
        'utf8',
      ),
    );
    assert.match(source, /macroIndustryKey:\s*z\.enum\(MACRO_INDUSTRY_KEYS\)/);
    // Ni un `max(40)` en el fichero, ni un `sectorKey` en el esquema.
    assert.doesNotMatch(source, /\.max\(40\)/);
    assert.doesNotMatch(source, /sectorKey/);
  });

  it('ningún esquema del repo acota una clave de industria con max(40)', () => {
    for (const file of SOURCES) {
      const body = stripComments(readFileSync(file, 'utf8'));
      for (const line of body.split('\n')) {
        if (!/\.max\(40\)/.test(line)) continue;
        assert.doesNotMatch(
          line,
          /(sectorKey|industryKey|macroIndustryKey)/,
          `${path.relative(process.cwd(), file)} acota una clave de industria con max(40): ${line.trim()}`,
        );
      }
    }
  });
});

// ─── § 19 · completitud del catálogo = completitud de routing ────────────────

describe('§ 19 — el censo de rutas y el catálogo de planes son el MISMO conjunto', () => {
  it('set(rutas) === set(claves de plan)', () => {
    assert.deepEqual(
      [...LUSHA_ROUTABLE_MACRO_KEYS].sort(),
      LUSHA_MACRO_SEARCH_PLANS.map((plan) => plan.macroKey).sort(),
    );
    assert.equal(LUSHA_ROUTABLE_MACRO_KEYS.length, MACRO_INDUSTRY_COUNT);
    assert.deepEqual(validateLushaRoutingCompleteness(), []);
    assert.doesNotThrow(() => assertLushaRoutingCompleteness());
  });

  it('el censo se DERIVA: no existe una segunda lista de 12 escrita a mano', () => {
    const source = stripComments(
      readFileSync(path.join(SRC_ROOT, 'server/prospect-batches/lusha-macro-capability.ts'), 'utf8'),
    );
    // Se deriva del catálogo de planes…
    assert.match(source, /LUSHA_MACRO_SEARCH_PLANS\.map\(\(plan\) => plan\.macroKey\)/);
    // …y NINGUNA clave de macro aparece como literal en el módulo.
    for (const key of MACRO_INDUSTRY_KEYS) {
      assert.doesNotMatch(
        source,
        new RegExp(`['"\`]${key}['"\`]`),
        `lusha-macro-capability no debe nombrar ${key} como literal`,
      );
    }
  });

  it('el registry ya no tiene su propio censo de industrias Lusha', () => {
    // § 6 — ni el literal de tres sectores, ni una lista de doce a mano, ni una
    // lista derivada: este registry NO es autoridad de industria para Lusha, y
    // declararlo abierto lo dice. Quien decide es `resolveLushaMacroCapability`
    // aguas arriba, y el plan 11D ya ensanchaba esta cobertura antes de resolver.
    const source = stripComments(
      readFileSync(
        path.join(SRC_ROOT, 'modules/prospect-batches/provider-routing/provider-registry.ts'),
        'utf8',
      ),
    );
    assert.doesNotMatch(source, /LUSHA_SUPPORTED_SECTORS/);
    // 🔴 Y el sector legacy `education` desaparece del fichero: era la única
    // referencia del repo que anunciaba Educación como industria Lusha soportada.
    for (const legacySector of ['healthcare', 'education']) {
      assert.doesNotMatch(
        source,
        new RegExp(`['"]${legacySector}['"]`),
        `el registry no debe nombrar el sector legacy ${legacySector}`,
      );
    }
    assert.equal(DEFAULT_PROVIDER_REGISTRY.lusha?.supportedIndustries, 'all');

    // 🔑 Lo que NO se abre: la cobertura de PAÍS sigue siendo un allowlist (esa sí
    // es del proveedor), y `sector` sigue siendo criterio requerido.
    assert.notEqual(DEFAULT_PROVIDER_REGISTRY.lusha?.supportedCountries, 'all');
    assert.ok(DEFAULT_PROVIDER_REGISTRY.lusha?.requiredCriteria.includes('sector'));
  });

  it('el paquete provider-routing sigue sin depender de la autoridad Macro-v2', () => {
    // Su propio ratchet («only imports from its own dir or the pure intake types»)
    // defiende que sea DATA-ONLY. Derivar aquí los doce valores habría invertido esa
    // dependencia para reproducir una lista que el módulo no usa para decidir nada.
    const source = stripComments(
      readFileSync(
        path.join(SRC_ROOT, 'modules/prospect-batches/provider-routing/provider-registry.ts'),
        'utf8',
      ),
    );
    assert.doesNotMatch(source, /lusha-macro-capability/);
    assert.doesNotMatch(source, /macro-industry-catalog/);
  });

  it('una macro sin plan sería `route_without_plan`, no una ruta silenciosa', () => {
    // No se puede mutar el catálogo congelado, así que se prueba el validador con
    // la propiedad que lo gobierna: el desajuste tiene NOMBRE.
    const planKeys = new Set(LUSHA_MACRO_SEARCH_PLANS.map((plan) => plan.macroKey));
    for (const key of LUSHA_ROUTABLE_MACRO_KEYS) {
      assert.ok(planKeys.has(key), `${key} se anuncia como ruta y debe tener plan`);
    }
  });
});

// ─── § 12 · routing y presupuesto, del MISMO plan ────────────────────────────

describe('§ 12 — si la ruta se anuncia, su reserva exacta ya es resoluble', () => {
  it('la tabla del preflight cubre exactamente las 12 rutas', () => {
    const byMacro = resolveLushaRequiredCreditsByMacroIndustry();
    assert.deepEqual(Object.keys(byMacro).sort(), [...MACRO_INDUSTRY_KEYS].sort());
  });

  it('cada fila del preflight sale del MISMO plan que la ruta', () => {
    const byMacro = resolveLushaRequiredCreditsByMacroIndustry();
    for (const row of APPROVED) {
      const plan = resolveLushaRoutedSearchPlan(row.macroKey);
      assert.equal(byMacro[row.macroKey], estimateLushaRunCredits(plan));
      assert.equal(byMacro[row.macroKey], row.liability);
    }
  });

  it('ninguna ruta es elegible con plan `null`', () => {
    for (const macroKey of LUSHA_ROUTABLE_MACRO_KEYS) {
      const eligible = isProspectLushaEligible({
        searchType: 'exploratory',
        macroIndustryKey: macroKey,
        countryCode: SUPPORTED_COUNTRY,
      });
      assert.equal(eligible, true);
      assert.notEqual(resolveLushaRoutedSearchPlan(macroKey), null);
    }
    // Y al revés: sin plan no hay elegibilidad. La capacidad es UNA puerta, así
    // que la implicación se cumple en los dos sentidos por construcción.
    assert.equal(resolveLushaMacroCapability('education'), null);
  });

  it('el aviso previo bloquea con el techo REAL de la macro, no con 2', () => {
    const preflight = {
      availableCredits: 4,
      requiredCreditsByProvider: { tavily: 5, apollo_organizations: 25 },
      lushaRequiredCredits: 2,
      lushaRequiredCreditsByMacroIndustry: resolveLushaRequiredCreditsByMacroIndustry(),
    } as const;

    // 4 disponibles, `services_company` cuesta 6 ⇒ se retira la oferta.
    assert.equal(resolveLushaPreflightRequiredCredits(preflight, 'services_company'), 6);
    const block = resolveLushaPreExecutionBudgetBlock(preflight, 'services_company');
    assert.equal(block?.reason, 'insufficient_for_run');
    assert.equal(block?.requiredCredits, 6);

    // 4 disponibles, `technology` cuesta 2 ⇒ cabe.
    assert.equal(resolveLushaPreflightRequiredCredits(preflight, 'technology'), 2);
    assert.equal(resolveLushaPreExecutionBudgetBlock(preflight, 'technology'), null);

    // 4 disponibles, `consumer_goods` cuesta 4 ⇒ cabe EXACTA (comparación estricta).
    assert.equal(resolveLushaPreExecutionBudgetBlock(preflight, 'consumer_goods'), null);
  });

  it('sin tabla se conserva el respaldo y NUNCA se inventa un número', () => {
    const noTable = {
      availableCredits: 10,
      requiredCreditsByProvider: { tavily: 5, apollo_organizations: 25 },
      lushaRequiredCredits: 2,
      lushaRequiredCreditsByMacroIndustry: null,
    } as const;
    assert.equal(resolveLushaPreflightRequiredCredits(noTable, 'services_company'), 2);
    assert.equal(resolveLushaPreExecutionBudgetBlock(null, 'services_company'), null);
  });
});

// ─── § 13 · el flag sigue mandando ───────────────────────────────────────────

describe('§ 13 — las 12 rutas están listas y OPERATIVAMENTE cerradas', () => {
  it('con el flag apagado ninguna de las 12 resuelve a `lusha`', () => {
    for (const macroKey of LUSHA_ROUTABLE_MACRO_KEYS) {
      const decision = resolveProspectDiscoveryProvider({
        lushaPreviewEnabled: false,
        searchType: 'exploratory',
        macroIndustryKey: macroKey,
        countryCode: SUPPORTED_COUNTRY,
      });
      assert.equal(decision.provider, 'blocked_lusha_disabled');
      assert.equal(decision.reason, 'lusha_preview_disabled');
    }
  });

  it('flag apagado ⇒ el wizard no construye input y no llama a la acción Lusha', () => {
    for (const macroKey of LUSHA_ROUTABLE_MACRO_KEYS) {
      const state = wizardState(`industry-${macroKey}`);
      const decision = resolveWizardLushaCriteria(state, MACRO_CATALOG, false);
      assert.equal(decision.provider, 'blocked_lusha_disabled');
      // Sin input no hay país, ni macro, ni banda: no hay nada que enviar.
      assert.equal(decision.input, null);

      const route = resolveProspectWizardRoute({
        criteria: state,
        catalog: MACRO_CATALOG,
        lushaPreviewEnabled: false,
        executionEnabled: true,
      });
      assert.equal(route.effectiveProvider, 'blocked_lusha_disabled');
      assert.notEqual(route.wouldCallAction, 'generateLushaPendingReviewBatchAction');
    }
  });

  it('la elegibilidad se decide ANTES del flag: el flag no puede degradar', () => {
    // Propiedad heredada de Q3F-5BB.10C3-FIX-1 y que el cutover no puede romper:
    // una intención elegible nunca es `default_ai`.
    for (const macroKey of LUSHA_ROUTABLE_MACRO_KEYS) {
      const off = resolveProspectDiscoveryProvider({
        lushaPreviewEnabled: false,
        searchType: 'exploratory',
        macroIndustryKey: macroKey,
        countryCode: SUPPORTED_COUNTRY,
      });
      assert.notEqual(off.provider, 'default_ai');
    }
  });

  it('el flag conserva su nombre y su semántica fail-closed', () => {
    const flags = readFileSync(path.join(SRC_ROOT, 'lib/feature-flags.server.ts'), 'utf8');
    // Sólo `'true'` enciende: ausente, vacío o cualquier otro valor ⇒ apagado.
    assert.match(
      flags,
      /isLushaPreviewEnabled\(\): boolean \{\s*return process\.env\[LUSHA_PREVIEW_FLAG\]\?\.trim\(\)\.toLowerCase\(\) === 'true';/,
    );
    assert.match(flags, /ENABLE_LUSHA_PREVIEW/);
  });

  it('Lusha sigue OCULTA: no entra en la unión de proveedores seleccionables', () => {
    // El radio «Proveedor de esta corrida» se construye desde
    // `WIZARD_RUN_SELECTABLE_PROVIDERS`. Si Lusha entrara ahí dejaría de ser un
    // proveedor oculto y la usuaria podría elegirlo, que es lo contrario de lo que
    // § 13 exige. Se afirma sobre el VALOR, no sobre el texto del fichero: su
    // cabecera nombra `lusha_companies` justamente para explicar que queda fuera.
    assert.deepEqual(
      [...WIZARD_RUN_SELECTABLE_PROVIDERS].sort(),
      ['apollo_organizations', 'tavily'],
    );
    assert.equal(
      (WIZARD_RUN_SELECTABLE_PROVIDERS as readonly string[]).includes('lusha'),
      false,
    );
    // Y el techo de Lusha vive en un campo APARTE del preflight, no dentro de
    // `requiredCreditsByProvider`, que sigue indexado por esa misma unión.
    //
    // AGENT1-WIZARD-BUDGET-UI-APOLLO-DECOUPLE-1 — `Partial<Record<...>>`, no
    // `Record<...>`: desde #386 Apollo no se financia con este pool, así que su
    // clave puede faltar (ver wizard-budget-preflight.server.ts). La unión que
    // indexa el campo —y que mantiene a Lusha fuera— no cambió.
    const preflight = stripComments(
      readFileSync(
        path.join(SRC_ROOT, 'modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight.ts'),
        'utf8',
      ),
    );
    assert.match(preflight, /lushaRequiredCreditsByMacroIndustry\?:/);
    assert.match(
      preflight,
      /requiredCreditsByProvider: Partial<Record<WizardRunSelectableProvider, number>>/,
    );
  });
});

// ─── § 14 · Apollo y Tavily intactos ─────────────────────────────────────────

describe('§ 14 — el cutover no toca la semántica de Apollo ni de Tavily', () => {
  it('`default_ai` sigue significando lo mismo para una búsqueda sin ruta Lusha', () => {
    const decision = resolveProspectDiscoveryProvider({
      lushaPreviewEnabled: true,
      searchType: 'exploratory',
      macroIndustryKey: null,
      countryCode: SUPPORTED_COUNTRY,
    });
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.reason, 'sector_not_mapped');
  });

  it('un tipo de búsqueda que no es «empresas por criterios» sigue en default_ai', () => {
    const decision = resolveProspectDiscoveryProvider({
      lushaPreviewEnabled: true,
      searchType: 'targeted',
      macroIndustryKey: 'health_pharma',
      countryCode: SUPPORTED_COUNTRY,
    });
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.reason, 'search_type_not_criteria');
  });

  it('un país no soportado sigue en default_ai, incluso con macro válida', () => {
    const decision = resolveProspectDiscoveryProvider({
      lushaPreviewEnabled: true,
      searchType: 'exploratory',
      macroIndustryKey: 'health_pharma',
      countryCode: 'XX',
    });
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.reason, 'country_not_supported');
  });

  it('Apollo y Tavily conservan su cobertura y su elegibilidad de fallback', () => {
    const apollo = DEFAULT_PROVIDER_REGISTRY.apollo;
    const tavily = DEFAULT_PROVIDER_REGISTRY.tavily;
    assert.ok(apollo);
    assert.ok(tavily);
    assert.equal(apollo.canRunInProduction, true);
    assert.equal(tavily.canRunInProduction, true);
    // El invariante 10C3: Apollo NUNCA es destino automático de fallback.
    assert.equal(apollo.fallbackEligible, false);
    assert.equal(tavily.fallbackEligible, true);
    // Lusha sigue sin ser destino de fallback.
    assert.equal(DEFAULT_PROVIDER_REGISTRY.lusha?.fallbackEligible, false);
  });

  it('una corrida que va a Lusha nunca toca Apollo (invariante 10C3)', () => {
    for (const macroKey of LUSHA_ROUTABLE_MACRO_KEYS) {
      const route = resolveProspectWizardRoute({
        criteria: wizardState(`industry-${macroKey}`),
        catalog: MACRO_CATALOG,
        lushaPreviewEnabled: true,
        executionEnabled: true,
      });
      assert.equal(route.effectiveProvider, 'lusha');
      assert.equal(route.wouldCallAction, 'generateLushaPendingReviewBatchAction');
      assert.equal(route.wouldUseApollo, false);
    }
  });
});

// ─── § 18 · CABLEADO: la ruta viva usa la autoridad nueva ────────────────────

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

const SOURCES = collectSourceFiles(SRC_ROOT);

/**
 * El fichero sin comentarios.
 *
 * 🔑 Necesario, y la razón es concreta: estos módulos EXPLICAN en su cabecera qué
 * autoridad legacy sustituyen, y nombran `resolveLushaSectorOption`,
 * `LushaSectorKey` y `resolveLushaMainIndustryMapping` para contar por qué ya no
 * se usan. Un ratchet que escanee el fichero crudo se pone rojo por la prosa que
 * documenta el cambio, es decir: castiga la explicación y no la regresión. Lo que
 * hay que vigilar son las referencias EJECUTABLES.
 *
 * El borrado es deliberadamente conservador —bloques `/* … *\/` y líneas `//`—
 * porque un `//` dentro de una cadena (una URL, por ejemplo) sólo puede hacer que
 * el ratchet mire MENOS de la cuenta en esa línea, nunca que apruebe un import: un
 * `import … from '…'` no lleva `//` antes del especificador.
 */
function stripComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * La cadena que el wizard EJECUTA de verdad, de la pantalla a la reserva.
 *
 * § 18 — no basta con escribir un resolvedor correcto: si nadie lo llama, todas
 * las pruebas de arriba pasan y en producción no cambia nada. Estos ficheros son
 * la ruta viva, y las afirmaciones de abajo se rompen si alguno vuelve a la
 * autoridad legacy.
 */
const LIVE_ROUTE = {
  wizard: 'components/prospect-batches/chat-wizard/prospect-chat-wizard.tsx',
  criteria: 'modules/prospect-batches/wizard-lusha-criteria.ts',
  provider: 'modules/prospect-batches/prospect-discovery-provider.ts',
  finalSearch: 'components/prospect-batches/chat-wizard/wizard-lusha-final-search.tsx',
  action: 'modules/prospect-batches/lusha-pending-review-actions.ts',
  dryRoute: 'modules/prospect-batches/prospect-wizard-route.ts',
} as const;

function liveSource(key: keyof typeof LIVE_ROUTE): string {
  return stripComments(readFileSync(path.join(SRC_ROOT, LIVE_ROUTE[key]), 'utf8'));
}

describe('§ 18 — la ruta VIVA del wizard usa la autoridad Macro-v2', () => {
  it('el resolvedor de elegibilidad llama a la capacidad macro, no al sector', () => {
    const provider = liveSource('provider');
    assert.match(provider, /resolveLushaMacroCapability/);
    // 🔴 Ratchet: si vuelve `resolveLushaSectorOption` aquí, la autoridad legacy
    // habría regresado a la decisión ejecutable.
    assert.doesNotMatch(provider, /resolveLushaSectorOption/);
    assert.doesNotMatch(provider, /lusha-sector-mapping/);
    assert.doesNotMatch(provider, /LushaSectorKey/);
    assert.doesNotMatch(provider, /sectorKey/);
  });

  it('el puente del wizard resuelve la macro desde el CATÁLOGO, sin alias', () => {
    const criteria = liveSource('criteria');
    assert.match(criteria, /getMacroIndustryBySlug/);
    assert.match(criteria, /macroIndustryKey/);
    // 🔴 El mapeo difuso por nombre visible era la vía por la que `education`
    // seguía siendo alcanzable y por la que nueve macro degradaban.
    assert.doesNotMatch(criteria, /resolveLushaMainIndustryMapping/);
    assert.doesNotMatch(criteria, /lusha-sector-mapping/);
    assert.doesNotMatch(criteria, /sectorKey/);
  });

  it('la acción resuelve el plan por la MISMA puerta que decidió la ruta', () => {
    const action = liveSource('action');
    assert.match(action, /resolveLushaRoutedSearchPlan/);
    assert.match(action, /lusha-macro-capability/);
    // 🔴 El puente de compatibilidad no puede volver a ser autoridad de runtime.
    assert.doesNotMatch(action, /resolveLushaSearchPlanForSector/);
    assert.doesNotMatch(action, /lusha-branch-plan-resolution/);
  });

  it('el paso final compara presupuesto por macro, no por sector', () => {
    const finalSearch = liveSource('finalSearch');
    assert.match(finalSearch, /input\.macroIndustryKey/);
    assert.doesNotMatch(finalSearch, /input\.sectorKey/);
  });

  it('el wizard sigue llamando al puente de criterios (no se quedó huérfano)', () => {
    assert.match(liveSource('wizard'), /resolveWizardLushaCriteria/);
    assert.match(liveSource('dryRoute'), /resolveWizardLushaCriteria/);
  });

  it('🔴 NINGÚN módulo de runtime importa el puente de compatibilidad', () => {
    // § 5 — la prueba de que la doble autoridad se retiró de verdad. El módulo
    // sigue existiendo (lo usan las suites que documentan el comportamiento
    // anterior), pero no tiene un solo consumidor ejecutable.
    const importers: string[] = [];
    for (const file of SOURCES) {
      if (file.endsWith('lusha-branch-plan-resolution.ts')) continue;
      if (stripComments(readFileSync(file, 'utf8')).includes('lusha-branch-plan-resolution')) {
        importers.push(path.relative(process.cwd(), file));
      }
    }
    assert.deepEqual(importers, [], `el puente legacy sigue vivo en: ${importers.join(', ')}`);
  });

  it('el vocabulario legacy sólo sobrevive en la superficie que nada monta', () => {
    // `LushaSectorKey` / `resolveLushaSectorOption` sólo pueden aparecer en el
    // mapper legacy, el puente de compatibilidad, el panel que nada monta, su
    // acción, y el núcleo de preview (donde es la rama de compatibilidad).
    const ALLOWED = new Set([
      'src/server/prospect-batches/lusha-sector-mapping.ts',
      'src/server/prospect-batches/lusha-branch-plan-resolution.ts',
      'src/server/prospect-batches/lusha-preview.ts',
      'src/server/prospect-batches/lusha-run-liability.ts',
      'src/components/prospect-batches/lusha-preview-drawer.tsx',
      'src/modules/prospect-batches/lusha-preview-actions.ts',
    ]);
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const relative = path.relative(process.cwd(), file);
      if (ALLOWED.has(relative)) continue;
      const body = stripComments(readFileSync(file, 'utf8'));
      if (/LushaSectorKey|resolveLushaSectorOption|getLushaSectorOptions/.test(body)) {
        offenders.push(relative);
      }
    }
    assert.deepEqual(offenders, [], `vocabulario legacy fuera de la lista: ${offenders.join(', ')}`);
  });

  it('el panel de preview legacy no tiene ningún sitio que lo monte', () => {
    // Es lo que hace que su `sectorKey` sea compatibilidad y no una ruta viva.
    const mounts: string[] = [];
    for (const file of SOURCES) {
      if (file.endsWith('lusha-preview-drawer.tsx')) continue;
      if (/<LushaPreviewPanel\b/.test(readFileSync(file, 'utf8'))) {
        mounts.push(path.relative(process.cwd(), file));
      }
    }
    assert.deepEqual(mounts, [], `LushaPreviewPanel se monta en: ${mounts.join(', ')}`);
  });
});

// ─── § 15/§ 16 · ejecutor y migración intactos ───────────────────────────────

describe('§§ 15/16 — el ejecutor de #302 se reutiliza y la M121 no se toca', () => {
  it('el cutover no reescribe el ejecutor multi-rama', () => {
    const executor = readFileSync(
      path.join(SRC_ROOT, 'server/prospect-batches/lusha-multibranch-execution.ts'),
      'utf8',
    );
    // Las piezas que #302 ya resolvió siguen siendo las que corren.
    for (const symbol of [
      'resolveLushaExecutionBranches',
      'resolveLushaProviderRequestsAllowed',
      'resolveLushaTargetGap',
      'decideLushaProviderRequest',
    ]) {
      assert.match(executor, new RegExp(`export function ${symbol}`), `falta ${symbol}`);
    }
  });

  it('la reserva y el techo de peticiones siguen siendo el MISMO producto', () => {
    // Propiedad de #302 que el cutover hereda: lo que se reserva y lo que se puede
    // gastar cambian a la vez.
    for (const row of APPROVED) {
      const plan = resolveLushaRoutedSearchPlan(row.macroKey);
      assert.ok(plan);
      assert.equal(estimateLushaRunCredits(plan), plan.branches.length * 2);
    }
  });
});

// ─── palabras de contraste ───────────────────────────────────────────────────

describe('palabras de contraste — derivadas, y nunca decisivas', () => {
  it('cada macro aporta las etiquetas de SUS ramas', () => {
    for (const row of APPROVED) {
      const keywords = resolveLushaMacroMatchKeywords(row.macroKey);
      const plan = resolveLushaRoutedSearchPlan(row.macroKey);
      assert.ok(plan);
      for (const branch of plan.branches) {
        assert.ok(
          keywords.includes(branch.label),
          `${row.macroKey} debe contrastar contra la etiqueta ${branch.label}`,
        );
      }
      assert.ok(keywords.length > 0);
    }
  });

  it('no arrastra términos de EXCLUSIÓN — invertirían el contraste', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const keywords = new Set(resolveLushaMacroMatchKeywords(definition.key));
      for (const excluded of definition.evidence.excludingIndustries) {
        assert.equal(
          keywords.has(excluded),
          false,
          `${definition.key} no debe contrastar contra el término excluyente ${excluded}`,
        );
      }
    }
  });

  it('no hay duplicados: el contraste no premia dos veces lo mismo', () => {
    for (const key of MACRO_INDUSTRY_KEYS) {
      const keywords = resolveLushaMacroMatchKeywords(key);
      assert.equal(new Set(keywords).size, keywords.length, `${key} repite palabras`);
    }
  });

  it('una macro fuera del catálogo no produce palabras', () => {
    assert.deepEqual(resolveLushaMacroMatchKeywords('education' as MacroIndustryKey), []);
  });
});

// ─── pureza ──────────────────────────────────────────────────────────────────

describe('la autoridad nueva es PURA', () => {
  it('no importa red, DB, env, proveedor ni `use server`', () => {
    const body = stripComments(
      readFileSync(path.join(SRC_ROOT, 'server/prospect-batches/lusha-macro-capability.ts'), 'utf8'),
    );
    for (const forbidden of [
      'use server',
      'process.env',
      'createClient',
      'supabase',
      'fetch(',
      'lusha-client',
      'lusha-connection',
      'feature-flags',
    ]) {
      assert.equal(
        body.includes(forbidden),
        false,
        `lusha-macro-capability no debe contener ${forbidden}`,
      );
    }
  });
});
