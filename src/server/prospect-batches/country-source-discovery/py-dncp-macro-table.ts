/**
 * py-dncp-macro-table.ts — qué macro industria corresponde a una empresa paraguaya
 * según LO QUE VENDE AL ESTADO: el código UNSPSC de los artículos que le
 * adjudicó la DNCP (Dirección Nacional de Contrataciones Públicas).
 *
 * SOURCES-PY-CLOSE-1.
 *
 * ── 🔴 Por qué UNSPSC y no la actividad ──────────────────────────────────────
 *
 * El padrón de RUC de la DNIT no publica la actividad de las sociedades, y la
 * DNCP sólo da 25 rubros de inscripción demasiado gruesos (el 24 mezcla
 * informática con equipos de oficina). Cada artículo adjudicado, en cambio, lleva
 * su clase UNSPSC (8 dígitos). La macro de la empresa es la de su SEGMENTO
 * dominante por monto adjudicado (`resolvePyDncpSupplierMacro`), y sólo si ese
 * segmento pesa al menos la mitad: una empresa que vende de todo no se clasifica.
 *
 * Igual que la tabla AR aprobada (v2), quien revende informática o equipo médico
 * va a Tecnología o Salud: es el integrador o el distribuidor de esa industria.
 * La dueña del producto la aprobó el 06-10-2026 («tabla PY aprobada», medida sobre
 * 1.127 proveedoras de 2022-2026). Cambiarla es una decisión de producto: no se
 * edita sin su visto bueno.
 *
 * Reglas:
 *   - La familia (4 dígitos) manda sobre su segmento (2 dígitos).
 *   - Un segmento que no aparece NO tiene macro: la fuente gratuita nunca ofrece
 *     esas empresas (viajes, comida y alojamiento, educación y capacitación,
 *     servicios comunitarios, publicaciones).
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

/** Versión de la tabla. */
export const PY_DNCP_MACRO_TABLE_VERSION = 'py-unspsc-dncp-macro-v1' as const;

/** Peso mínimo del segmento dominante (monto) para clasificar a la empresa. */
export const PY_DNCP_DOMINANT_SEGMENT_MIN_SHARE = 0.5;

const MANUFACTURING = 'industry_manufacturing_chemicals_automotive' as const;
const ENERGY = 'energy_mining_environment' as const;

/** Segmento UNSPSC (2 dígitos) → macro industria. */
export const PY_DNCP_SEGMENT_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  // ── Bienes ──
  '10': 'agroindustry', // animales vivos, plantas, semillas
  '11': MANUFACTURING, // minerales, textiles y materiales no comestibles
  '12': MANUFACTURING, // químicos, gases y materiales explosivos
  '13': MANUFACTURING, // resinas, caucho, plásticos
  '14': MANUFACTURING, // papel y productos de papel
  '15': ENERGY, // combustibles y lubricantes
  '20': ENERGY, // maquinaria de minería y perforación
  '21': 'agroindustry', // maquinaria agrícola, forestal y de jardinería
  '22': 'property_construction', // maquinaria de construcción
  '23': MANUFACTURING, // maquinaria industrial
  '24': MANUFACTURING, // manejo, embalaje y almacenamiento de materiales
  '25': 'retail', // vehículos y sus accesorios (concesionarios)
  '26': ENERGY, // generación y distribución de energía, cables
  '27': MANUFACTURING, // herramientas
  '30': 'property_construction', // componentes y materiales de construcción
  '31': MANUFACTURING, // componentes de manufactura
  '32': MANUFACTURING, // componentes electrónicos
  '39': MANUFACTURING, // iluminación y equipo eléctrico
  '40': MANUFACTURING, // climatización, plomería, distribución de fluidos
  '41': 'health_pharma', // equipo de laboratorio, medición y ensayo
  '42': 'health_pharma', // equipo y suministros médicos
  '43': 'technology', // informática y telecomunicaciones
  '44': 'retail', // equipo y útiles de oficina
  '45': 'technology', // equipo de impresión, fotografía y audiovisual
  '46': 'retail', // equipo de defensa, seguridad y orden público
  '47': 'retail', // equipo y suministros de limpieza
  '48': 'retail', // maquinaria y equipo para servicios (cocinas, lavanderías)
  '49': 'retail', // deportes y recreación
  '50': 'consumer_goods', // alimentos y bebidas
  '51': 'health_pharma', // medicamentos y productos farmacéuticos
  '52': 'retail', // electrodomésticos y artículos para el hogar
  '53': MANUFACTURING, // ropa, calzado, maletas y artículos de aseo
  '56': MANUFACTURING, // muebles y mobiliario
  '60': 'retail', // material didáctico, instrumentos musicales, juguetes
  // ── Servicios ──
  '70': 'agroindustry', // servicios agrícolas, pesqueros, forestales
  '71': ENERGY, // servicios de minería, petróleo y gas
  '72': 'property_construction', // construcción y mantenimiento de edificios e infraestructura
  '73': MANUFACTURING, // servicios de producción y fabricación industrial
  '76': 'services_company', // limpieza industrial y descontaminación
  '77': ENERGY, // servicios medioambientales
  '78': 'transport_logistics', // transporte, almacenamiento y correo
  '80': 'services_company', // gestión, servicios profesionales y administrativos
  '81': 'services_company', // ingeniería e investigación (la informática, abajo)
  '82': 'services_company', // publicidad, diseño, impresión y artes gráficas
  '83': ENERGY, // servicios públicos: agua, electricidad (las telecomunicaciones, abajo)
  '84': 'insurance_financial_services', // servicios financieros y seguros
  '85': 'health_pharma', // servicios de salud
  '92': 'services_company', // seguridad y vigilancia
});

