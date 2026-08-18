/**
 * lusha-macro-search-plan.ts — cómo se le pide a Lusha cada una de las 12 Macro
 * Industrias de SellUp.
 *
 * AGENT1-LUSHA-MACRO-V2-PLAN-CATALOG-1 §§ 1, 2, 3, 7.
 *
 * ── El problema que este contrato resuelve ────────────────────────────────────
 *
 * La forma obvia de mapear una macro industria a Lusha sería un array de ids:
 * `mainIndustriesIds: [13, 19, 14]`. Es incorrecta, y la razón es del proveedor,
 * no de estilo: `subIndustriesIds` se combina con `mainIndustriesIds` en **AND**.
 * Con un solo objeto de filtro es literalmente INEXPRESABLE
 *
 *     main 13  OR  main 19  OR  (main 14 AND sub 98)
 *
 * que es exactamente lo que «Gas / Petróleo / Energía / Minería / Medio
 * Ambiente» necesita: Medio Ambiente no es una industria principal de Lusha,
 * sólo existe como `Environmental Services` (98) colgando de Business Services
 * (14). Aplanarlo a `[13, 19, 14]` traería TODO Business Services —consultoras,
 * contabilidad, staffing— dentro de una macro de energía. Aplanarlo a
 * `{ mains: [13,19,14], subs: [98] }` haría el AND y devolvería sólo el 98,
 * perdiendo petróleo y utilities enteros.
 *
 * De ahí la RAMA como unidad: cada rama es UNA petición expresable, y la macro
 * industria es la unión de sus ramas. La unión se hace en nuestro lado, no en el
 * del proveedor.
 *
 * ── Invariantes que la forma del tipo ya impone ───────────────────────────────
 *
 * `mainIndustryId` es un número, no `number[]`; `subIndustryId` es opcional y
 * escalar. No es una preferencia de estilo: mientras no exista el ejecutor
 * multi-rama, un array dentro de una rama sería una promesa de OR que nadie
 * cumple. Lo que el tipo no puede impedir —que el id no exista, que el sub
 * cuelgue de otro padre, que falte una macro— lo prueba
 * `validateLushaMacroSearchPlanCatalog` contra la captura real del proveedor.
 *
 * ── 🔴 Este módulo NO está cableado, y eso es el punto ────────────────────────
 *
 * `resolveLushaMacroSearchPlan` NO es todavía la autoridad de elegibilidad de
 * proveedor. `LushaSectorKey`, el mapper de compatibilidad y el registry siguen
 * intactos y siguen mandando.
 *
 * La razón es de honestidad operativa: el ejecutor de hoy pagina UNA búsqueda
 * (`LUSHA_PENDING_REVIEW_MAX_PAGES`), no itera ramas. Si este catálogo mandara
 * ya, `energy_mining_environment` quedaría anunciada como soportada y se
 * ejecutaría como su PRIMERA rama solamente — devolvería petróleo y minería, y
 * callaría utilities y medio ambiente. Un fallo silencioso y sesgado es peor que
 * un `sector_not_mapped` ruidoso, porque el segundo se ve y el primero se
 * confunde con «Lusha no encontró más».
 *
 * El cableado pertenece al PR del ejecutor multi-rama. Hasta entonces esto es
 * una DECLARACIÓN probada, y la degradación sigue siendo la de hoy: fail-closed
 * a `default_ai`.
 *
 * Puro: sin env, sin I/O, sin cliente de proveedor, sin DB.
 */

import {
  MACRO_INDUSTRY_KEYS,
  MACRO_INDUSTRY_COUNT,
  type MacroIndustryKey,
} from '@/modules/macro-industry-catalog/macro-industries';
import {
  isKnownLushaMainIndustryId,
  isLushaSubIndustryOfMain,
  describeLushaBranchForObservability,
} from './lusha-industry-metadata';

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * Una petición expresable a Lusha: una industria principal, opcionalmente
 * estrechada por UNA sub-industria suya.
 *
 * `label` es observabilidad y nada más. El proveedor reescribe etiquetas
 * conservando el id (`Mental Health` → `Mental Health Care`, y cuatro casos
 * más en la misma captura), así que emparejar por texto se rompería en
 * silencio la próxima vez que redacten el catálogo. Los IDs mandan.
 */
export type LushaIndustryBranch = {
  /** Exactamente UNA industria principal. Nunca un array. */
  mainIndustryId: number;
  /** Cero o UNA sub-industria, que debe colgar de `mainIndustryId`. */
  subIndustryId?: number | null;
  /** Sólo para leer diffs y logs. Prohibido decidir con esto. */
  label: string;
};

/**
 * Cómo se busca una Macro Industria en Lusha: la UNIÓN de sus ramas.
 *
 * La clave es `MacroIndustryKey` —snake_case, estable, ASCII— y no el nombre
 * visible ni el slug publicado. § 4 del catálogo macro ya fijó esa regla: el
 * nombre visible lleva barras y acentos y el negocio querrá reescribirlo.
 */
