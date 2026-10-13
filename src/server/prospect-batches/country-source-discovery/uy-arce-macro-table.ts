/**
 * uy-arce-macro-table.ts — qué macro industria corresponde a una empresa uruguaya
 * según LO QUE VENDE AL ESTADO: la familia, subfamilia y clase del catálogo de
 * artículos del SICE (ARCE) de lo que le adjudicaron.
 *
 * SOURCES-UY-CLOSE-1.
 *
 * ── 🔴 Por qué el catálogo de compras y no la actividad ──────────────────────
 *
 * Uruguay no publica la actividad (CIIU) de sus empresas: la DGI no tiene padrón
 * abierto y el RUPE sólo da RUT y razón social. Cada artículo que ARCE adjudica,
 * en cambio, lleva su código del catálogo SICE (familia → subfamilia → clase). La
 * macro de la empresa es la de su rubro dominante por monto adjudicado
 * (`resolveUyArceSupplierMacro`), y sólo si pesa al menos la mitad: una empresa que
 * vende de todo no se clasifica. Mismo criterio que la tabla de Paraguay aprobada:
 * quien revende informática o equipo médico va a Tecnología o Salud.
 *
 * Reglas:
 *   - La clase (familia-subfamilia-clase) manda sobre su subfamilia.
 *   - Una subfamilia «otros» (2-9, 3-5, 3-9, 3-3, 3-6, 3-1) sólo clasifica por clase.
 *   - Lo que no aparece NO tiene macro: la fuente gratuita nunca ofrece esas
 *     empresas (viáticos, tasas y multas, servicios personales, «otros»).
 *
 * Medida el 13-10-2026 sobre los proveedores adjudicados 2022-2025 (OCDS de ARCE):
 * 2.118 organizaciones con ≥ USD 50.000 y alguna adjudicación desde 2024 quedan
 * clasificadas. La dueña APROBÓ la tabla y el corte (US$ 50.000 en 2022-2025 y alguna
 * adjudicación desde 2024) el 13-10-2026 («adelante»). Cambiarla es una decisión de
 * producto: no se edita sin su visto bueno.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

/** Versión de la tabla. */
export const UY_ARCE_MACRO_TABLE_VERSION = 'uy-sice-arce-macro-v1' as const;

/** La dueña aprobó la tabla (sólo entonces el ETL carga la capa gratuita). */
export const UY_ARCE_MACRO_TABLE_APPROVED = true;

/** Peso mínimo del rubro dominante (monto) para clasificar a la empresa. */
export const UY_ARCE_DOMINANT_MIN_SHARE = 0.5;

const MANUFACTURING = 'industry_manufacturing_chemicals_automotive' as const;
const ENERGY = 'energy_mining_environment' as const;
const CONSTRUCTION = 'property_construction' as const;
const SERVICES = 'services_company' as const;
const TRANSPORT = 'transport_logistics' as const;
const HEALTH = 'health_pharma' as const;
const FINANCE = 'insurance_financial_services' as const;

