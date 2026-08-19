/**
 * lusha-macro-capability.ts — la ÚNICA autoridad moderna de elegibilidad Lusha.
 *
 * AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 §§ 2, 3, 4, 6, 7, 19.
 *
 * ── Qué cambia respecto al estado anterior ────────────────────────────────────
 *
 * Hasta el PR #302 la elegibilidad la decidía `LushaSectorKey`
 * (`healthcare | education | technology`) a través de `resolveLushaSectorOption`,
 * y el catálogo Macro-v2 sólo podía AÑADIR ramas a una ruta que el sector ya
 * hubiera abierto. Eso dejaba tres consecuencias que este módulo cierra:
 *
 *   · nueve macro industrias aprobadas —con plan válido y presupuesto
 *     calculable— no tenían ninguna forma de nombrarse ante el proveedor;
 *   · `education`, que la dueña dejó FUERA de las 12 el 2026-08-13, seguía
 *     siendo una ruta Lusha viva porque el vocabulario legacy la contiene;
 *   · el camino era `MacroIndustryKey → nombre visible → alias difusos →
 *     sector → macro otra vez`, o sea dos taxonomías capaces de discrepar.
 *
 * Aquí la autoridad pasa a ser la MEMBRESÍA EN EL CATÁLOGO: una macro industria
 * es Lusha-capaz si —y sólo si— su plan canónico existe.
 *
 * ── 🔴 Por qué NO hay una segunda lista de 12 (§ 2) ───────────────────────────
 *
 * `LUSHA_ROUTABLE_MACRO_KEYS` se DERIVA de `LUSHA_MACRO_SEARCH_PLANS`. No es una
 * preferencia de estilo: una constante escrita a mano sería un segundo censo de
 * rutas capaz de quedarse corto —o largo— la próxima vez que el catálogo cambie,
 * y el modo de fallo sería silencioso en las dos direcciones (una macro con plan
 * que nadie puede pedir, o una ruta anunciada sin plan que la respalde). Al
 * derivarla, la única forma de añadir o quitar una ruta es añadir o quitar un
 * plan, y `assertLushaRoutingCompleteness` lo vuelve un fallo ruidoso si algún
 * día dejaran de coincidir.
 *
 * ── 🔴 Educación NO es la ruta decimotercera (§ 4) ────────────────────────────
 *
 * Lusha publica Educación (main 6) y la metadata la trae; SellUp NO la incluye en
 * sus 12 macro industrias. Aquí queda fuera POR CONSTRUCCIÓN, no por una lista de
 * exclusión que alguien pudiera editar: la puerta de entrada es
 * `isMacroIndustryKey`, y `'education'` no es una `MacroIndustryKey`. No se mapea
 * a `services_company` ni a ninguna otra —esa es exactamente la tentación que la
 * decisión de la dueña ya descartó— y tampoco existe un alias que la reintroduzca.
 *
 * ── Qué NO decide este módulo ─────────────────────────────────────────────────
 *
 * La CAPACIDAD no es permiso de ejecución. `ENABLE_LUSHA_PREVIEW` sigue siendo la
 * puerta operativa y sigue fail-closed: con el flag apagado ninguna de las 12
 * rutas resuelve credencial, reserva, cliente ni petición. Este módulo sólo
 * responde «¿esta macro industria se puede pedir a Lusha, y con qué plan?».
 *
 * Puro: sin env, sin I/O, sin cliente de proveedor, sin DB.
 */

import {
  MACRO_INDUSTRIES,
  isMacroIndustryKey,
  type MacroIndustryKey,
} from '@/modules/macro-industry-catalog/macro-industries';
import {
  LUSHA_MACRO_SEARCH_PLANS,
  resolveLushaMacroSearchPlan,
  type LushaMacroSearchPlan,
} from './lusha-macro-search-plan';

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * Todo lo que la ruta moderna necesita saber de una macro industria Lusha-capaz.
 *
 * Se devuelve como UN objeto en lugar de tres funciones sueltas para que sea
 * imposible que el plan, el techo y las palabras de contraste salgan de
 * resoluciones distintas: quien tiene la capacidad tiene las tres coherentes.
 */