export type LushaMacroSearchPlan = {
  macroKey: MacroIndustryKey;
  branches: readonly LushaIndustryBranch[];
};

/**
 * Techo de ramas por macro industria.
 *
 * No es una cifra estética: cada rama es una petición paginada, así que este
 * número multiplica el gasto máximo de una corrida
 * (`resolveLushaMacroPlanMaxProviderCredits`). Subirlo es subir el peor caso
 * económico, y por eso está aquí y se prueba, en vez de emerger de la lista.
 */
export const LUSHA_MACRO_SEARCH_PLAN_MAX_BRANCHES = 3;

/** Mínimo de ramas: una macro sin ramas no es un plan, es un hueco. */
export const LUSHA_MACRO_SEARCH_PLAN_MIN_BRANCHES = 1;

// ─── Los 12 planes aprobados ──────────────────────────────────────────────────

/**
 * Los 12 planes, en el orden canónico de `MACRO_INDUSTRY_KEYS`.
 *
 * Todos aprobados por la dueña (2026-08-18). Ninguna macro queda pendiente de
 * decisión de producto: las cuatro que antes lo estaban —`consumer_goods`,
 * `agroindustry`, `services_company` y `health_pharma`— tienen aquí su plan
 * definitivo.
 *
 * ── Por qué varias macro NO son un solo id ────────────────────────────────────
 *
 * Los desajustes son del vocabulario del proveedor, y están documentados rama a
 * rama abajo. Los tres patrones que se repiten:
 *
 *   · La macro de SellUp es MÁS ANCHA que cualquier main de Lusha
 *     (`health_pharma` incluye farmacéuticas y dispositivos médicos, que Lusha
 *     cuelga de Manufacturing, no de Healthcare).
 *   · El concepto no tiene main propio y sólo existe como sub
 *     (`Environmental Services`, `Facilities Services`).
 *   · La macro cruza el eje productor/vendedor que Lusha usa para partir
 *     (`consumer_goods` vive entre Manufacturing y Retail).
 *
 * ── 🔑 Una sub-industria puede aparecer en DOS macro ──────────────────────────
 *
 * `Food & Beverage` (76, bajo Manufacturing) está a propósito en `consumer_goods`
 * y en `agroindustry`. No es una fuga que haya que cerrar: las categorías del
 * proveedor son CUBETAS DE RECUPERACIÓN, no propiedad exclusiva de una macro de
 * SellUp. Una empresa de alimentos procesados es legítimamente candidata por las
 * dos vías, y quién se la queda lo decide la evidencia después de recuperarla
 * —`MACRO_INDUSTRIES[].evidence`—, no el filtro de búsqueda. Por eso NO existe
 * validación de exclusividad entre macros, y su ausencia es deliberada.
 */