/** Subfamilia «familia-subfamilia» → macro. */
export const UY_ARCE_SUBFAMILY_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  // ── Materiales y suministros ──
  '2-1': 'consumer_goods', // alimentos y productos agropecuarios (las clases agropecuarias, abajo)
  '2-2': ENERGY, // minerales
  '2-3': MANUFACTURING, // textiles, vestir y cuero
  '2-4': MANUFACTURING, // papel, libros, impresos
  '2-5': ENERGY, // productos energéticos
  '2-6': MANUFACTURING, // químicos excepto medicamentos
  '2-7': CONSTRUCTION, // minerales no metálicos y madera
  '2-8': MANUFACTURING, // productos metálicos
  '2-11': 'retail', // repuestos y accesorios
  '2-12': 'retail', // repuestos y accesorios
  '2-13': HEALTH, // medicamentos y antisépticos de uso humano
  // ── Servicios no personales ──
  '3-2': SERVICES, // publicidad, impresiones y encuadernaciones
  '3-4': TRANSPORT, // transporte y almacenaje
  '3-7': SERVICES, // mantenimiento y reparaciones menores (inmuebles e instalaciones, abajo)
  '3-8': SERVICES, // servicios profesionales (médicos, abajo)
  '3-10': 'technology', // servicios de tecnologías de la información y comunicación
  // ── Máquinas, equipos y mobiliario ──
  '4-1': MANUFACTURING, // maquinarias y equipos de producción
  '4-2': 'technology', // máquinas y equipos de oficina
  '4-3': HEALTH, // equipos médicos, sanitarios, odontológicos y científicos
  '4-4': 'retail', // equipos educacionales, culturales y recreativos
  '4-5': 'retail', // equipos de transporte (concesionarios)
  '4-6': 'technology', // equipos de comunicaciones
  '4-7': MANUFACTURING, // motores y partes
  '4-8': MANUFACTURING, // mobiliario
  // ── Tierras, edificios y construcción ──
  '5-1': CONSTRUCTION, // tierras
  '5-2': CONSTRUCTION, // edificios
  '5-6': CONSTRUCTION, // otras tierras y edificios
  '6-1': CONSTRUCTION, // vías de comunicación
  '6-2': CONSTRUCTION, // edificaciones
  '6-3': CONSTRUCTION, // obras hidráulicas, eléctricas y sanitarias
  '6-4': CONSTRUCTION, // obras urbanísticas
  '6-5': ENERGY, // instalaciones de transmisión y distribución
  '6-6': 'agroindustry', // mejoras de tierras y plantaciones
  '6-7': ENERGY, // perforaciones y exploraciones mineras
  '6-8': CONSTRUCTION, // reparaciones mayores y extraordinarias
  '6-9': CONSTRUCTION, // instalación de servicios locales
  // ── Tecnología y productos exclusivos de entes ──
  '10-43': 'technology', // infraestructura tecnológica
  '12-1': ENERGY, // productos de uso exclusivo de UTE
  '12-2': ENERGY, // productos de uso exclusivo de ANCAP
  '12-3': 'technology', // productos de uso exclusivo de ANTEL
});

/** Clase «familia-subfamilia-clase» → macro. Manda sobre su subfamilia. */
export const UY_ARCE_CLASS_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '2-1-1': 'agroindustry', // alimentos de origen agropecuario
  '2-1-2': 'agroindustry', // alimentos provenientes de la pesca
  '2-1-8': 'agroindustry', // semillas
  '2-6-2': ENERGY, // lubricantes y grasas
  '2-6-3': 'agroindustry', // abonos, fertilizantes, insecticidas
  '2-6-4': HEALTH, // productos químicos, medicinales y farmacéuticos
  '2-6-8': ENERGY, // productos bituminosos
  '2-9-3': MANUFACTURING, // útiles y accesorios eléctricos
  // Cuelga de «máquinas y equipos de oficina» (4-2 → Tecnología) pero son equipos
  // eléctricos (Conagro, Biclima): Industria. Decisión de la dueña, 13-10-2026.
  '4-2-6': MANUFACTURING, // equipos de servicio eléctrico y accesorios
  '2-9-4': HEALTH, // útiles menores médico-quirúrgicos
  '3-1-1': 'technology', // teléfono, telégrafo y similares
  '3-1-2': TRANSPORT, // correspondencia y encomiendas dentro del país
  '3-1-3': TRANSPORT, // correspondencia y encomiendas fuera del país
  '3-1-4': ENERGY, // aprovisionamiento de agua
  '3-3-1': TRANSPORT, // pasajes terrestres dentro del país
  '3-3-2': TRANSPORT, // pasajes aéreos dentro del país
  '3-3-3': TRANSPORT, // pasajes terrestres fuera del país
  '3-3-4': TRANSPORT, // pasajes aéreos fuera del país
  '3-3-5': TRANSPORT, // pasajes marítimos fuera del país
  '3-3-10': TRANSPORT, // pasajes aéreos, marítimos y terrestres fuera del país
  '3-5-1': CONSTRUCTION, // arrendamiento de inmuebles
  '3-5-5': CONSTRUCTION, // arrendamiento de máquinas de construcción
  '3-5-6': TRANSPORT, // arrendamiento de equipos de transporte
  '3-6-1': FINANCE, // primas de seguros dentro del país
  '3-6-2': FINANCE, // primas de seguros fuera del país
  '3-6-4': FINANCE, // comisiones bancarias y de cambio
  '3-7-1': CONSTRUCTION, // mantenimiento de inmuebles
  '3-7-2': CONSTRUCTION, // mantenimiento de instalaciones
  '3-8-2': HEALTH, // contratación de servicios médicos
  '3-9-1': SERVICES, // limpieza
  '3-9-2': SERVICES, // vigilancia
  '3-9-4': CONSTRUCTION, // servicios de instalación
});

