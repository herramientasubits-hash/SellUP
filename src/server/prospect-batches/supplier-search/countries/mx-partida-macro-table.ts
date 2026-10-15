/**
 * mx-partida-macro-table.ts — qué macro industria corresponde a un proveedor mexicano del
 * Estado según LO QUE LE VENDE: la «Partida específica» del Clasificador por Objeto del
 * Gasto (COG) de sus contratos en Compras MX (datos abiertos, contratos 2025 y 2026).
 *
 * ✅ APROBADA por la dueña el 15-10-2026 (AGENT1-SUPPLIER-SEARCH-MX-1).
 * Cambiarla es una decisión de producto.
 *
 * Por qué partidas: el CSV de Compras MX no trae UNSPSC ni CUCOP por ítem; sólo la partida
 * del gasto (5 dígitos, a veces varias por contrato). La familia es la PARTIDA GENÉRICA
 * (sus 3 primeros dígitos: 253 = medicinas); el lector reparte el monto de la línea en
 * partes iguales entre sus partidas. Mismo criterio que las tablas aprobadas (UNSPSC de
 * Paraguay, rubros de Argentina): quien revende informática o insumos médicos va a
 * Tecnología o Salud; útiles, limpieza, ferretería y refacciones, a Comercio; vehículos a
 * Comercio; uniformes, mobiliario, material eléctrico y químicos, a Manufactura.
 *
 * Una excepción por comprador: la 339 («servicios profesionales, científicos, técnicos
 * integrales y otros») pesa el 13 % del monto y, medido el 15-10, el 85 % lo compran
 * IMSS, ISSSTE e IMSS-Bienestar a integradores médicos (Vayam Medical, Birmex, Vitalmex,
 * Falcon). El lector la marca «339S» cuando el comprador es de un ramo de salud (Salud,
 * IMSS, ISSSTE, IMSS-Bienestar) ⇒ Salud; con cualquier otro comprador queda «339» sin macro.
 *
 * Regla del 50 %: la macro de la empresa es la que suma más monto, sólo si pesa al menos
 * la mitad del total. Una partida sin macro (subsidios, viáticos, eventos, impuestos,
 * equipo de defensa, mercancías para revender) cuenta en el total pero no clasifica.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import type { ProcurementClassifier } from '../procurement-links';

export const MX_PARTIDA_MACRO_TABLE_VERSION = 'mx-cog-partida-macro-v1' as const;

/** Aprobada por la dueña el 15-10-2026. */
export const MX_PARTIDA_MACRO_TABLE_APPROVED = true;

export const MX_PARTIDA_DOMINANT_MIN_SHARE = 0.5;

/** Familia de la 339 cuando la compra un ramo de salud (la pone el lector). */
export const MX_HEALTH_INTEGRATED_SERVICES_FAMILY = '339S' as const;

const MANUFACTURING = 'industry_manufacturing_chemicals_automotive' as const;
const ENERGY = 'energy_mining_environment' as const;
const CONSTRUCTION = 'property_construction' as const;
const SERVICES = 'services_company' as const;
const FINANCE = 'insurance_financial_services' as const;
const TRANSPORT = 'transport_logistics' as const;

type Entry = readonly [MacroIndustryKey | null, string];

/**
 * Partida genérica (3 dígitos del COG federal) → [macro, nombre]. `null` = sin macro.
 * Entre comentarios, millones de pesos de oct-2025 a oct-2026 (medido el 15-10-2026,
 * sólo personas morales) cuando la partida pesa.
 */
