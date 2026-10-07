/**
 * hn-honducompras-macro-table.ts — qué macro industria corresponde a una empresa o
 * entidad hondureña de la capa gratuita, según LO QUE VENDE AL ESTADO.
 *
 * SOURCES-HN-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Dos clasificaciones, según de dónde viene la empresa ───────────────────
 *
 *   1. HonduCompras (ONCAE) codifica cada artículo con UNSPSC: se usa la MISMA tabla
 *      segmento/familia → macro que la dueña aprobó el 06-10-2026 para Paraguay
 *      (`py-dncp-macro-table.ts`, v1) y que ya usan Costa Rica y Guatemala.
 *   2. SIAFI (SEFIN) no trae artículos: cada pago lleva el OBJETO DEL GASTO del
 *      Manual de Clasificación Presupuestaria (5 dígitos; los 3 primeros dicen qué se
 *      pagó). Sólo se usa cuando la empresa no tiene ningún artículo UNSPSC. Tabla
 *      NUEVA, aprobada por la dueña el 07-10-2026 («Apruebo ambas»).
 *   3. Las entidades públicas (compradoras de ONCAE) se ofrecen sólo para Gobierno.
 *
 * La macro es la que suma al menos la mitad del monto. Cambiar la clasificación es
 * una decisión de producto: no se edita sin el visto bueno de la dueña.
 *
 * ── Relevancia (no hay tamaño oficial) ──────────────────────────────────────
 *
 * Ninguna fuente abierta de Honduras publica trabajadores, ingresos ni la categoría
 * de contribuyente del SAR por empresa. La capa gratuita sólo ofrece empresas con
 * actividad desde 2022, sin la marca «*MIPYME*» y con al menos L 5 millones
 * adjudicados en 2018-2026 (aprobado el 07-10-2026). Volumen medido: 1.221 empresas
 * con macro, 578 con web.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import {
  macroHasPyDncpCoverage,
  PY_DNCP_DOMINANT_SEGMENT_MIN_SHARE,
  PY_DNCP_MACRO_TABLE_VERSION,
  resolvePyDncpSupplierMacro,
  resolvePyUnspscMacro,
  resolvePyUnspscRubro,
} from './py-dncp-macro-table';

/** Versión de la tabla de objeto del gasto de SIAFI. */
export const HN_SIAFI_OBJETO_MACRO_TABLE_VERSION = 'hn-siafi-objeto-gasto-macro-v1' as const;

/** Versión de la clasificación de Honduras (las dos tablas). */
export const HN_HONDUCOMPRAS_MACRO_TABLE_VERSION =
  `hn-honducompras-v1(${PY_DNCP_MACRO_TABLE_VERSION}+${HN_SIAFI_OBJETO_MACRO_TABLE_VERSION})` as const;

/** Las entidades públicas se ofrecen sólo para Gobierno. */
export const HN_PUBLIC_ENTITY_MACRO: MacroIndustryKey = 'government';

/** Monto mínimo adjudicado en 2018-2026 (lempiras). */
export const HN_HONDUCOMPRAS_MIN_AWARDED_HNL = 5_000_000;

/** Año desde el que la empresa debe seguir vendiendo al Estado. */
export const HN_HONDUCOMPRAS_MIN_LAST_YEAR = 2022;

/**
 * Objeto del gasto (3 primeros dígitos) → macro. Lo que no está (imprenta,
 * publicidad, protocolo, capacitación, alquiler de maquinaria…) no se clasifica.
 */
export const HN_SIAFI_OBJETO_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '211': 'energy_mining_environment', // energía eléctrica
  '212': 'energy_mining_environment', // agua
  '356': 'energy_mining_environment', // combustibles y lubricantes
  '214': 'technology', // telefonía e internet
  '246': 'technology', // servicios de informática y sistemas
  '426': 'technology', // equipo de comunicación
  '221': 'property_construction', // alquiler de edificios y locales
  '231': 'property_construction', // mantenimiento de edificios
  '234': 'property_construction', // mantenimiento de obras
  '471': 'property_construction', // construcciones (bienes de dominio privado)
  '472': 'property_construction', // construcciones (bienes de dominio público)
  '241': 'health_pharma', // servicios médicos y hospitalarios
  '352': 'health_pharma', // productos medicinales y farmacéuticos
  '242': 'services_company', // estudios, investigaciones y consultoría
  '247': 'services_company', // servicios jurídicos, contables y de auditoría
  '292': 'services_company', // vigilancia
  '251': 'transport_logistics', // transporte
  '254': 'insurance_financial_services', // seguros
  '257': 'insurance_financial_services', // comisiones y gastos bancarios
  '311': 'consumer_goods', // alimentos y bebidas
  '358': 'industry_manufacturing_chemicals_automotive', // productos de plástico
});

