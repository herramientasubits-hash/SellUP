/**
 * cl-sii-macro-table.ts — qué macro industria corresponde a cada actividad
 * económica del SII de Chile (CIIU4.CL 2012, 6 dígitos: `620200`).
 *
 * SOURCES-CL-SII-FREE-DISCOVERY-1. Tabla aprobada por la dueña el 05-10-2026
 * («tabla CL aprobada» + «lista aprobada»). Cambiarla es una decisión de
 * producto: no se edita sin su visto bueno.
 *
 * ── 🔴 Misma tabla por división que Argentina y Ecuador ─────────────────────
 *
 * Los dos primeros dígitos del código chileno son la división de la CIIU Rev. 4,
 * así que la división se resuelve con la tabla aprobada para Argentina
 * (`AR_RNS_DIVISION_MACRO`). Lo propio de Chile:
 *
 *   - División 04 «Extracción y procesamiento de cobre»: no existe en la CIIU
 *     internacional (Codelco, por ejemplo) → Energía, minería y medio ambiente.
 *   - Actividades de comercio que son Salud (como en Ecuador): mayoristas de
 *     medicamentos y de instrumental médico, farmacias y ortopedias.
 *   - Actividades de comercio que son Tecnología (como Argentina v2, «sí» de la
 *     dueña 05-10-2026): mayoristas de informática y de equipo de
 *     telecomunicaciones, y tiendas de informática (en la práctica integradores).
 *   - 643000 «Fondos y sociedades de inversión»: suele ser el holding de un grupo
 *     de otra industria (Falabella, Cencosud, Enel…). Sin industria, salvo las
 *     empresas revisadas a mano una por una (`CL_SII_HOLDING_MACRO_BY_RUT`).
 *   - Una división que no aparece NO tiene macro y la fuente gratuita nunca ofrece
 *     esas empresas: hoteles y restaurantes, medios, investigación, veterinaria,
 *     educación (el asistente no tiene industria «Educación»), cultura, deporte y
 *     asociaciones.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { AR_RNS_DIVISION_MACRO } from './ar-rns-macro-table';

/** Versión de la tabla. */
export const CL_SII_MACRO_TABLE_VERSION = 'cl-ciiu4cl-sii-macro-v1' as const;

const ENERGY = 'energy_mining_environment' as const;

/** División (2 dígitos) → macro: la de Argentina + el cobre chileno. */
export const CL_SII_DIVISION_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  ...AR_RNS_DIVISION_MACRO,
  '04': ENERGY, // extracción y procesamiento de cobre (propia de Chile)
});

/** Actividad (6 dígitos) → macro. Manda sobre la división. */
export const CL_SII_ACTIVITY_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '464907': 'health_pharma', // venta al por mayor de productos farmacéuticos y medicinales
  '464908': 'health_pharma', // venta al por mayor de instrumentos científicos y quirúrgicos
  '477201': 'health_pharma', // farmacias
  '477202': 'health_pharma', // venta al por menor de artículos ortopédicos
  '465100': 'technology', // venta al por mayor de computadores, equipo periférico y programas informáticos
  '465200': 'technology', // venta al por mayor de equipo, partes y piezas electrónicos y de telecomunicaciones
  '474100': 'technology', // venta al por menor de computadores, equipo periférico, programas y equipo de telecom.
});

/** Fondos y sociedades de inversión: sin industria salvo revisión a mano. */
export const CL_SII_HOLDING_ACTIVITY = '643000' as const;

/**
 * Empresas con actividad 643000 revisadas a mano (05-10-2026, 100+ trabajadores):
 * RUT → su industria real. Las que no se sabe a qué se dedican no están aquí y
 * quedan sin industria (Operaciones Integrales Coquimbo, Sinergy Inversiones,
 * Inversiones Vista Norte, Back Office South America, Degasa Holding, Atlas
 * Development, Inversiones Bosquemar, Grupo Lagos).
 */
