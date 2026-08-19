/**
 * lusha-branch-plan-resolution.ts — 🔴 PUENTE DE COMPATIBILIDAD. YA NO ES
 * AUTORIDAD DE ROUTING.
 *
 * AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 § 5.
 *
 * ── Qué era y por qué ya no lo es ─────────────────────────────────────────────
 *
 * El PR #302 lo construyó como puente TEMPORAL entre la elegibilidad legacy
 * (`LushaSectorKey`) y los planes Macro-v2, en un momento en el que la puerta de
 * entrada seguía siendo el sector. Su firma —entrada `LushaSectorKey`, no
 * `MacroIndustryKey`— era la garantía de que el catálogo no pudiera abrir rutas
 * nuevas: una macro sin sector equivalente no tenía forma de nombrarse.
 *
 * El cutover invierte esa relación. La autoridad es ahora
 * `resolveLushaMacroCapability`, indexada por `MacroIndustryKey` y derivada de la
 * membresía en el catálogo de planes, y el camino
 *
 *     MacroIndustryKey → sector legacy → MacroIndustryKey
 *
 * desapareció: era una ida y vuelta innecesaria y, peor, dos taxonomías capaces de
 * discrepar. Este módulo ya NO tiene ningún consumidor de runtime, y una prueba
 * estática del cutover lo vigila — si alguien vuelve a importarlo desde código de
 * producción, la suite se pone roja.
 *
 * ── Por qué se conserva en lugar de borrarse ──────────────────────────────────
 *
 * Sigue siendo la única descripción ejecutable de la correspondencia histórica
 * sector→macro, y las suites que documentan el comportamiento anterior lo usan
 * para probar que la traducción legacy sigue diciendo lo que decía. Borrarlo
 * perdería esa documentación viva sin ganar nada: no gasta, no decide y no puede
 * ser alcanzado desde el wizard.
 *
 * ── Educación: el `null` que NO es un hueco ───────────────────────────────────
 *
 * `education` es un sector Lusha vivo (main 6) y NO es una macro industria de
 * SellUp: la dueña lo decidió el 2026-08-13 y el catálogo lo prueba
 * (`education_is_not_a_sellup_macro`). Su `null` aquí no es un mapeo pendiente;
 * es esa decisión, y mapearlo a «Compañía de Servicios» —la tentación obvia—
 * sería reintroducir una decisión ya tomada. Tras el cutover Educación tampoco es
 * alcanzable por la ruta moderna: no es una `MacroIndustryKey`, así que la
 * capacidad la rechaza por construcción.
 *
 * Puro: sin env, sin I/O, sin cliente de proveedor, sin DB.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import {
  resolveLushaMacroSearchPlan,
  type LushaMacroSearchPlan,
} from './lusha-macro-search-plan';
import {
  resolveLushaSectorOption,
  type LushaSectorKey,
} from './lusha-sector-mapping';

/**
 * Sector legacy → macro industria, cuando existe la equivalencia.
 *
 * `Record` COMPLETO sobre `LushaSectorKey` a propósito: si alguien añade un
 * cuarto sector al catálogo legacy, TypeScript exige decidir aquí qué macro le
 * corresponde en lugar de dejar que caiga en un `undefined` silencioso.
 */
export const LUSHA_SECTOR_TO_MACRO_INDUSTRY: Readonly<
  Record<LushaSectorKey, MacroIndustryKey | null>
> = {
  // 🔑 Aquí está la ganancia real de este PR. El sector legacy `healthcare`
  // enviaba `main 11` a secas; el plan aprobado de `health_pharma` son TRES
  // ramas, porque Lusha cuelga farmacéuticas (12/71) y dispositivos médicos
  // (12/80) de Manufacturing, no de Healthcare. La ruta que ya estaba viva
  // recupera la mitad del nombre de la macro que antes perdía.
  healthcare: 'health_pharma',
  // Ver la cabecera: decisión de producto, no mapeo pendiente.
  education: null,
  // Coincidencia exacta: el plan de `technology` es UNA rama, main 17, que es el
  // mismo id que el sector legacy ya enviaba. Ejecutar su plan es equivalente a
  // la búsqueda de hoy, y su reserva sigue siendo 2.
  technology: 'technology',
};

/**
 * El plan Macro-v2 de un sector legacy, o `null` si no le corresponde ninguno.
 *
 * `null` = ejecutar como hoy (una búsqueda derivada del sector). NUNCA = bloquear.
 */
export function resolveLushaSearchPlanForSector(
  sectorKey: string | null | undefined,
): LushaMacroSearchPlan | null {
  // La autoridad legacy PRIMERO. Un sector que ella no reconoce no obtiene plan,
  // pase lo que pase en el mapa de abajo.
  const sector = resolveLushaSectorOption(sectorKey);
  if (!sector) return null;

  const macroKey = LUSHA_SECTOR_TO_MACRO_INDUSTRY[sector.key];
  if (!macroKey) return null;

  return resolveLushaMacroSearchPlan(macroKey);
}

/**
 * ¿Cuántas ramas ejecutaría este sector? 1 cuando no hay plan (la búsqueda
 * legacy única). Alimenta el techo de peticiones y la reserva.
 */
export function resolveLushaBranchCountForSector(
  sectorKey: string | null | undefined,
): number {
  return resolveLushaSearchPlanForSector(sectorKey)?.branches.length ?? 1;
}