export const LUSHA_MACRO_SEARCH_PLANS: readonly LushaMacroSearchPlan[] = [
  {
    macroKey: 'transport_logistics',
    branches: [
      // Coincidencia exacta: Lusha tiene un main dedicado.
      { mainIndustryId: 18, label: 'Transportation & Logistics' },
    ],
  },
  {
    macroKey: 'technology',
    branches: [
      // Coincidencia exacta. Es una de las dos macro que el mapper legacy ya
      // resolvía (la otra es salud, y sólo a medias).
      { mainIndustryId: 17, label: 'Technology, Information & Media' },
    ],
  },
  {
    macroKey: 'insurance_financial_services',
    branches: [
      // `Finance` (9) ya contiene banca, seguros y mercados de capitales como
      // sub-industrias suyas: no hace falta estrechar.
      { mainIndustryId: 9, label: 'Finance' },
    ],
  },
  {
    macroKey: 'health_pharma',
    branches: [
      // Prestación de salud.
      { mainIndustryId: 11, label: 'Healthcare' },
      // 🔴 Healthcare (11) NO contiene farmacéuticas. Lusha cuelga
      // `Pharmaceuticals Manufacturing` de Manufacturing (12). El mapeo
      // histórico a `[11]` a secas no era «casi correcto»: PERDÍA la mitad del
      // nombre de la macro.
      { mainIndustryId: 12, subIndustryId: 71, label: 'Pharmaceuticals Manufacturing' },
      // Dispositivos médicos, por la misma razón y el mismo padre.
      { mainIndustryId: 12, subIndustryId: 80, label: 'Medical Equipment' },
    ],
  },
  {
    macroKey: 'retail',
    branches: [
      // Coincidencia exacta; incluye mayoristas, que es lo que la macro espera.
      { mainIndustryId: 16, label: 'Retail & Wholesale Trade' },
    ],
  },
  {
    macroKey: 'property_construction',
    branches: [
      // Quien construye…
      { mainIndustryId: 3, label: 'Construction' },
      // …y quien desarrolla y opera el inmueble. Lusha los separa en dos mains;
      // la macro de SellUp los trata como un solo mercado.
      { mainIndustryId: 15, label: 'Real Estate' },
    ],
  },
  {
    macroKey: 'industry_manufacturing_chemicals_automotive',
    branches: [
      // Manufacturing (12) entero. Las sub que otras macro toman prestadas de
      // aquí (71, 80, 76, 70) siguen dentro: esta macro es el padre, y que una
      // farmacéutica sea también candidata de salud es reuso intencionado, no
      // solape a corregir.
      { mainIndustryId: 12, label: 'Manufacturing' },
    ],
  },
  {
    macroKey: 'government',
    branches: [
      // Coincidencia exacta.
      { mainIndustryId: 10, label: 'Government' },
    ],
  },
  {
    macroKey: 'energy_mining_environment',
    branches: [
      // Gas, petróleo y minería.
      { mainIndustryId: 13, label: 'Oil, Gas & Mining' },
      // Energía distribuida: Lusha la separa como Utilities.
      { mainIndustryId: 19, label: 'Utilities' },
      // 🔴 «Medio Ambiente» NO es main industry en Lusha. Sólo existe como sub
      // de Business Services (14). Ésta es la rama que hace imposible el array
      // plano: sin el AND con la 98, la macro se tragaría todo Business
      // Services.
      { mainIndustryId: 14, subIndustryId: 98, label: 'Environmental Services' },
    ],
  },
  {
    macroKey: 'consumer_goods',
    branches: [
      // Consumo masivo no tiene main propio. Se toma por el lado PRODUCTOR, que
      // es lo que distingue esta macro de `retail` (el vendedor).
      { mainIndustryId: 12, subIndustryId: 76, label: 'Food & Beverage' },
      { mainIndustryId: 12, subIndustryId: 70, label: 'Personal Care Products' },
    ],
  },
  {
    macroKey: 'services_company',
    branches: [
      // El grueso de servicios profesionales.
      { mainIndustryId: 14, label: 'Business Services' },
      // Facility management: Lusha lo cuelga de Real Estate (15), no de
      // Business Services, aunque el negocio sea de servicios.
      { mainIndustryId: 15, subIndustryId: 6, label: 'Facilities Services' },
      // Contabilidad y auditoría: colgadas de Finance (9). Sin esta rama se
      // irían con `insurance_financial_services`, que es otro negocio.
      { mainIndustryId: 9, subIndustryId: 92, label: 'Accounting & Services' },
    ],
  },
  {
    macroKey: 'agroindustry',
    branches: [
      // Producción primaria. Farming (8) trae UNA sola sub, así que el main
      // desnudo es todo lo que hay.
      { mainIndustryId: 8, label: 'Farming, Ranching, Forestry' },
      // 🔑 Agro-procesamiento. La MISMA sub 76 que usa `consumer_goods`, a
      // propósito. Ver la nota de reuso arriba.
      { mainIndustryId: 12, subIndustryId: 76, label: 'Food & Beverage' },
    ],
  },
] as const;

// ─── Resolución (declarativa: NADIE en runtime la llama todavía) ──────────────

/**
 * El plan de una macro industria, o `null` si no lo tiene.
 *
 * 🔴 NO es la autoridad de elegibilidad de proveedor. Ver la cabecera: mientras
 * el ejecutor sea de una sola rama, hacer que esto mande anunciaría soporte que
 * el sistema no puede cumplir. Una suite estática vigila que ningún módulo de
 * runtime importe este catálogo.
 */
export function resolveLushaMacroSearchPlan(
  macroKey: MacroIndustryKey,
): LushaMacroSearchPlan | null {
  return (
    LUSHA_MACRO_SEARCH_PLANS.find((plan) => plan.macroKey === macroKey) ?? null
  );
}

/** Las ramas de una macro industria, o `[]` si no tiene plan. */
export function resolveLushaMacroSearchBranches(
  macroKey: MacroIndustryKey,
): readonly LushaIndustryBranch[] {
  return resolveLushaMacroSearchPlan(macroKey)?.branches ?? [];
}

// ─── Validación ───────────────────────────────────────────────────────────────

