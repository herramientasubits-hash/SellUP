/**
 * Uruguay — adjudicaciones de ARCE en OCDS («Datos históricos de compras», catalogodatos.gub.uy),
 * cargadas en `public_procurement_supplier_links` con el cargador genérico (`--country UY`).
 *
 * Comprador = INCISO presupuestal (ministerio, ASSE, ente autónomo, intendencia): el OCDS
 * de ARCE identifica al comprador por «inciso-unidad ejecutora» (p. ej. «29-4» = Centro
 * Hospitalario Pereira Rossell, de ASSE) y sin RUT; las unidades ejecutoras se agrupan en su
 * organismo, que es lo que la persona escribe («Ministerio de Salud Pública», «ASSE»…).
 *
 * Industria por la tabla del catálogo SICE YA APROBADA por la dueña el 13-10-2026
 * (`uy-arce-macro-table.ts`, la misma de la capa gratuita `uy_arce_directory`): la clave de
 * familia es la clase SICE «familia-subfamilia-clase» del artículo adjudicado.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import { calculateUruguayRutCheckDigit } from '@/modules/prospect-batches/tax-identifier-rules';
import {
  resolveUyArceSupplierMacro,
  UY_ARCE_MACRO_TABLE_VERSION,
  type UyArceClassAmount,
} from '@/server/prospect-batches/country-source-discovery/uy-arce-macro-table';
import { isUruguayPublicEntityName, UY_DEPARTMENT_INCISO } from '@/server/source-catalog/connectors/rupe-uruguay/uy-public-entities';
import type { ProcurementClassifier } from '../procurement-links';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import type { LoadedCountrySource } from './types';

export const UY_ARCE_AWARDS_SOURCE_KEY = 'uy_arce_ocds_awards' as const;

/** Pesos uruguayos por unidad (los MISMOS cambios fijos de la capa gratuita, 2022-2025: US$ = 40). */
export const UY_UYU_PER: Readonly<Record<string, number>> = Object.freeze({
  UYU: 1,
  USD: 40,
  EUR: 43.2,
  UYI: 6,
  UI: 6,
  UR: 1_700,
});

/** Piso acumulado organismo × proveedor en la ventana: UYU 400 mil (≈ US$10 mil a 40). */
export const UY_ARCE_MIN_PAIR_AMOUNT_UYU = 400_000;

/** Un ítem de más de US$500 millones es un error de carga: no cuenta (como en la capa gratuita). */
export const UY_MAX_ITEM_AMOUNT_UYU = 500_000_000 * 40;

/** Nombre oficial de los incisos con varias unidades ejecutoras (con su sigla si la tiene). */
export const UY_INCISO_NAMES: Readonly<Record<string, string>> = Object.freeze({
  '1': 'Poder Legislativo',
  '2': 'Presidencia de la República',
  '3': 'Ministerio de Defensa Nacional',
  '4': 'Ministerio del Interior',
  '5': 'Ministerio de Economía y Finanzas',
  '6': 'Ministerio de Relaciones Exteriores',
  '7': 'Ministerio de Ganadería, Agricultura y Pesca',
  '8': 'Ministerio de Industria, Energía y Minería',
  '9': 'Ministerio de Turismo',
  '10': 'Ministerio de Transporte y Obras Públicas',
  '11': 'Ministerio de Educación y Cultura',
  '12': 'Ministerio de Salud Pública',
  '13': 'Ministerio de Trabajo y Seguridad Social',
  '14': 'Ministerio de Vivienda y Ordenamiento Territorial',
  '15': 'Ministerio de Desarrollo Social',
  '16': 'Poder Judicial',
  '25': 'Administración Nacional de Educación Pública (ANEP)',
  '26': 'Universidad de la República (Udelar)',
  '27': 'Instituto del Niño y Adolescente del Uruguay (INAU)',
  '28': 'Banco de Previsión Social (BPS)',
  '29': 'Administración de los Servicios de Salud del Estado (ASSE)',
  '31': 'Universidad Tecnológica del Uruguay (UTEC)',
  '36': 'Ministerio de Ambiente',
  '51': 'Banco de la República Oriental del Uruguay (BROU)',
  '53': 'Banco de Seguros del Estado (BSE)',
  '60': 'Administración Nacional de Combustibles, Alcohol y Portland (ANCAP)',
  '61': 'Administración Nacional de Usinas y Trasmisiones Eléctricas (UTE)',
  '64': 'Administración Nacional de Puertos (ANP)',
  '65': 'Administración Nacional de Telecomunicaciones (ANTEL)',
  '66': 'Administración de las Obras Sanitarias del Estado (OSE)',
  ...Object.fromEntries(Object.entries(UY_DEPARTMENT_INCISO).map(([department, inciso]) => [String(inciso), `Intendencia de ${department}`])),
});

