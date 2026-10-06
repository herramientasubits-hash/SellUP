/**
 * pe-sunat-macro-table.ts — qué macro industria corresponde a cada actividad del
 * Padrón RUC de SUNAT (Perú), basado en la clase CIIU Rev. 4 (4 dígitos).
 *
 * SOURCES-PE-FREE-DISCOVERY-1.
 *
 * ── 🔴 Misma tabla por división que Argentina y Ecuador ─────────────────────
 *
 * SUNAT publica la CIIU Rev. 4 internacional (el texto se traduce a su clase en
 * `pe-sunat-ciiu4-activity-catalog.ts`). La división se resuelve con la tabla
 * aprobada para Argentina (`AR_RNS_DIVISION_MACRO`, «tabla AR aprobada»,
 * 29-09-2026), y aquí sólo se añaden las clases que la división no distingue y que
 * Argentina ya movió en su v2 (aprobada el 05-10-2026):
 *
 *   - 4651 venta al por mayor de ordenadores y programas, 4652 de equipo
 *     electrónico y de telecomunicaciones, 4741 venta al por menor de ordenadores
 *     → Tecnología (en la práctica, integradores).
 *   - 4772 farmacias y venta al por menor de productos médicos → Salud.
 *
 * A diferencia de ARCA, la CIIU internacional NO separa a los mayoristas de
 * medicamentos (van dentro de 4649, «otros enseres domésticos»): se quedan en
 * Retail. Cambiar esta tabla es una decisión de producto: no se edita sin el visto
 * bueno de la dueña.
 *
 * Reglas:
 *   - La clase manda sobre su división.
 *   - Una división que no aparece NO tiene macro: la fuente gratuita nunca ofrece
 *     esas empresas (hoteles, restaurantes, medios, educación, cultura,
 *     asociaciones), igual que en Argentina y Ecuador.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { AR_RNS_DIVISION_MACRO } from './ar-rns-macro-table';

/** Versión de la tabla. */
export const PE_SUNAT_MACRO_TABLE_VERSION = 'pe-ciiu4-sunat-macro-v1' as const;

/** Clase CIIU Rev. 4 → macro. Manda sobre la división. */
export const PE_SUNAT_CLASS_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '4651': 'technology', // venta al por mayor de ordenadores, equipo periférico y programas
  '4652': 'technology', // venta al por mayor de equipo y partes electrónicos y de telecomunicaciones
  '4741': 'technology', // venta al por menor de ordenadores, equipo periférico y programas
  '4772': 'health_pharma', // venta al por menor de productos farmacéuticos y médicos
});

/** Clase CIIU Rev. 4 tal como llega → 4 dígitos, o `null`. */
export function normalizePeCiiu4Code(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  return /^\d{4}$/.test(code) ? code : null;
}

/** Macro de UNA clase CIIU Rev. 4, o `null` si no tiene. */
export function resolvePeActivityMacro(raw: string | null | undefined): MacroIndustryKey | null {
  const code = normalizePeCiiu4Code(raw);
  if (code === null) return null;
  return PE_SUNAT_CLASS_MACRO[code] ?? AR_RNS_DIVISION_MACRO[code.slice(0, 2)] ?? null;
}

/** ¿Tiene esta macro alguna actividad peruana clasificada? */
export function macroHasPeCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (
    Object.values(AR_RNS_DIVISION_MACRO).includes(macroIndustryKey as MacroIndustryKey) ||
    Object.values(PE_SUNAT_CLASS_MACRO).includes(macroIndustryKey as MacroIndustryKey)
  );
}
