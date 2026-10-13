/**
 * ve-free-directory-macro-table.ts — qué macro industria corresponde a una fila del
 * directorio gratuito de Venezuela (`ve_free_directory` y `ve_free_directory_web`).
 *
 * SOURCES-VE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Venezuela no publica la actividad codificada de las sociedades. Siete
 * clasificaciones, todas por lo que la PROPIA fuente dice de la entidad:
 *
 *   1. Empresas que cotizan o emiten valores (Bolsa de Caracas y SUNAVAL): tabla RIF
 *      → macro leída de su objeto social (`ve-listed-company-macro-table.ts`).
 *   2. Reguladas por la SUDEASEG: su categoría (aseguradora, medicina prepagada,
 *      reaseguradora, corretaje, ajustadores, financiadora de primas, cooperativa de
 *      seguros) → Seguros y Servicios Financieros.
 *   3. Casas de bolsa miembros de la Bolsa de Caracas → Servicios Financieros.
 *   4. Reguladas por la SUNAVAL (fondos, sociedades administradoras, calificadoras,
 *      asesores de inversión) → Servicios Financieros; firmas de contadores públicos
 *      → Compañía de Servicios.
 *   5. Empresas con web comprobada: tabla escrita a mano (`ve-web-entities.ts`).
 *   6. Universidades privadas → Compañía de Servicios.
 *   7. Entes públicos (incluidas universidades públicas) → Gobierno.
 *   8. Empresas del Estado: a SU industria (decisión de la dueña, 13-10-2026), por
 *      la tabla `VE_STATE_COMPANY_MACRO`; los medios del Estado y las de objeto no
 *      claro quedan en Gobierno.
 *
 * Tablas 1, 5 y 8 APROBADAS por la dueña el 13-10-2026.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { VE_WEB_ENTITIES, veWebEntityByQid } from '@/server/source-catalog/connectors/ve-sources/ve-web-entities';
import {
  resolveVeListedCompanyMacro,
  VE_LISTED_COMPANY_MACRO,
  VE_LISTED_COMPANY_MACRO_TABLE_VERSION,
} from './ve-listed-company-macro-table';

/** La dueña aprobó las tablas de industria de empresas (cotizadas y con web). */
export const VE_FREE_DIRECTORY_MACRO_TABLES_APPROVED = true;

export const VE_FREE_DIRECTORY_MACRO_TABLE_VERSION = `ve-free-directory-v2(${VE_LISTED_COMPANY_MACRO_TABLE_VERSION})` as const;

/** Por qué fuente se clasificó la fila. */
export type VeDirectoryKind =
  | 'listed_company'
  | 'sudeaseg'
  | 'bvc_member'
  | 'sunaval'
  | 'company'
  | 'private_university'
  | 'public_entity'
  | 'state_company';

const FIN: MacroIndustryKey = 'insurance_financial_services';
const SERV: MacroIndustryKey = 'services_company';
const GOV: MacroIndustryKey = 'government';
const TRANSP: MacroIndustryKey = 'transport_logistics';
const MANU: MacroIndustryKey = 'industry_manufacturing_chemicals_automotive';
const TECH: MacroIndustryKey = 'technology';

/**
 * Empresa del Estado (dominio de la tabla de entes) → su industria. Las que no están
 * (medios del Estado, conglomerados de objeto no claro) quedan en Gobierno.
 */
export const VE_STATE_COMPANY_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  'bdt.com.ve': FIN, // Banco Digital de los Trabajadores
  'bancoex.gob.ve': FIN, // Banco de Comercio Exterior
  'bt.com.ve': FIN, // Banco del Tesoro
  'baer.gob.ve': TRANSP, // Bolivariana de Aeropuertos
  'bolipuertos.gob.ve': TRANSP, // Bolivariana de Puertos
  'metrolosteques.gob.ve': TRANSP,
  'metrovalencia.gob.ve': TRANSP,
  'metrodemaracaibo.gob.ve': TRANSP,
  'comter.alcaldiapaez.gob.ve': TRANSP, // transporte terrestre municipal
  'sitssa.gob.ve': TRANSP, // transporte superficial
  'logicasa.gob.ve': TRANSP, // logística
  'corpovex.gob.ve': TRANSP, // comercio exterior (importaciones del Estado)
  'cabelum.gob.ve': MANU, // conductores de aluminio
  'csn.gob.ve': MANU, // complejo siderúrgico
  'cvg.gob.ve': MANU, // holding de la industria básica de Guayana
  'dianca.gob.ve': MANU, // astilleros
  'cantv.com.ve': TECH, // telecomunicaciones
  'telecom.gob.ve': TECH,
  'industriacanaima.gob.ve': TECH, // computadoras
  'vit.gob.ve': TECH, // computadoras y teléfonos
  'codecyt.gob.ve': TECH, // desarrollo científico y tecnológico
  'corpoelec.gob.ve': 'energy_mining_environment', // electricidad
  'industriasdiana.gob.ve': 'consumer_goods', // aceites y alimentos
  'cuspal.gob.ve': 'consumer_goods', // servicios productivos y alimentarios
  'pdval.gob.ve': 'retail', // distribución de alimentos
  'camerbasma.alcaldiapaez.gob.ve': 'retail', // mercados y abastos municipales
  'pescalba.gob.ve': 'agroindustry', // pesca
  'quimbiotec.gob.ve': 'health_pharma', // hemoderivados
});

