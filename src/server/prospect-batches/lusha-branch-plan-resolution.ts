/**
 * lusha-branch-plan-resolution.ts — el puente entre la ruta Lusha que HOY está
 * viva y los planes Macro-v2 aprobados.
 *
 * AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 §§ 2, 21, 22.
 *
 * ── El problema exacto ────────────────────────────────────────────────────────
 *
 * El catálogo del PR #299 está indexado por `MacroIndustryKey` (12 claves). La
 * elegibilidad de proveedor que hoy manda está indexada por `LushaSectorKey`
 * (`healthcare | education | technology`) y la decide
 * `resolveProspectDiscoveryProvider` a través de `resolveLushaSectorOption`. Son
 * dos vocabularios, y el ejecutor multi-rama necesita el primero mientras que la
 * puerta de entrada sigue siendo el segundo.
 *
 * ── 🔴 Este módulo NO ensancha la elegibilidad. No puede ──────────────────────
 *
 * La propiedad que hay que preservar (§ 21) es que este PR no convierta las 12
 * entradas del catálogo en 12 rutas Lusha. Aquí se preserva por CONSTRUCCIÓN, no
 * por convención:
 *
 *   · La entrada de `resolveLushaSearchPlanForSector` es un `LushaSectorKey`, no
 *     una `MacroIndustryKey`. Una macro que la autoridad legacy no admite no
 *     tiene forma de nombrarse: `energy_mining_environment` no es un sector, así
 *     que no hay argumento que se pueda pasar para que ejecute su plan.
 *   · Un sector desconocido devuelve `null`. La autoridad legacy ya lo habría
 *     rechazado antes; esto sólo se niega a inventar un plan por si algún día el
 *     orden cambiara.
 *   · Un sector admitido SIN macro equivalente devuelve `null`, y `null`
 *     significa «ejecuta como hoy» — una sola búsqueda derivada del sector. No
 *     significa «bloquea».
 *
 * Es decir: el catálogo puede AÑADIR ramas a una ruta que ya estaba viva, y no
 * puede abrir ninguna ruta nueva. El cableado 12/12 es el PR siguiente.
 *
 * ── Educación: el `null` que NO es un hueco ───────────────────────────────────
 *
 * `education` es un sector Lusha vivo (main 6) y NO es una macro industria de
 * SellUp: la dueña lo decidió el 2026-08-13 y el catálogo lo prueba
 * (`education_is_not_a_sellup_macro`). Su `null` aquí no es un mapeo pendiente;
 * es esa decisión, y mapearlo a «Compañía de Servicios» —la tentación obvia—
 * sería reintroducir una decisión ya tomada.
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