/**
 * Todo lo que está mal en el catálogo, como lista de motivos legibles.
 *
 * Devuelve motivos en vez de lanzar para que una prueba pueda afirmar CUÁL es la
 * violación y no sólo que hubo alguna: «el catálogo es inválido» pasaría igual
 * de verde si el defecto fuera otro.
 *
 * Comprueba, en este orden:
 *
 *   1. cobertura exacta de las 12 macro (ni falta ni sobra ni se repite);
 *   2. Educación NO es una macro de SellUp — Lusha la devuelve (id 6 como main),
 *      pero la dueña la dejó fuera el 2026-08-13 y volver a colarla sería
 *      reintroducir una decisión ya tomada;
 *   3. número de ramas dentro de [1, 3];
 *   4. cada `mainIndustryId` existe en la captura del proveedor;
 *   5. cada `subIndustryId` cuelga de SU `mainIndustryId`;
 *   6. sin ramas duplicadas DENTRO de un plan (pedir dos veces lo mismo es
 *      pagar dos veces).
 *
 * Lo que deliberadamente NO comprueba: exclusividad de una rama entre macros.
 * Ver la nota de reuso de la sub 76.
 */
export function validateLushaMacroSearchPlanCatalog(
  plans: readonly LushaMacroSearchPlan[] = LUSHA_MACRO_SEARCH_PLANS,
): string[] {
  const violations: string[] = [];

  // 1. Cobertura exacta.
  const seenKeys = new Set<string>();
  for (const plan of plans) {
    if (seenKeys.has(plan.macroKey)) {
      violations.push(`duplicate_macro_plan: ${plan.macroKey}`);
    }
    seenKeys.add(plan.macroKey);
    if (!(MACRO_INDUSTRY_KEYS as readonly string[]).includes(plan.macroKey)) {
      violations.push(`unknown_macro_key: ${plan.macroKey}`);
    }
  }
  for (const key of MACRO_INDUSTRY_KEYS) {
    if (!seenKeys.has(key)) violations.push(`missing_macro_plan: ${key}`);
  }
  if (plans.length !== MACRO_INDUSTRY_COUNT) {
    violations.push(
      `macro_plan_count_mismatch: expected=${MACRO_INDUSTRY_COUNT} actual=${plans.length}`,
    );
  }

  // 2. Educación fuera.
  if (seenKeys.has('education')) {
    violations.push('education_is_not_a_sellup_macro');
  }

  for (const plan of plans) {
    const branchCount = plan.branches.length;

    // 3. Ramas dentro del rango.
    if (branchCount < LUSHA_MACRO_SEARCH_PLAN_MIN_BRANCHES) {
      violations.push(`empty_plan: ${plan.macroKey}`);
    }
    if (branchCount > LUSHA_MACRO_SEARCH_PLAN_MAX_BRANCHES) {
      violations.push(
        `too_many_branches: ${plan.macroKey} branches=${branchCount} max=${LUSHA_MACRO_SEARCH_PLAN_MAX_BRANCHES}`,
      );
    }

    const seenBranches = new Set<string>();
    for (const branch of plan.branches) {
      const subId = branch.subIndustryId ?? null;

      // 4. Main autoritativo.
      if (!isKnownLushaMainIndustryId(branch.mainIndustryId)) {
        violations.push(
          `unknown_main_industry_id: ${plan.macroKey} main=${branch.mainIndustryId}`,
        );
      }

      // 5. Sub emparejada con SU main.
      if (subId !== null && !isLushaSubIndustryOfMain(branch.mainIndustryId, subId)) {
        violations.push(
          `sub_industry_not_under_main: ${plan.macroKey} main=${branch.mainIndustryId} sub=${subId}`,
        );
      }

      // 6. Rama repetida dentro del plan.
      const fingerprint = `${branch.mainIndustryId}:${subId ?? '-'}`;
      if (seenBranches.has(fingerprint)) {
        violations.push(
          `duplicate_branch_in_plan: ${plan.macroKey} branch=${fingerprint}`,
        );
      }
      seenBranches.add(fingerprint);
    }
  }

  return violations;
}

/** Igual que la validación, pero ruidosa. Para arranques y ratchets. */
export function assertLushaMacroSearchPlanCatalogValid(
  plans: readonly LushaMacroSearchPlan[] = LUSHA_MACRO_SEARCH_PLANS,
): void {
  const violations = validateLushaMacroSearchPlanCatalog(plans);
  if (violations.length > 0) {
    throw new Error(
      `lusha_macro_search_plan_catalog_invalid: ${violations.join('; ')}`,
    );
  }
}

/** Cuántas ramas tiene la macro más compuesta del catálogo. */
export function resolveLushaMacroSearchPlanMaxBranchCount(
  plans: readonly LushaMacroSearchPlan[] = LUSHA_MACRO_SEARCH_PLANS,
): number {
  return plans.reduce((max, plan) => Math.max(max, plan.branches.length), 0);
}

/** Cada rama descrita con las etiquetas capturadas. Diagnóstico, no decisión. */
export function describeLushaMacroSearchPlan(plan: LushaMacroSearchPlan): string {
  const branches = plan.branches
    .map((branch) =>
      describeLushaBranchForObservability(branch.mainIndustryId, branch.subIndustryId),
    )
    .join(' | ');
  return `${plan.macroKey}: ${branches}`;
}
