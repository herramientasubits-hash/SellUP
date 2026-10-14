/**
 * macro-industry-sector-label.ts — el texto de la columna «Sector» de la ficha.
 *
 * AGENT1-FREE-LAYER-SECTOR-IS-MACRO-1 — «Sector» muestra la industria del lote en
 * español («Salud & Farmacéuticos»), venga la empresa de una fuente oficial, de
 * Tavily, de Apollo o de Lusha. Sólo PRESENTACIÓN: nunca se usa para emparejar
 * empresas ni para decidir pertenencia a una industria.
 *
 * Puro: sin env, sin I/O.
 */

import { getMacroIndustryByKey } from './macro-industries';

/** Nombre visible de la macro industria, o `null` si la clave no existe. */
export function macroIndustrySectorLabel(key: string | null | undefined): string | null {
  return getMacroIndustryByKey(key)?.displayName ?? null;
}