export type LushaMacroCapability = {
  macroKey: MacroIndustryKey;
  /** Nombre visible del catálogo macro. Presentación, jamás decisión. */
  label: string;
  /** El plan canónico. Es la MISMA referencia que el catálogo publica. */
  plan: LushaMacroSearchPlan;
  /** `plan.branches.length`. Del plan, nunca de una tabla aparte. */
  branchCount: number;
  /**
   * Palabras con las que el gate de calidad contrasta la industria DECLARADA por
   * el proveedor. Ver `resolveLushaMacroMatchKeywords`.
   */
  matchKeywords: string[];
};

// ─── El censo de rutas, derivado ──────────────────────────────────────────────

/**
 * Las macro industrias que la ruta moderna puede pedir a Lusha.
 *
 * Derivada del catálogo de planes y filtrada por `isMacroIndustryKey`: un plan
 * cuya clave no fuera canónica no abriría ruta, así que el censo no puede
 * anunciar nada que el catálogo macro no reconozca.
 */
export const LUSHA_ROUTABLE_MACRO_KEYS: readonly MacroIndustryKey[] = Object.freeze(
  LUSHA_MACRO_SEARCH_PLANS.map((plan) => plan.macroKey).filter((key): key is MacroIndustryKey =>
    isMacroIndustryKey(key),
  ),
);

/**
 * § 19 — completitud del catálogo ES completitud de routing, y al revés.
 *
 * Devuelve los motivos en vez de lanzar para que una prueba pueda afirmar CUÁL es
 * la divergencia. Si el catálogo gana o pierde una macro en el futuro, esto
 * obliga a una decisión explícita en lugar de dejar que las dos listas se separen
 * en silencio.
 */
export function validateLushaRoutingCompleteness(): string[] {
  const violations: string[] = [];
  const planKeys = new Set<string>(LUSHA_MACRO_SEARCH_PLANS.map((plan) => plan.macroKey));
  const routable = new Set<string>(LUSHA_ROUTABLE_MACRO_KEYS);

  for (const key of planKeys) {
    if (!routable.has(key)) violations.push(`plan_without_route: ${key}`);
  }
  for (const key of routable) {
    if (!planKeys.has(key)) violations.push(`route_without_plan: ${key}`);
  }
  // Educación tiene main propio en Lusha y NO es macro de SellUp. Que no esté
  // entre las rutas es la decisión de producto, y aquí queda comprobada.
  if (routable.has('education')) violations.push('education_is_not_a_routable_macro');

  return violations;
}

/** Igual, pero ruidoso. Para ratchets y arranques. */
export function assertLushaRoutingCompleteness(): void {
  const violations = validateLushaRoutingCompleteness();
  if (violations.length > 0) {
    throw new Error(`lusha_routing_completeness_invalid: ${violations.join('; ')}`);
  }
}

// ─── Palabras de contraste ────────────────────────────────────────────────────

/**
 * Con qué palabras se contrasta la industria que el proveedor DECLARA.
 *
 * Tres fuentes, en orden de señal:
 *
 *   1. las etiquetas de las ramas del plan — que son literalmente el vocabulario
 *      de Lusha (`Healthcare`, `Manufacturing`, `Environmental Services`), así
 *      que son lo que el proveedor devolverá en el campo `industry`;
 *   2. `evidence.confirming` del catálogo macro — términos que PRUEBAN
 *      pertenencia y que ya se evalúan sólo contra campos declarados;
 *   3. `evidence.parentIndustries` — industrias del padre, que CONTIENEN a la
 *      macro sin demostrarla, y que aquí valen porque este contraste no admite
 *      nada: sólo evita restar 20 puntos a una empresa que sí encaja.
 *
 * 🔴 Deliberadamente NO se usan `discovery.*` ni `evidence.excludingIndustries`.
 * Los términos de descubrimiento están redactados para PEDIR al proveedor (y los
 * amplios ganarían el contraste sin discriminar); los de exclusión afirman lo
 * contrario de lo que aquí se mide, y meterlos convertiría un fallo de encaje en
 * un acierto.
 *
 * Lo que este contraste NO puede hacer: rechazar una empresa. Un desencaje de
 * industria resta 20 sobre 100 y el umbral son 70, así que por sí solo nunca tumba
 * a nadie — lo decisivo siguen siendo dominio y país.
 */