export const MX_PARTIDA_MACRO: Readonly<Record<string, Entry>> = Object.freeze({
  // 1000 — servicios personales (lo que se compra a terceros: seguros y vales)
  '122': [null, 'Sueldos al personal eventual'],
  '141': [null, 'Aportaciones de seguridad social'],
  '144': [FINANCE, 'Aportaciones para seguros'], // 15.353 — seguros de vida y gastos médicos
  '154': [FINANCE, 'Prestaciones contractuales'], // 7.363 — vales de despensa
  '155': [SERVICES, 'Apoyos a la capacitación de los servidores públicos'],
  '159': [FINANCE, 'Otras prestaciones sociales y económicas'], // 10.904 — vales electrónicos
  '171': [null, 'Estímulos'],
  // 2000 — materiales y suministros
  '211': ['retail', 'Materiales, útiles y equipos menores de oficina'],
  '212': ['retail', 'Materiales y útiles de impresión y reproducción'],
  '213': [null, 'Material estadístico y geográfico'],
  '214': ['technology', 'Materiales y equipos menores de tecnologías de la información'],
  '215': [SERVICES, 'Material impreso e información digital'],
  '216': ['retail', 'Material de limpieza'],
  '217': ['retail', 'Materiales y útiles de enseñanza'],
  '218': [null, 'Materiales para el registro e identificación de bienes y personas'],
  '221': ['consumer_goods', 'Productos alimenticios para personas'], // 10.858
  '222': ['agroindustry', 'Productos alimenticios para animales'],
  '223': ['retail', 'Utensilios para el servicio de alimentación'],
  '231': ['agroindustry', 'Productos alimenticios, agropecuarios y forestales adquiridos como materia prima'],
  '232': [MANUFACTURING, 'Insumos textiles adquiridos como materia prima'],
  '233': [MANUFACTURING, 'Productos de papel, cartón e impresos adquiridos como materia prima'],
  '234': [ENERGY, 'Combustibles, lubricantes y aditivos adquiridos como materia prima'],
  '235': [MANUFACTURING, 'Productos químicos, farmacéuticos y de laboratorio adquiridos como materia prima'],
  '236': [MANUFACTURING, 'Productos metálicos y a base de minerales no metálicos adquiridos como materia prima'],
  '237': [MANUFACTURING, 'Productos de cuero, piel, plástico y hule adquiridos como materia prima'],
  '238': [null, 'Mercancías adquiridas para su comercialización'],
  '239': [null, 'Otros productos adquiridos como materia prima'],
  '241': [CONSTRUCTION, 'Productos minerales no metálicos'],
  '242': [CONSTRUCTION, 'Cemento y productos de concreto'],
  '243': [CONSTRUCTION, 'Cal, yeso y productos de yeso'],
  '244': [CONSTRUCTION, 'Madera y productos de madera'],
  '245': [MANUFACTURING, 'Vidrio y productos de vidrio'],
  '246': [MANUFACTURING, 'Material eléctrico y electrónico'],
  '247': [CONSTRUCTION, 'Artículos metálicos para la construcción'],
  '248': [CONSTRUCTION, 'Materiales complementarios'],
  '249': [CONSTRUCTION, 'Otros materiales y artículos de construcción y reparación'],
  '251': [MANUFACTURING, 'Productos químicos básicos'],
  '252': ['agroindustry', 'Fertilizantes, pesticidas y otros agroquímicos'],
  '253': ['health_pharma', 'Medicinas y productos farmacéuticos'], // 83.456
  '254': ['health_pharma', 'Materiales, accesorios y suministros médicos'], // 22.519
  '255': ['health_pharma', 'Materiales, accesorios y suministros de laboratorio'],
  '256': [MANUFACTURING, 'Fibras sintéticas, hules, plásticos y derivados'],
  '259': [MANUFACTURING, 'Otros productos químicos'],
  '261': [ENERGY, 'Combustibles, lubricantes y aditivos'], // 7.820
  '262': [ENERGY, 'Carbón y sus derivados'],
  '271': [MANUFACTURING, 'Vestuario y uniformes'],
  '272': [MANUFACTURING, 'Prendas de seguridad y protección personal'],
  '273': ['retail', 'Artículos deportivos'],
  '274': [MANUFACTURING, 'Productos textiles'],
  '275': [MANUFACTURING, 'Blancos y otros productos textiles, excepto prendas de vestir'],
  '281': [null, 'Sustancias y materiales explosivos'],
  '282': ['retail', 'Materiales de seguridad pública'],
  '283': ['retail', 'Prendas de protección para seguridad pública y nacional'],
  '291': [MANUFACTURING, 'Herramientas menores'],
  '292': ['retail', 'Refacciones y accesorios menores de edificios'],
  '293': ['retail', 'Refacciones y accesorios menores de mobiliario y equipo'],
  '294': ['technology', 'Refacciones y accesorios menores de equipo de cómputo y tecnologías de la información'],
  '295': ['health_pharma', 'Refacciones y accesorios menores de equipo e instrumental médico y de laboratorio'],
  '296': ['retail', 'Refacciones y accesorios menores de equipo de transporte'],
  '297': [null, 'Refacciones y accesorios menores de equipo de defensa y seguridad'],
  '298': ['retail', 'Refacciones y accesorios menores de maquinaria y otros equipos'],
  '299': ['retail', 'Refacciones y accesorios menores otros bienes muebles'],
  // 3000 — servicios generales
  '311': [ENERGY, 'Energía eléctrica'],
  '312': [ENERGY, 'Gas'],
  '313': [ENERGY, 'Agua'],
  '314': ['technology', 'Telefonía tradicional'],
  '315': ['technology', 'Telefonía celular'],
  '316': ['technology', 'Servicios de telecomunicaciones y satélites'],
  '317': ['technology', 'Servicios de acceso de internet, redes y procesamiento de información'], // 6.888
  '318': [TRANSPORT, 'Servicios postales y telegráficos'],
  '319': ['technology', 'Servicios integrales y otros servicios'], // 8.061 — centros de datos e integración de telecomunicaciones
  '321': [CONSTRUCTION, 'Arrendamiento de terrenos'],
  '322': [CONSTRUCTION, 'Arrendamiento de edificios'],
  '323': ['technology', 'Arrendamiento de mobiliario y equipo de administración, educacional y recreativo'], // 5.042 — cómputo y fotocopiado
  '324': ['health_pharma', 'Arrendamiento de equipo e instrumental médico y de laboratorio'],
  '325': [TRANSPORT, 'Arrendamiento de equipo de transporte'],
  '326': [MANUFACTURING, 'Arrendamiento de maquinaria, otros equipos y herramientas'],
  '327': ['technology', 'Arrendamiento de activos intangibles'], // licencias de software
  '329': [null, 'Otros arrendamientos'],
  '331': [SERVICES, 'Servicios legales, de contabilidad, auditoría y relacionados'],
  '332': [SERVICES, 'Servicios de diseño, arquitectura, ingeniería y actividades relacionadas'],
  '333': ['technology', 'Servicios de consultoría administrativa, procesos, técnica y en tecnologías de la información'],
  '334': [SERVICES, 'Servicios de capacitación'],
  '335': [SERVICES, 'Servicios de investigación científica y desarrollo'],
  '336': [SERVICES, 'Servicios de apoyo administrativo, fotocopiado e impresión'],
  '337': [SERVICES, 'Servicios de protección y seguridad'],
  '338': [SERVICES, 'Servicios de vigilancia'], // 24.800
  '339': [null, 'Servicios profesionales, científicos, técnicos integrales y otros'],
  [MX_HEALTH_INTEGRATED_SERVICES_FAMILY]: ['health_pharma', 'Servicios integrales médicos (sector salud)'], // ~65.000
  '341': [FINANCE, 'Servicios financieros y bancarios'],
  '343': [SERVICES, 'Servicios de recaudación, traslado y custodia de valores'],
  '344': [FINANCE, 'Seguros de responsabilidad patrimonial y fianzas'],
  '345': [FINANCE, 'Seguro de bienes patrimoniales'], // 9.850
  '346': [TRANSPORT, 'Almacenaje, envase y embalaje'],
  '347': [TRANSPORT, 'Fletes y maniobras'],
  '351': [CONSTRUCTION, 'Conservación y mantenimiento menor de inmuebles'], // 11.958
  '352': [SERVICES, 'Instalación, reparación y mantenimiento de mobiliario y equipo de administración'],
  '353': ['technology', 'Instalación, reparación y mantenimiento de equipo de cómputo y tecnologías de la información'],
  '354': ['health_pharma', 'Instalación, reparación y mantenimiento de equipo e instrumental médico y de laboratorio'],
  '355': [SERVICES, 'Reparación y mantenimiento de equipo de transporte'],
  '356': [null, 'Reparación y mantenimiento de equipo de defensa y seguridad'],
  '357': [SERVICES, 'Instalación, reparación y mantenimiento de maquinaria, otros equipos y herramienta'], // 11.363
  '358': [SERVICES, 'Servicios de limpieza y manejo de desechos'], // 24.520
  '359': [SERVICES, 'Servicios de jardinería y fumigación'],
  '361': [SERVICES, 'Difusión por radio, televisión y otros medios de mensajes sobre programas y actividades gubernamentales'],
  '362': [SERVICES, 'Difusión por radio, televisión y otros medios de mensajes comerciales'],
  '363': [SERVICES, 'Servicios de creatividad, preproducción y producción de publicidad'],
  '365': [SERVICES, 'Servicios de la industria fílmica, del sonido y del video'],
  '369': [SERVICES, 'Otros servicios de información'],
  '371': [TRANSPORT, 'Pasajes aéreos'],
  '372': [TRANSPORT, 'Pasajes terrestres'],
  '373': [TRANSPORT, 'Pasajes marítimos, lacustres y fluviales'],
  '375': [null, 'Viáticos en el país'],
  '377': [TRANSPORT, 'Gastos de instalación y traslado de menaje'],
  '381': [null, 'Gastos de ceremonial'],
  '382': [null, 'Gastos de orden social y cultural'],
  '383': [null, 'Congresos y convenciones'],
  '384': [null, 'Exposiciones'],
  '385': [null, 'Gastos de representación'],
  '391': [null, 'Servicios funerarios y de cementerios'],
  '392': [null, 'Impuestos y derechos'],
  '394': [null, 'Sentencias y resoluciones por autoridad competente'],
  '396': [null, 'Otros gastos por responsabilidades'],
  // 4000 — transferencias, subsidios y ayudas: nunca clasifican
  '431': [null, 'Subsidios a la producción'],
  '434': [null, 'Subsidios a la prestación de servicios públicos'],
  '437': [null, 'Subvenciones al consumo'],
  '438': [null, 'Subsidios a entidades federativas y municipios'],
  '439': [null, 'Otros subsidios'],
  '441': [null, 'Ayudas sociales a personas'],
  '444': [null, 'Ayudas sociales a actividades científicas o académicas'],
  '448': [null, 'Ayudas por desastres naturales y otros siniestros'],
  '482': [null, 'Donativos a entidades federativas'],
  // 5000 — bienes muebles, inmuebles e intangibles
  '511': [MANUFACTURING, 'Muebles de oficina y estantería'],
  '512': [MANUFACTURING, 'Muebles, excepto de oficina y estantería'],
  '513': [null, 'Bienes artísticos, culturales y científicos'],
  '515': ['technology', 'Equipo de cómputo y de tecnologías de la información'],
  '519': [MANUFACTURING, 'Otros mobiliarios y equipos de administración'],
  '521': ['technology', 'Equipos y aparatos audiovisuales'],
  '522': ['retail', 'Aparatos deportivos'],
  '523': ['technology', 'Cámaras fotográficas y de video'],
  '529': [null, 'Otro mobiliario y equipo educacional y recreativo'],
  '531': ['health_pharma', 'Equipo médico y de laboratorio'], // 9.273
  '532': ['health_pharma', 'Instrumental médico y de laboratorio'],
  '541': ['retail', 'Vehículos y equipo terrestre'],
  '542': ['retail', 'Carrocerías y remolques'],
  // Trenes (Alstom, Hitachi Rail, Siemens Mobility): los hace el fabricante, no un concesionario.
  '544': [MANUFACTURING, 'Equipo ferroviario'], // 17.455
  '545': ['retail', 'Embarcaciones'],
  '549': ['retail', 'Otros equipos de transporte'],
  '551': [null, 'Equipo de defensa y seguridad'],
  '561': ['agroindustry', 'Maquinaria y equipo agropecuario'],
  '562': [MANUFACTURING, 'Maquinaria y equipo industrial'],
  '563': [MANUFACTURING, 'Maquinaria y equipo de construcción'],
  '564': [MANUFACTURING, 'Sistemas de aire acondicionado, calefacción y de refrigeración industrial y comercial'],
  '565': ['technology', 'Equipo de comunicación y telecomunicación'],
  '566': [MANUFACTURING, 'Equipos de generación eléctrica, aparatos y accesorios eléctricos'],
  '567': [MANUFACTURING, 'Herramientas y máquinas-herramienta'],
  '569': [null, 'Otros equipos'],
  '578': ['agroindustry', 'Árboles y plantas'],
  '591': ['technology', 'Software'],
  '597': ['technology', 'Licencias informáticas e intelectuales'],
  // 6000 — inversión pública: obra
  '611': [CONSTRUCTION, 'Edificación habitacional'],
  '612': [CONSTRUCTION, 'Edificación no habitacional'],
  '613': [CONSTRUCTION, 'Construcción de obras para el abastecimiento de agua, petróleo, gas, electricidad y telecomunicaciones'],
  '614': [CONSTRUCTION, 'División de terrenos y construcción de obras de urbanización'],
  '615': [CONSTRUCTION, 'Construcción de vías de comunicación'],
  '616': [CONSTRUCTION, 'Otras construcciones de ingeniería civil u obra pesada'],
  '617': [CONSTRUCTION, 'Instalaciones y equipamiento en construcciones'],
  '619': [CONSTRUCTION, 'Trabajos de acabados en edificaciones y otros trabajos especializados'],
  '621': [CONSTRUCTION, 'Edificación habitacional (bienes propios)'],
  '622': [CONSTRUCTION, 'Edificación no habitacional (bienes propios)'], // 16.958
  '623': [CONSTRUCTION, 'Construcción de obras para el abastecimiento de agua (bienes propios)'],
  '624': [CONSTRUCTION, 'División de terrenos y obras de urbanización (bienes propios)'],
  '625': [CONSTRUCTION, 'Construcción de vías de comunicación (bienes propios)'], // 27.928
  '626': [CONSTRUCTION, 'Otras construcciones de ingeniería civil u obra pesada (bienes propios)'], // 107.352
  '627': [CONSTRUCTION, 'Instalaciones y equipamiento en construcciones (bienes propios)'],
  '629': [CONSTRUCTION, 'Trabajos de acabados, estudios y supervisión de obra'],
  '631': [CONSTRUCTION, 'Estudios, formulación y evaluación de proyectos productivos'],
  '632': [CONSTRUCTION, 'Ejecución de proyectos productivos'],
  '831': [null, 'Participaciones'],
});