/**
 * «29-4» → inciso «29» y su nombre. Un inciso sin nombre en la tabla toma el de su unidad
 * ejecutora (casi todos tienen una sola: «Tribunal de Cuentas», «Banco Central del Uruguay»).
 */
export function uyBuyerOf(buyerId: string | null | undefined, unitName: string | null | undefined): { code: string; name: string } | null {
  const match = /^(\d{1,3})-\d{1,4}$/.exec((buyerId ?? '').trim());
  const unit = (unitName ?? '').replace(/\s+/g, ' ').trim();
  if (!match) return null;
  const name = UY_INCISO_NAMES[match[1]] ?? unit;
  return name ? { code: `INCISO-${match[1]}`, name } : null;
}

/** «Administración de los Servicios de Salud del Estado (ASSE)» → «ADMINISTRACION DE LOS SERVICIOS DE SALUD DEL ESTADO ASSE». */
export function normalizeUyBuyerName(raw: string): string {
  return normalizePublicEntityName(raw);
}

/** «R/211014180012» → «211014180012» si es un RUT válido; cédulas (C/), extranjeros (X/) y otros ⇒ `null`. */
export function parseUyRutId(raw: string | null | undefined): string | null {
  const match = /^R\/?(\d{12})$/.exec((raw ?? '').trim());
  if (!match) return null;
  const rut = match[1];
  return calculateUruguayRutCheckDigit(rut.slice(0, 11)) === Number(rut[11]) ? rut : null;
}

/** Proveedor empresa: RUT válido y no un ente del Estado (que va a la capa de Gobierno). */
export function isUyCompanySupplier(rut: string | null, name: string | null | undefined): rut is string {
  return rut !== null && !isUruguayPublicEntityName(name ?? '');
}

/**
 * Rubro en palabras de cada subfamilia y clase de la tabla aprobada (los mismos textos de
 * sus comentarios): lo que ve el vendedor en «Industria».
 */