export function resolveLushaMacroMatchKeywords(macroKey: MacroIndustryKey): string[] {
  const plan = resolveLushaMacroSearchPlan(macroKey);
  const definition = MACRO_INDUSTRIES.find((entry) => entry.key === macroKey) ?? null;

  const keywords = new Set<string>();
  for (const branch of plan?.branches ?? []) keywords.add(branch.label);
  for (const term of definition?.evidence.confirming ?? []) keywords.add(term);
  for (const term of definition?.evidence.parentIndustries ?? []) keywords.add(term);

  return [...keywords];
}

// ─── Resolución (LA autoridad) ────────────────────────────────────────────────

/**
 * La capacidad Lusha de una macro industria, o `null` si no la tiene.
 *
 * § 7 — FAIL-CLOSED en cada puerta, y en este orden:
 *
 *   1. valor ausente / no cadena  → `null`;
 *   2. no es `MacroIndustryKey`   → `null` (aquí muere `education`, `random`,
 *      la cadena vacía y cualquier slug de subindustria antiguo);
 *   3. es macro pero SIN plan     → `null`, porque anunciar una ruta cuyo plan no
 *      existe dejaría al servidor sin poder calcular su reserva (§ 12).
 *
 * Ninguna de las tres degrada a otra cosa: `null` significa «no hay ruta Lusha»,
 * y el llamador lo traduce a la ruta normal de Agente 1, nunca a un bloqueo.
 */
export function resolveLushaMacroCapability(
  macroKey: string | null | undefined,
): LushaMacroCapability | null {
  if (typeof macroKey !== 'string') return null;
  const trimmed = macroKey.trim();
  if (trimmed.length === 0) return null;
  if (!isMacroIndustryKey(trimmed)) return null;

  const plan = resolveLushaMacroSearchPlan(trimmed);
  if (!plan) return null;

  const definition = MACRO_INDUSTRIES.find((entry) => entry.key === trimmed) ?? null;
  if (!definition) return null;

  return {
    macroKey: trimmed,
    label: definition.displayName,
    plan,
    branchCount: plan.branches.length,
    matchKeywords: resolveLushaMacroMatchKeywords(trimmed),
  };
}

/** ¿Puede la ruta moderna pedir esta macro industria a Lusha? */
export function isLushaMacroRoutable(macroKey: string | null | undefined): boolean {
  return resolveLushaMacroCapability(macroKey) !== null;
}

/**
 * El plan Macro-v2 de una macro industria admitida, o `null`.
 *
 * Existe para que los llamadores de runtime no tengan que importar el catálogo de
 * planes directamente: la autoridad de elegibilidad y la resolución del plan son
 * la MISMA puerta, así que no puede haber un plan sin ruta ni una ruta sin plan.
 */
export function resolveLushaRoutedSearchPlan(
  macroKey: string | null | undefined,
): LushaMacroSearchPlan | null {
  return resolveLushaMacroCapability(macroKey)?.plan ?? null;
}

/**
 * ¿Cuántas ramas ejecutaría esta macro industria? `null` cuando no hay ruta.
 *
 * `null` y no 1: un `1` para una macro inexistente sería un techo de gasto
 * inventado para una ruta que no existe.
 */
export function resolveLushaRoutedBranchCount(
  macroKey: string | null | undefined,
): number | null {
  return resolveLushaMacroCapability(macroKey)?.branchCount ?? null;
}