/** Subfamilias «otros» que sólo clasifican por clase. */
const CLASS_ONLY_SUBFAMILIES: ReadonlySet<string> = new Set(['2-9', '3-1', '3-3', '3-5', '3-6', '3-9']);

/** Macro de un artículo por su familia, subfamilia y clase; `null` si no tiene. */
export function uyArceItemMacro(family: number, subfamily: number, klass: number): MacroIndustryKey | null {
  const byClass = UY_ARCE_CLASS_MACRO[`${family}-${subfamily}-${klass}`];
  if (byClass !== undefined) return byClass;
  const sub = `${family}-${subfamily}`;
  if (CLASS_ONLY_SUBFAMILIES.has(sub)) return null;
  return UY_ARCE_SUBFAMILY_MACRO[sub] ?? null;
}

/** Monto adjudicado por clase: [familia, subfamilia, clase, USD]. */
export type UyArceClassAmount = readonly [number, number, number, number];

/**
 * Macro de un proveedor: la de su rubro dominante por monto, si pesa al menos la
 * mitad de todo lo adjudicado. `null` si vende de todo o lo dominante no tiene macro.
 */
export function resolveUyArceSupplierMacro(classes: readonly UyArceClassAmount[]): {
  macro: MacroIndustryKey;
  share: number;
  family: number;
  subfamily: number;
  klass: number;
} | null {
  const byMacro = new Map<MacroIndustryKey | null, number>();
  let total = 0;
  for (const [family, subfamily, klass, usd] of classes) {
    if (!(usd > 0)) continue;
    total += usd;
    const macro = uyArceItemMacro(family, subfamily, klass);
    byMacro.set(macro, (byMacro.get(macro) ?? 0) + usd);
  }
  if (total <= 0) return null;
  let best: MacroIndustryKey | null = null;
  let bestUsd = -1;
  for (const [macro, usd] of byMacro) {
    if (usd > bestUsd) {
      best = macro;
      bestUsd = usd;
    }
  }
  if (best === null || bestUsd / total < UY_ARCE_DOMINANT_MIN_SHARE) return null;
  // El rubro que se muestra: la clase de más monto dentro de esa macro.
  const top = [...classes]
    .filter(([f, s, k, usd]) => usd > 0 && uyArceItemMacro(f, s, k) === best)
    .sort((a, b) => b[3] - a[3])[0];
  return { macro: best, share: bestUsd / total, family: top[0], subfamily: top[1], klass: top[2] };
}

/** Macro de la capa de Gobierno (entidades públicas de la UAIP e intendencias). */
export const UY_PUBLIC_ENTITY_MACRO_KEY = 'government' as const;

/**
 * ¿Tiene la macro alguna clase o subfamilia en la tabla (o es Gobierno)? Una macro
 * sin cobertura no consulta: nunca una muestra genérica.
 */
export function macroHasUyArceCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  if (macroIndustryKey === UY_PUBLIC_ENTITY_MACRO_KEY) return true;
  return (
    Object.values(UY_ARCE_SUBFAMILY_MACRO).includes(macroIndustryKey as MacroIndustryKey) ||
    Object.values(UY_ARCE_CLASS_MACRO).includes(macroIndustryKey as MacroIndustryKey)
  );
}

/** Macro de HOY para la clase «f-s-k» guardada en la fila, o `null`. */
export function resolveUyArceClassMacro(siceClass: string | null | undefined): MacroIndustryKey | null {
  const match = /^(\d+)-(\d+)-(\d+)$/.exec(siceClass?.trim() ?? '');
  if (match === null) return null;
  return uyArceItemMacro(Number(match[1]), Number(match[2]), Number(match[3]));
}
