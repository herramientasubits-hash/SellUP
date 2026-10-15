/**
 * ar-rubro-macro-table.ts — qué macro industria corresponde a un proveedor argentino del
 * Estado nacional según LO QUE LE VENDE: los «Rubros» de COMPR.AR de sus adjudicaciones
 * (Adjudicaciones 2016-2026, datos.gob.ar).
 *
 * 🔴 BORRADOR — pendiente de aprobación de la dueña (AGENT1-SUPPLIER-SEARCH-ALL-1, 15-10-2026).
 * No se carga nada de Argentina en Producción hasta que la apruebe. Cambiarla después
 * de aprobada es una decisión de producto.
 *
 * Por qué rubros y no UNSPSC: el archivo abierto de COMPR.AR no trae UNSPSC ni el
 * catálogo SIByS por ítem; sólo 49 rubros gruesos, varios por línea («FERRETERIA;
 * HERRAMIENTAS;»). El lector reparte el monto de la línea en partes iguales entre sus
 * rubros. Mismo criterio que la tabla UNSPSC aprobada (Paraguay): quien revende
 * informática o insumos médicos va a Tecnología o Salud; útiles, limpieza, hogar,
 * repuestos y equipo de seguridad, a Comercio.
 *
 * Regla del 50 %: la macro de la empresa es la que suma más monto, sólo si pesa al menos
 * la mitad del total. Un rubro sin macro (EQUIPOS, ALQUILER, CEREMONIAL, CULTURA,
 * CONCESION: mezclan de todo) cuenta en el total pero no clasifica.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import type { ProcurementClassifier } from '../procurement-links';

export const AR_RUBRO_MACRO_TABLE_VERSION = 'ar-comprar-rubro-macro-v0-draft' as const;

/** Sólo cuando la dueña la apruebe pasa a `true` (y la versión deja de ser «draft»). */
export const AR_RUBRO_MACRO_TABLE_APPROVED = false;

export const AR_RUBRO_DOMINANT_MIN_SHARE = 0.5;

const MANUFACTURING = 'industry_manufacturing_chemicals_automotive' as const;
const ENERGY = 'energy_mining_environment' as const;

/**
 * Rubro COMPR.AR (normalizado: mayúsculas, sin tildes, un espacio) → macro. `null` = sin
 * macro. Entre paréntesis, líneas 2016-2026 en que aparece (medido el 15-10-2026).
 */
