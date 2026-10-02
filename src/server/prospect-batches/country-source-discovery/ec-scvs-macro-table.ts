/**
 * ec-scvs-macro-table.ts — qué macro industria corresponde a cada actividad del
 * directorio de compañías de la Superintendencia de Compañías (Ecuador), basado
 * en CIIU 4.0 del INEC (`C2410.25`: sección, división, grupo, clase, subclase).
 *
 * SOURCES-EC-FREE-DISCOVERY-1.
 *
 * ── 🔴 Misma tabla por división que Argentina ───────────────────────────────
 *
 * El CIIU del INEC sigue la CIIU Rev. 4: los dos dígitos tras la letra son la
 * división internacional, igual que en ARCA. Por eso la división se resuelve con
 * la tabla aprobada para Argentina (`AR_RNS_DIVISION_MACRO`, «tabla AR aprobada»,
 * 29-09-2026) y aquí sólo se añaden las subclases propias de Ecuador que la
 * división no distingue (medicamentos y equipo médico dentro de mayoristas y
 * minoristas → Salud). Cambiar cualquiera de las dos es una decisión de producto:
 * no se edita sin el visto bueno de la dueña.
 *
 * Reglas:
 *   - La subclase (`4649.22`) manda sobre su división.
 *   - Una división que no aparece NO tiene macro: la fuente gratuita nunca ofrece
 *     esas empresas (hoteles, restaurantes, medios, investigación, educación,
 *     cultura y asociaciones), igual que en Argentina.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { AR_RNS_DIVISION_MACRO } from './ar-rns-macro-table';

/** Versión de la tabla. */
export const EC_SCVS_MACRO_TABLE_VERSION = 'ec-ciiu4-inec-macro-v1' as const;

/** Subclase CIIU 4.0 del INEC (`GGGG.SS`) → macro. Manda sobre la división. */
export const EC_SCVS_SUBCLASS_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '4649.22': 'health_pharma', // venta al por mayor de productos farmacéuticos y medicinales
  '4649.24': 'health_pharma', // venta al por mayor de instrumentos y equipo médico, quirúrgico y dental
  '4772.01': 'health_pharma', // farmacias
  '4772.03': 'health_pharma', // venta al por menor de artículos médicos y ortopédicos
});

/** Código CIIU 4.0 del INEC: letra + 4 dígitos + punto + 2 dígitos. */
const EC_CIIU_N6 = /^([A-U])(\d{2})(\d{2})\.(\d{2})$/;

/** Código tal como llega (`' c2410.25 '`) → `C2410.25`, o `null` si no es un CIIU de 6 niveles. */
export function normalizeEcCiiuCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return EC_CIIU_N6.test(code) ? code : null;
}

/** Macro de UN código CIIU del INEC, o `null` si no tiene. */
export function resolveEcActivityMacro(raw: string | null | undefined): MacroIndustryKey | null {
  const code = normalizeEcCiiuCode(raw);
  if (code === null) return null;
  const match = EC_CIIU_N6.exec(code);
  if (match === null) return null;
  const [, , division, group, subclass] = match;
  return (
    EC_SCVS_SUBCLASS_MACRO[`${division}${group}.${subclass}`] ?? AR_RNS_DIVISION_MACRO[division] ?? null
  );
}

/** ¿Tiene esta macro alguna actividad ecuatoriana clasificada? */
export function macroHasEcCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (
    Object.values(AR_RNS_DIVISION_MACRO).includes(macroIndustryKey as MacroIndustryKey) ||
    Object.values(EC_SCVS_SUBCLASS_MACRO).includes(macroIndustryKey as MacroIndustryKey)
  );
}
