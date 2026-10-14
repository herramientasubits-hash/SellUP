/**
 * us-free-directory-macro-table.ts — qué macro industria corresponde a cada
 * organización del buscador gratuito de Estados Unidos.
 *
 * SOURCES-US-CLOSE-1 — tabla aprobada por la dueña el 14-10-2026.
 *
 * ── Dos clasificaciones oficiales ───────────────────────────────────────────
 *
 *   - IRS Exempt Organizations BMF → código NTEE (letra = grupo mayor). Sólo
 *     entran las de ingresos ≥ US$ 25 M (≈ 200+ empleados).
 *   - SEC EDGAR → código SIC (los dos primeros dígitos = grupo mayor). Los
 *     cascarones (SIC 67 «blank checks» y holdings, 61 titulizaciones) nunca se
 *     ofrecen: casi nunca son la empresa operativa.
 *
 * No existe macro de educación: las universidades y colegios privados (NTEE B)
 * van a «Servicios a empresas», igual que los servicios humanos y el empleo.
 *
 * ── Fuera del buscador gratuito ─────────────────────────────────────────────
 *
 * Subsecciones 501(c)(5) sindicatos, (c)(7) clubes sociales y (c)(9) fideicomisos
 * de salud de empleados (VEBA): no son la organización que compra. Con NTEE
 * vacío sólo entran las cooperativas eléctricas (subsección 12 con «electric»,
 * «power» o «energy» en el nombre) → Energía. Siguen en el registro para el EIN
 * por nombre; sólo no se ofrecen en el buscador.
 *
 * Cambiar esta tabla es una decisión de producto: no se edita sin el visto bueno
 * de la dueña.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

/** Versión de la tabla. */
export const US_FREE_DIRECTORY_MACRO_TABLE_VERSION = 'us-ntee-sic-macro-v1' as const;

/** Ingresos mínimos (USD) de una organización del IRS para ofrecerla en el buscador. */
export const US_IRS_DISCOVERY_MIN_REVENUE_USD = 25_000_000;

/** Grupo mayor NTEE (letra) → macro. Una letra que no aparece no tiene macro. */
export const US_NTEE_MAJOR_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  E: 'health_pharma', // salud: hospitales, clínicas, atención primaria
  F: 'health_pharma', // salud mental
  G: 'health_pharma', // enfermedades y trastornos
  H: 'health_pharma', // investigación médica
  B: 'services_company', // educación (no hay macro de educación)
  J: 'services_company', // empleo
  L: 'services_company', // vivienda
  P: 'services_company', // servicios humanos
  S: 'services_company', // desarrollo comunitario
  W: 'services_company', // bienestar público
  C: 'energy_mining_environment', // ambiente
  K: 'agroindustry', // alimentos y agricultura
});

/** Subsecciones 501(c) que nunca se ofrecen (sindicatos, clubes, VEBA). */
export const US_IRS_DISCOVERY_EXCLUDED_SUBSECTIONS: ReadonlySet<string> = new Set(['05', '07', '09']);

const ELECTRIC_COOP_NAME = /\b(ELECTRIC|ELEC|POWER|ENERGY)\b/;

/** Grupo mayor SIC (dos dígitos) → macro. */
export const US_SIC_MAJOR_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '35': 'technology', // maquinaria industrial y equipo de cómputo
  '36': 'technology', // equipo electrónico
  '48': 'technology', // comunicaciones
  '73': 'technology', // servicios a empresas (software, procesamiento de datos)
  '28': 'health_pharma', // químicos y farmacéuticos (domina la farma)
  '38': 'health_pharma', // instrumentos médicos y de medición
  '80': 'health_pharma', // servicios de salud
  '87': 'health_pharma', // investigación e ingeniería
  '60': 'insurance_financial_services', // bancos
  '62': 'insurance_financial_services', // valores y bolsa
  '63': 'insurance_financial_services', // aseguradoras
  '64': 'insurance_financial_services', // agentes y corredores de seguros
  '10': 'energy_mining_environment', // minería metálica
  '13': 'energy_mining_environment', // petróleo y gas
  '29': 'energy_mining_environment', // refinación
  '49': 'energy_mining_environment', // electricidad, gas y saneamiento
  '30': 'industry_manufacturing_chemicals_automotive', // caucho y plásticos
  '33': 'industry_manufacturing_chemicals_automotive', // metales primarios
  '34': 'industry_manufacturing_chemicals_automotive', // productos metálicos
  '37': 'industry_manufacturing_chemicals_automotive', // equipo de transporte
  '53': 'retail', // tiendas por departamento
  '54': 'retail', // alimentos
  '55': 'retail', // automotor
  '56': 'retail', // ropa
  '57': 'retail', // hogar y cómputo
  '58': 'retail', // restaurantes
  '59': 'retail', // otros minoristas
  '15': 'property_construction', // construcción de edificios
  '16': 'property_construction', // obra pesada
  '65': 'property_construction', // inmobiliario
  '40': 'transport_logistics', // ferrocarril
  '41': 'transport_logistics', // transporte de pasajeros
  '42': 'transport_logistics', // camiones y bodegas
  '44': 'transport_logistics', // transporte marítimo
  '45': 'transport_logistics', // transporte aéreo
  '46': 'transport_logistics', // ductos
  '47': 'transport_logistics', // servicios de transporte
  '20': 'consumer_goods', // alimentos y bebidas
  '21': 'consumer_goods', // tabaco
  '22': 'consumer_goods', // textiles
  '23': 'consumer_goods', // confección
});

/** Grupos SIC que nunca se ofrecen (cascarones, holdings y titulizaciones). */
export const US_SIC_DISCOVERY_EXCLUDED_MAJORS: ReadonlySet<string> = new Set(['61', '67']);

/** Macro de una organización del IRS, o `null` si no se ofrece en el buscador. */
export function resolveUsIrsMacro(input: {
  ntee: string | null | undefined;
  subsection: string | null | undefined;
  legalName: string | null | undefined;
}): MacroIndustryKey | null {
  const subsection = input.subsection?.trim() ?? '';
  if (US_IRS_DISCOVERY_EXCLUDED_SUBSECTIONS.has(subsection)) return null;
  const major = input.ntee?.trim().toUpperCase().charAt(0) ?? '';
  if (major !== '') return US_NTEE_MAJOR_MACRO[major] ?? null;
  const name = input.legalName?.toUpperCase() ?? '';
  return subsection === '12' && ELECTRIC_COOP_NAME.test(name) ? 'energy_mining_environment' : null;
}

/** Macro de una empresa de la SEC por su SIC, o `null` si no se ofrece. */
export function resolveUsSicMacro(sic: string | null | undefined): MacroIndustryKey | null {
  const code = sic?.trim() ?? '';
  if (!/^\d{3,4}$/.test(code)) return null;
  const major = code.padStart(4, '0').slice(0, 2);
  if (US_SIC_DISCOVERY_EXCLUDED_MAJORS.has(major)) return null;
  return US_SIC_MAJOR_MACRO[major] ?? null;
}

/** ¿Tiene esta macro alguna clasificación de EE. UU.? */
export function macroHasUsFreeDirectoryCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (
    Object.values(US_NTEE_MAJOR_MACRO).includes(macroIndustryKey as MacroIndustryKey) ||
    Object.values(US_SIC_MAJOR_MACRO).includes(macroIndustryKey as MacroIndustryKey)
  );
}