/** Categoría de la SUDEASEG → macro (las personas naturales nunca se cargan). */
export const VE_SUDEASEG_CATEGORY_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  'empresas-seguros': FIN,
  'medicina-prepagada': FIN,
  'empresas-reaseguros': FIN,
  'corretaje-seguros': FIN,
  'corretaje-reaseguros': FIN,
  'sociedad-ajustadores': FIN,
  'financiadoras-primas': FIN,
  'cooperativas': FIN,
  'administradoras-riesgo': FIN,
  'sociedad-inspectores': FIN,
});

const VE_SUDEASEG_CATEGORY_LABEL: Readonly<Record<string, string>> = Object.freeze({
  'empresas-seguros': 'Empresa de seguros (SUDEASEG)',
  'medicina-prepagada': 'Medicina prepagada (SUDEASEG)',
  'empresas-reaseguros': 'Empresa de reaseguros (SUDEASEG)',
  'corretaje-seguros': 'Sociedad de corretaje de seguros (SUDEASEG)',
  'corretaje-reaseguros': 'Sociedad de corretaje de reaseguros (SUDEASEG)',
  'sociedad-ajustadores': 'Sociedad de ajustadores de pérdidas (SUDEASEG)',
  'financiadoras-primas': 'Financiadora de primas (SUDEASEG)',
  'cooperativas': 'Cooperativa de seguros (SUDEASEG)',
  'administradoras-riesgo': 'Administradora de riesgos de salud (SUDEASEG)',
  'sociedad-inspectores': 'Sociedad de inspectores de riesgo (SUDEASEG)',
});

/** Tipo de entidad de la SUNAVAL → macro (los emisores van por la tabla de cotizadas). */
export const VE_SUNAVAL_KIND_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  fondo_mutual: FIN,
  sociedad_administradora: FIN,
  calificadora: FIN,
  asesor_inversion: FIN,
  firma_contadores: SERV,
});

const VE_SUNAVAL_KIND_LABEL: Readonly<Record<string, string>> = Object.freeze({
  fondo_mutual: 'Fondo mutual de inversión (SUNAVAL)',
  sociedad_administradora: 'Sociedad administradora de entidades de inversión colectiva (SUNAVAL)',
  calificadora: 'Sociedad calificadora de riesgo (SUNAVAL)',
  asesor_inversion: 'Asesor de inversión (SUNAVAL)',
  firma_contadores: 'Firma de contadores públicos inscrita en la SUNAVAL',
});

/** Tipo de ente público → etiqueta para la columna «Industria». */
export const VE_PUBLIC_ENTITY_KIND_LABEL: Readonly<Record<string, string>> = Object.freeze({
  national: 'Entidad pública nacional',
  territorial_state: 'Gobernación o ente estadal',
  territorial_municipality: 'Alcaldía o ente municipal',
  state_company: 'Empresa del Estado',
  public_university: 'Universidad pública',
  hospital: 'Hospital público',
});

/** Macro de una fila según su fuente y su código, o `null`. */
export function resolveVeDirectoryMacro(kind: string | null | undefined, code: string | null | undefined): MacroIndustryKey | null {
  switch (kind) {
    case 'public_entity':
      return typeof code === 'string' && code in VE_PUBLIC_ENTITY_KIND_LABEL ? GOV : null;
    case 'state_company':
      return typeof code === 'string' && code.length > 0 ? (VE_STATE_COMPANY_MACRO[code] ?? GOV) : null;
    case 'bvc_member':
      return FIN;
    case 'private_university':
      return SERV;
    case 'listed_company':
      return resolveVeListedCompanyMacro(code);
    case 'sudeaseg':
      return typeof code === 'string' ? (VE_SUDEASEG_CATEGORY_MACRO[code] ?? null) : null;
    case 'sunaval':
      return typeof code === 'string' ? (VE_SUNAVAL_KIND_MACRO[code] ?? null) : null;
    case 'company': {
      const entity = veWebEntityByQid(code);
      return entity?.kind === 'company' ? entity.macro : null;
    }
    default:
      return null;
  }
}

/** El rubro en palabras de una fila, o `null`. */
export function resolveVeDirectoryRubro(kind: string | null | undefined, code: string | null | undefined): string | null {
  switch (kind) {
    case 'public_entity':
      return typeof code === 'string' ? (VE_PUBLIC_ENTITY_KIND_LABEL[code] ?? null) : null;
    case 'state_company':
      return 'Empresa del Estado';
    case 'bvc_member':
      return 'Casa de bolsa (Bolsa de Caracas)';
    case 'private_university':
      return 'Universidad privada';
    case 'listed_company':
      return 'Emisor de valores (Bolsa de Caracas / SUNAVAL)';
    case 'sudeaseg':
      return typeof code === 'string' ? (VE_SUDEASEG_CATEGORY_LABEL[code] ?? null) : null;
    case 'sunaval':
      return typeof code === 'string' ? (VE_SUNAVAL_KIND_LABEL[code] ?? null) : null;
    default:
      return null;
  }
}

/** Macros de las empresas con web de la tabla escrita a mano. */
const VE_WEB_COMPANY_MACROS: ReadonlySet<MacroIndustryKey> = new Set(
  VE_WEB_ENTITIES.filter((entity) => entity.kind === 'company').map((entity) => entity.macro),
);

/** ¿Tiene esta macro alguna fuente venezolana clasificada? */
export function macroHasVeCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (
    macroIndustryKey === GOV ||
    macroIndustryKey === FIN ||
    macroIndustryKey === SERV ||
    Object.values(VE_LISTED_COMPANY_MACRO).includes(macroIndustryKey as MacroIndustryKey) ||
    VE_WEB_COMPANY_MACROS.has(macroIndustryKey as MacroIndustryKey) ||
    Object.values(VE_STATE_COMPANY_MACRO).includes(macroIndustryKey as MacroIndustryKey)
  );
}