/** Partida específica («25301», «339 01») → familia (partida genérica de 3 dígitos), o `null`. */
export function mxPartidaFamily(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 3 ? digits.slice(0, 3) : null;
}

/** Las partidas de una línea («25401, 25501, 25901») como familias sin repetir. */
export function splitMxPartidas(raw: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const part of (raw ?? '').split(',')) {
    const family = mxPartidaFamily(part);
    if (family) out.add(family);
  }
  return [...out];
}

export function resolveMxPartidaSupplierMacro(
  amountByFamily: Readonly<Record<string, number>>,
): { macroIndustryKey: MacroIndustryKey; share: number } | null {
  const byMacro = new Map<MacroIndustryKey, number>();
  let total = 0;
  for (const [family, amount] of Object.entries(amountByFamily)) {
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
    const macro = MX_PARTIDA_MACRO[family]?.[0] ?? null;
    if (macro !== null) byMacro.set(macro, (byMacro.get(macro) ?? 0) + amount);
  }
  if (total <= 0) return null;
  let best: { macroIndustryKey: MacroIndustryKey; share: number } | null = null;
  for (const [macro, amount] of byMacro) {
    const share = amount / total;
    if (best === null || share > best.share) best = { macroIndustryKey: macro, share };
  }
  return best !== null && best.share >= MX_PARTIDA_DOMINANT_MIN_SHARE ? best : null;
}

export const MX_PARTIDA_CLASSIFIER: ProcurementClassifier = {
  tableVersion: MX_PARTIDA_MACRO_TABLE_VERSION,
  classify: (amountByFamily) => resolveMxPartidaSupplierMacro(amountByFamily),
  rubroOf: (family) => (family ? (MX_PARTIDA_MACRO[family]?.[1] ?? null) : null),
};