/** Lo que el vendedor ve en la columna «Industria» para un objeto del gasto. */
export const HN_SIAFI_OBJETO_LABEL: Readonly<Record<string, string>> = Object.freeze({
  '211': 'Energía eléctrica',
  '212': 'Agua',
  '356': 'Combustibles y lubricantes',
  '214': 'Telefonía e internet',
  '246': 'Servicios de informática',
  '426': 'Equipo de comunicación',
  '221': 'Alquiler de edificios',
  '231': 'Mantenimiento de edificios',
  '234': 'Mantenimiento de obras',
  '471': 'Construcción',
  '472': 'Construcción de obras públicas',
  '241': 'Servicios médicos y hospitalarios',
  '352': 'Medicinas',
  '242': 'Consultoría',
  '247': 'Servicios jurídicos y contables',
  '292': 'Vigilancia',
  '251': 'Transporte',
  '254': 'Seguros',
  '257': 'Servicios bancarios',
  '311': 'Alimentos y bebidas',
  '358': 'Productos de plástico',
});

/** Macro de un objeto del gasto (5 dígitos o sus 3 primeros), o `null`. */
export function resolveHnObjetoMacro(raw: string | null | undefined): MacroIndustryKey | null {
  const code = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{3,5}$/.test(code)) return null;
  return HN_SIAFI_OBJETO_MACRO[code.slice(0, 3)] ?? null;
}

/** Rubro en palabras de un objeto del gasto, o `null`. */
export function resolveHnObjetoRubro(raw: string | null | undefined): string | null {
  const code = typeof raw === 'string' ? raw.trim() : '';
  return /^\d{3,5}$/.test(code) ? HN_SIAFI_OBJETO_LABEL[code.slice(0, 3)] ?? null : null;
}

/** Macro dominante por monto y objeto del gasto (≥ 50 %), o `null`. */
export function resolveHnObjetoSupplierMacro(
  amountByObjeto: Readonly<Record<string, number>>,
): { macroIndustryKey: MacroIndustryKey; share: number } | null {
  const byMacro = new Map<MacroIndustryKey, number>();
  let total = 0;
  for (const [code, amount] of Object.entries(amountByObjeto)) {
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
    const macro = resolveHnObjetoMacro(code);
    if (macro !== null) byMacro.set(macro, (byMacro.get(macro) ?? 0) + amount);
  }
  if (total <= 0) return null;
  let best: { macroIndustryKey: MacroIndustryKey; share: number } | null = null;
  for (const [macro, amount] of byMacro) {
    const share = amount / total;
    if (best === null || share > best.share) best = { macroIndustryKey: macro, share };
  }
  return best !== null && best.share >= PY_DNCP_DOMINANT_SEGMENT_MIN_SHARE ? best : null;
}

/** Por qué tabla se clasificó la fila. */
export type HnDirectoryKind = 'honducompras_supplier' | 'siafi_supplier' | 'public_entity';

/**
 * Macro de una proveedora: por UNSPSC si tiene algún artículo clasificado; si no,
 * por objeto del gasto.
 */
export function resolveHnSupplierMacro(input: {
  amountByFamily: Readonly<Record<string, number>>;
  amountByObjeto: Readonly<Record<string, number>>;
}): { macroIndustryKey: MacroIndustryKey; share: number; kind: HnDirectoryKind } | null {
  if (Object.keys(input.amountByFamily).length > 0) {
    const macro = resolvePyDncpSupplierMacro(input.amountByFamily);
    return macro === null ? null : { ...macro, kind: 'honducompras_supplier' };
  }
  const macro = resolveHnObjetoSupplierMacro(input.amountByObjeto);
  return macro === null ? null : { ...macro, kind: 'siafi_supplier' };
}

/** Macro de una fila del directorio según su tabla y su código, o `null`. */
export function resolveHnDirectoryMacro(
  kind: string | null | undefined,
  code: string | null | undefined,
): MacroIndustryKey | null {
  if (kind === 'public_entity') return HN_PUBLIC_ENTITY_MACRO;
  if (kind === 'honducompras_supplier') return resolvePyUnspscMacro(code);
  if (kind === 'siafi_supplier') return resolveHnObjetoMacro(code);
  return null;
}

/** Rubro en palabras de una fila del directorio, o `null`. */
export function resolveHnDirectoryRubro(kind: string | null | undefined, code: string | null | undefined): string | null {
  if (kind === 'honducompras_supplier') return resolvePyUnspscRubro(code);
  if (kind === 'siafi_supplier') return resolveHnObjetoRubro(code);
  return null;
}

/** ¿Tiene esta macro alguna fuente hondureña clasificada? */
export function macroHasHnHonducomprasCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (
    macroIndustryKey === HN_PUBLIC_ENTITY_MACRO ||
    macroHasPyDncpCoverage(macroIndustryKey) ||
    Object.values(HN_SIAFI_OBJETO_MACRO).includes(macroIndustryKey as MacroIndustryKey)
  );
}

/** ¿Es la empresa lo bastante relevante para la capa gratuita? */
export function isHnHonducomprasRelevant(input: {
  awardedHnl: number;
  lastYear: number | null;
  mipymeYear: number | null;
}): boolean {
  if (input.mipymeYear !== null && input.mipymeYear >= HN_HONDUCOMPRAS_MIN_LAST_YEAR) return false;
  if (input.lastYear === null || input.lastYear < HN_HONDUCOMPRAS_MIN_LAST_YEAR) return false;
  return Number.isFinite(input.awardedHnl) && input.awardedHnl >= HN_HONDUCOMPRAS_MIN_AWARDED_HNL;
}