export const CL_SII_HOLDING_MACRO_BY_RUT: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '77261280-K': 'retail', // FALABELLA RETAIL S.A.
  '90749000-9': 'retail', // FALABELLA S.A.
  '93834000-5': 'retail', // CENCOSUD S A
  '76012676-4': 'retail', // SMU S.A.
  '96947020-9': 'retail', // EMPRESAS HITES S A
  '76536353-5': ENERGY, // ENEL CHILE S.A.
  '76328210-4': ENERGY, // STATKRAFT CHILE INVERSIONES ELECTRICAS LIMITADA
  '96752730-0': ENERGY, // VEOLIA HOLDING CHILE S.A.
  '76391966-8': ENERGY, // STRACON CHILE SPA (servicios mineros)
  '76020458-7': 'health_pharma', // EMPRESAS RED SALUD S.A.
  '76005001-6': 'health_pharma', // BUPA CHILE S.A.
  '76960156-2': 'health_pharma', // SENIOR GESTION DE ENFERMERIA LAS ENCINAS SPA
  '76600628-0': 'industry_manufacturing_chemicals_automotive', // CMPC CELULOSA S.A.
  '76034238-6': 'property_construction', // SERVICIOS MALLPLAZA SPA
  '76245723-7': 'property_construction', // INMOBILIARIA ARMAS COPAYAPU SPA
  '76002201-2': 'transport_logistics', // HANSEATIC GLOBAL TERMINALS LATIN AMERICA S.A.
  '76364071-K': 'agroindustry', // NS AGRO S.A.
  '70017860-9': 'insurance_financial_services', // COOP DE AHORRO Y CREDITO EL DETALLISTA LTDA
  '65144029-7': 'insurance_financial_services', // COOPERATIVA DE AHORRO Y CREDITO BANCRECE
  '96861280-8': 'insurance_financial_services', // EUROCAPITAL S.A
  '96530900-4': 'insurance_financial_services', // BCI ASSET MANAGEMENT AGF S.A.
  '77750920-9': 'insurance_financial_services', // ZURICH CHILE ASSET MANAGEMENT AGF S.A.
  '94050000-1': 'insurance_financial_services', // GENERAL MOTORS FINANCIAL CHILE S.A.
  '76257904-9': 'insurance_financial_services', // CAPITARIA LATAM SPA
  '96781350-8': 'insurance_financial_services', // EDENRED CHILE SOCIEDAD ANONIMA
});

/**
 * Empresas cuyo registro en el SII no refleja lo que hacen, revisadas a mano:
 * RUT → su industria real, con CUALQUIER código de actividad. Manda sobre todo
 * lo demás. Cada alta es decisión de la dueña.
 *
 * - Correos de Chile: el SII la registra como «otras actividades de
 *   telecomunicaciones» (619090) y salía 1.ª en Tecnología (dueña, 06-10-2026).
 */
export const CL_SII_MACRO_OVERRIDE_BY_RUT: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '60503000-9': 'transport_logistics', // EMPRESA DE CORREOS DE CHILE
});

/** Código tal como llega → 6 dígitos, o `null`. */
export function normalizeClActivityCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  return /^\d{6}$/.test(code) ? code : null;
}

/**
 * Macro de UNA empresa del SII: primero las correcciones a mano por RUT, luego
 * su código de actividad (la 643000, sólo por RUT), o `null` si no tiene.
 */
export function resolveClActivityMacro(
  rawCode: string | null | undefined,
  rut?: string | null,
): MacroIndustryKey | null {
  const code = normalizeClActivityCode(rawCode);
  if (code === null) return null;
  const key = typeof rut === 'string' ? rut.trim().toUpperCase() : '';
  const override = CL_SII_MACRO_OVERRIDE_BY_RUT[key];
  if (override !== undefined) return override;
  if (code === CL_SII_HOLDING_ACTIVITY) return CL_SII_HOLDING_MACRO_BY_RUT[key] ?? null;
  return CL_SII_ACTIVITY_MACRO[code] ?? CL_SII_DIVISION_MACRO[code.slice(0, 2)] ?? null;
}

/** ¿Tiene esta macro alguna actividad chilena clasificada? */
export function macroHasClCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (
    Object.values(CL_SII_DIVISION_MACRO).includes(macroIndustryKey as MacroIndustryKey) ||
    Object.values(CL_SII_ACTIVITY_MACRO).includes(macroIndustryKey as MacroIndustryKey)
  );
}