export const AR_RUBRO_MACRO: Readonly<Record<string, MacroIndustryKey | null>> = Object.freeze({
  'REPUESTOS': 'retail', // 49.112 — repuestos y accesorios (concesionarios, casas de repuestos)
  'FERRETERIA': 'retail', // 46.564
  'LIBRERIA PAP. Y UTILES OFICINA': 'retail', // 37.068
  'PROD. MEDICO/FARMACEUTICOS/LAB': 'health_pharma', // 34.759
  'ELECTRICIDAD Y TELEFONIA': MANUFACTURING, // 32.444 — material eléctrico
  'INDUMENT TEXTIL Y CONFECCIONES': MANUFACTURING, // 29.674
  'EQUIPOS': null, // 27.823 — equipos de cualquier tipo
  'ELEMENTOS DE LIMPIEZA': 'retail', // 25.818
  'HERRAMIENTAS': MANUFACTURING, // 25.075
  'QUIMICOS': MANUFACTURING, // 24.861
  'PINTURAS': MANUFACTURING, // 21.443
  'MANT. REPARACION Y LIMPIEZA': 'services_company', // 21.007
  'SERV. PROFESIONAL Y COMERCIAL': 'services_company', // 20.664
  'MATERIALES DE CONSTRUCCION': 'property_construction', // 18.493
  'ALIMENTOS': 'consumer_goods', // 15.043
  'INFORMATICA': 'technology', // 14.941
  'SANITARIOS PLOMERIA Y GAS': MANUFACTURING, // 14.182 — climatización, plomería, fluidos
  'BAZAR Y MENAJE': 'retail', // 12.687
  'COMBUSTIBLES Y LUBRICANTES': ENERGY, // 12.685
  'CERRAJERIA': 'retail', // 8.906
  'EQUIPO DE OFICINA Y MUEBLES': MANUFACTURING, // 8.458 — mobiliario
  'ARTICULOS DEL HOGAR': 'retail', // 8.065
  'CARPINTERIA': MANUFACTURING, // 6.483
  'ALQUILER': null, // 5.898 — inmuebles, vehículos, equipos
  'CONSTRUCCION': 'property_construction', // 5.841
  'HERRERIA': MANUFACTURING, // 5.672
  'IMPRENTA Y EDITORIALES': 'services_company', // 4.053 — artes gráficas
  'TRANSPORTE Y DEPOSITO': 'transport_logistics', // 3.947
  'METALES': MANUFACTURING, // 3.745
  'SERVICIOS BASICOS': ENERGY, // 3.242 — agua, electricidad, gas
  'BANCOS Y SEGUROS': 'insurance_financial_services', // 2.907
  'VIDRIERIA': MANUFACTURING, // 2.533
  'PRODUCTOS VETERINARIOS': 'agroindustry', // 2.278
  'NAUTICA': 'retail', // 2.113 — embarcaciones y accesorios
  'METALURGIA': MANUFACTURING, // 2.023
  'CEREMONIAL': null, // 1.915 — eventos, condecoraciones
  'AGRIC GANADERIA CAZA SILVICULT': 'agroindustry', // 1.650
  'VIGILANCIA Y SEGURIDAD': 'services_company', // 1.416
  'TAPICERIA': MANUFACTURING, // 1.111
  'INMUEBLES': 'property_construction', // 1.081
  'EQUIPO MILITAR Y DE SEGURIDAD': 'retail', // 1.043 — como el segmento UNSPSC 46
  'UTILES Y PRODUCTOS DEPORTIVOS': 'retail', // 972
  'CULTURA': null, // 504
  'CINE/TELVIS./RADIO/FOTOGRAFIA': 'technology', // 489 — audiovisual, como el segmento UNSPSC 45
  'SERVICIO DE NOTICIAS': 'services_company', // 458
  'JOYERIA Y ORFEBRERIA': 'retail', // 441
  'GASES INDUSTRIALES': MANUFACTURING, // 364
  'CONCESION': null, // 296
  'INSUMO P/ ARMAMENTO': 'retail', // 165
});

/** Rubro tal como viene en el CSV → clave de la tabla («SANITARIOS  PLOMERIA Y GAS» → «SANITARIOS PLOMERIA Y GAS»). */
export function normalizeArRubro(raw: string | null | undefined): string | null {
  const text = (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

/** Los rubros de una línea («FERRETERIA;HERRAMIENTAS;») ya normalizados y sin repetir. */
export function splitArRubros(raw: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const part of (raw ?? '').split(';')) {
    const rubro = normalizeArRubro(part);
    if (rubro) out.add(rubro);
  }
  return [...out];
}

/** Rubro en palabras para la ficha («PROD. MEDICO/FARMACEUTICOS/LAB» → «Prod. medico/farmaceuticos/lab»). */
function rubroLabel(rubro: string): string {
  const lower = rubro.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function resolveArRubroSupplierMacro(
  amountByRubro: Readonly<Record<string, number>>,
): { macroIndustryKey: MacroIndustryKey; share: number } | null {
  const byMacro = new Map<MacroIndustryKey, number>();
  let total = 0;
  for (const [rubro, amount] of Object.entries(amountByRubro)) {
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
    const macro = AR_RUBRO_MACRO[rubro] ?? null;
    if (macro !== null) byMacro.set(macro, (byMacro.get(macro) ?? 0) + amount);
  }
  if (total <= 0) return null;
  let best: { macroIndustryKey: MacroIndustryKey; share: number } | null = null;
  for (const [macro, amount] of byMacro) {
    const share = amount / total;
    if (best === null || share > best.share) best = { macroIndustryKey: macro, share };
  }
  return best !== null && best.share >= AR_RUBRO_DOMINANT_MIN_SHARE ? best : null;
}

export const AR_RUBRO_CLASSIFIER: ProcurementClassifier = {
  tableVersion: AR_RUBRO_MACRO_TABLE_VERSION,
  classify: (amountByFamily) => resolveArRubroSupplierMacro(amountByFamily),
  rubroOf: (family) => (family && family in AR_RUBRO_MACRO ? rubroLabel(family) : null),
};