export const UY_ARCE_RUBRO_LABEL: Readonly<Record<string, string>> = Object.freeze({
  '2-1': 'Alimentos y productos agropecuarios',
  '2-2': 'Minerales',
  '2-3': 'Textiles, vestir y cuero',
  '2-4': 'Papel, libros, impresos',
  '2-5': 'Productos energéticos',
  '2-6': 'Químicos',
  '2-7': 'Minerales no metálicos y madera',
  '2-8': 'Productos metálicos',
  '2-11': 'Repuestos y accesorios',
  '2-12': 'Repuestos y accesorios',
  '2-13': 'Medicamentos y antisépticos de uso humano',
  '3-2': 'Publicidad, impresiones y encuadernaciones',
  '3-4': 'Transporte y almacenaje',
  '3-7': 'Mantenimiento y reparaciones',
  '3-8': 'Servicios profesionales',
  '3-10': 'Servicios de tecnologías de la información y comunicación',
  '4-1': 'Maquinarias y equipos de producción',
  '4-2': 'Máquinas y equipos de oficina',
  '4-3': 'Equipos médicos, sanitarios, odontológicos y científicos',
  '4-4': 'Equipos educacionales, culturales y recreativos',
  '4-5': 'Equipos de transporte',
  '4-6': 'Equipos de comunicaciones',
  '4-7': 'Motores y partes',
  '4-8': 'Mobiliario',
  '5-1': 'Tierras',
  '5-2': 'Edificios',
  '5-6': 'Otras tierras y edificios',
  '6-1': 'Vías de comunicación',
  '6-2': 'Edificaciones',
  '6-3': 'Obras hidráulicas, eléctricas y sanitarias',
  '6-4': 'Obras urbanísticas',
  '6-5': 'Instalaciones de transmisión y distribución',
  '6-6': 'Mejoras de tierras y plantaciones',
  '6-7': 'Perforaciones y exploraciones mineras',
  '6-8': 'Reparaciones mayores y extraordinarias',
  '6-9': 'Instalación de servicios locales',
  '10-43': 'Infraestructura tecnológica',
  '12-1': 'Productos de uso exclusivo de UTE',
  '12-2': 'Productos de uso exclusivo de ANCAP',
  '12-3': 'Productos de uso exclusivo de ANTEL',
  '2-1-1': 'Alimentos de origen agropecuario',
  '2-1-2': 'Alimentos provenientes de la pesca',
  '2-1-8': 'Semillas',
  '2-6-2': 'Lubricantes y grasas',
  '2-6-3': 'Abonos, fertilizantes, insecticidas',
  '2-6-4': 'Productos químicos, medicinales y farmacéuticos',
  '2-6-8': 'Productos bituminosos',
  '2-9-3': 'Útiles y accesorios eléctricos',
  '4-2-6': 'Equipos de servicio eléctrico y accesorios',
  '2-9-4': 'Útiles menores médico-quirúrgicos',
  '3-1-1': 'Teléfono, telégrafo y similares',
  '3-1-2': 'Correspondencia y encomiendas',
  '3-1-3': 'Correspondencia y encomiendas',
  '3-1-4': 'Aprovisionamiento de agua',
  '3-3-1': 'Pasajes',
  '3-3-2': 'Pasajes',
  '3-3-3': 'Pasajes',
  '3-3-4': 'Pasajes',
  '3-3-5': 'Pasajes',
  '3-3-10': 'Pasajes',
  '3-5-1': 'Arrendamiento de inmuebles',
  '3-5-5': 'Arrendamiento de máquinas de construcción',
  '3-5-6': 'Arrendamiento de equipos de transporte',
  '3-6-1': 'Seguros',
  '3-6-2': 'Seguros',
  '3-6-4': 'Comisiones bancarias y de cambio',
  '3-7-1': 'Mantenimiento de inmuebles',
  '3-7-2': 'Mantenimiento de instalaciones',
  '3-8-2': 'Servicios médicos',
  '3-9-1': 'Limpieza',
  '3-9-2': 'Vigilancia',
  '3-9-4': 'Servicios de instalación',
});

const SICE_CLASS = /^(\d+)-(\d+)-(\d+)$/;

/** Clasificador con la tabla SICE aprobada: clave = clase «f-s-k». */
export const UY_ARCE_CLASSIFIER: ProcurementClassifier = {
  tableVersion: UY_ARCE_MACRO_TABLE_VERSION,
  classify: (amountByFamily) => {
    const classes: UyArceClassAmount[] = [];
    for (const [key, amount] of Object.entries(amountByFamily)) {
      const match = SICE_CLASS.exec(key);
      if (match) classes.push([Number(match[1]), Number(match[2]), Number(match[3]), amount]);
    }
    const resolved = resolveUyArceSupplierMacro(classes);
    return resolved ? { macroIndustryKey: resolved.macro, share: resolved.share } : null;
  },
  rubroOf: (family) => {
    const match = SICE_CLASS.exec(family ?? '');
    if (!match) return null;
    return UY_ARCE_RUBRO_LABEL[`${match[1]}-${match[2]}-${match[3]}`] ?? UY_ARCE_RUBRO_LABEL[`${match[1]}-${match[2]}`] ?? null;
  },
};

export const UY_COUNTRY: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'UY',
  sourceKey: UY_ARCE_AWARDS_SOURCE_KEY,
  taxIdentifierType: 'RUT',
  currency: 'UYU',
  minPairAmount: UY_ARCE_MIN_PAIR_AMOUNT_UYU,
  normalizeBuyerName: normalizeUyBuyerName,
  classifier: UY_ARCE_CLASSIFIER,
  // En Prod (15-10): uy_arce_directory 567 con web de 2.315; lista curada 10/106 (sin RUT).
  domainSourceKeys: ['uy_arce_directory', 'latam_curated_directory'],
  // Ninguna fuente uruguaya de empresas trae `workers` (uy_public_entities sí, pero son del Estado).
  workersSourceKeys: [],
  // RUT de 12 dígitos sin separadores en todas.
};