/** Familia UNSPSC (4 dígitos) → macro. Manda sobre su segmento. */
export const PY_DNCP_FAMILY_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '7811': 'services_company', // pasajes y transporte de pasajeros (agencias de viajes, no logística)
  '8111': 'technology', // servicios informáticos (software, desarrollo, soporte)
  '8112': 'technology', // servicios de datos
  '8116': 'technology', // entrega de servicios de tecnología de la información
  '8311': 'technology', // servicios de telecomunicaciones y medios
  '8312': 'technology', // servicios de información (internet)
});


/**
 * Rubro en palabras de cada segmento y familia UNSPSC: lo que ve el vendedor en la
 * columna «Industria» (no el artículo suelto, «Notebook»).
 */
export const PY_DNCP_RUBRO_LABEL: Readonly<Record<string, string>> = Object.freeze({
  '10': 'Animales vivos, plantas, semillas',
  '11': 'Minerales, textiles y materiales no comestibles',
  '12': 'Químicos, gases y materiales explosivos',
  '13': 'Resinas, caucho, plásticos',
  '14': 'Papel y productos de papel',
  '15': 'Combustibles y lubricantes',
  '20': 'Maquinaria de minería y perforación',
  '21': 'Maquinaria agrícola, forestal y de jardinería',
  '22': 'Maquinaria de construcción',
  '23': 'Maquinaria industrial',
  '24': 'Manejo, embalaje y almacenamiento de materiales',
  '25': 'Vehículos y sus accesorios',
  '26': 'Generación y distribución de energía, cables',
  '27': 'Herramientas',
  '30': 'Componentes y materiales de construcción',
  '31': 'Componentes de manufactura',
  '32': 'Componentes electrónicos',
  '39': 'Iluminación y equipo eléctrico',
  '40': 'Climatización, plomería, distribución de fluidos',
  '41': 'Equipo de laboratorio, medición y ensayo',
  '42': 'Equipo y suministros médicos',
  '43': 'Informática y telecomunicaciones',
  '44': 'Equipo y útiles de oficina',
  '45': 'Equipo de impresión, fotografía y audiovisual',
  '46': 'Equipo de defensa, seguridad y orden público',
  '47': 'Equipo y suministros de limpieza',
  '48': 'Maquinaria y equipo para servicios (cocinas, lavanderías)',
  '49': 'Deportes y recreación',
  '50': 'Alimentos y bebidas',
  '51': 'Medicamentos y productos farmacéuticos',
  '52': 'Electrodomésticos y artículos para el hogar',
  '53': 'Ropa, calzado, maletas y artículos de aseo',
  '56': 'Muebles y mobiliario',
  '60': 'Material didáctico, instrumentos musicales, juguetes',
  '70': 'Servicios agrícolas, pesqueros, forestales',
  '71': 'Servicios de minería, petróleo y gas',
  '72': 'Construcción y mantenimiento de edificios e infraestructura',
  '73': 'Servicios de producción y fabricación industrial',
  '76': 'Limpieza industrial y descontaminación',
  '77': 'Servicios medioambientales',
  '78': 'Transporte, almacenamiento y correo',
  '80': 'Gestión, servicios profesionales y administrativos',
  '81': 'Ingeniería e investigación',
  '82': 'Publicidad, diseño, impresión y artes gráficas',
  '83': 'Servicios públicos: agua, electricidad',
  '84': 'Servicios financieros y seguros',
  '85': 'Servicios de salud',
  '92': 'Seguridad y vigilancia',
  '7811': 'Pasajes y agencias de viajes',
  '8111': 'Servicios informáticos (software, desarrollo, soporte)',
  '8112': 'Servicios de datos',
  '8116': 'Entrega de servicios de tecnología de la información',
  '8311': 'Servicios de telecomunicaciones y medios',
  '8312': 'Servicios de información (internet)',
});

/** Rubro de una clase UNSPSC (la familia manda sobre el segmento), o `null`. */
export function resolvePyUnspscRubro(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  if (!/^\d{2,8}$/.test(code)) return null;
  return PY_DNCP_RUBRO_LABEL[code.slice(0, 4)] ?? PY_DNCP_RUBRO_LABEL[code.slice(0, 2)] ?? null;
}

/** Macro de UNA clase UNSPSC (8 dígitos, o su prefijo), o `null` si no tiene. */
export function resolvePyUnspscMacro(raw: string | null | undefined): MacroIndustryKey | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  if (!/^\d{2,8}$/.test(code)) return null;
  return PY_DNCP_FAMILY_MACRO[code.slice(0, 4)] ?? PY_DNCP_SEGMENT_MACRO[code.slice(0, 2)] ?? null;
}

/**
 * Macro de una empresa a partir del monto adjudicado por familia UNSPSC: la macro
 * que suma más monto, sólo si pesa al menos `PY_DNCP_DOMINANT_SEGMENT_MIN_SHARE`
 * del total clasificado. `null` si no hay una macro dominante.
 */
export function resolvePyDncpSupplierMacro(
  amountByFamily: Readonly<Record<string, number>>,
): { macroIndustryKey: MacroIndustryKey; share: number } | null {
  const byMacro = new Map<MacroIndustryKey, number>();
  let total = 0;
  for (const [family, amount] of Object.entries(amountByFamily)) {
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
    const macro = resolvePyUnspscMacro(family);
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

/** ¿Tiene esta macro alguna clase paraguaya clasificada? */
export function macroHasPyDncpCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (
    Object.values(PY_DNCP_SEGMENT_MACRO).includes(macroIndustryKey as MacroIndustryKey) ||
    Object.values(PY_DNCP_FAMILY_MACRO).includes(macroIndustryKey as MacroIndustryKey)
  );
}
