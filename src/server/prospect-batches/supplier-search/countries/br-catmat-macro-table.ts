/**
 * ✅ APROBADA por la dueña el 15-10-2026 (AGENT1-SUPPLIER-SEARCH-ALL-1).
 * Cambiarla es una decisión de producto.
 *
 * Brasil — qué macro industria corresponde a un proveedor según LO QUE LE VENDE A LA
 * ENTIDAD en Compras.gov.br: el catálogo de cada ítem del contrato.
 *
 *   - Material (CATMAT): la clase de 4 dígitos sigue la Federal Supply Classification;
 *     sus dos primeros dígitos son el GRUPO (79 grupos, `1_consultarGrupoMaterial`).
 *   - Serviço (CATSER): la clase de 4 dígitos empieza por la DIVISIÓN (40 divisiones,
 *     `2_consultarDivisaoServico`), que sigue la CPC de la ONU.
 *
 * La familia se guarda como «M6550» (material, clase 6550) o «S1821» (servicio, clase
 * 1821). Mismas decisiones que la tabla UNSPSC aprobada de Paraguay (`py-dncp-macro-table.ts`):
 * quien revende informática o equipo médico va a Tecnología o Salud; vehículos y equipo
 * de oficina, seguridad y limpieza a Comercio; comida y alojamiento, educación,
 * publicaciones, asociaciones y administración pública NO tienen macro (nunca se ofrecen).
 * Regla del 50 %: la macro que suma más monto, sólo si pesa al menos la mitad.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import type { ProcurementClassifier } from '../procurement-links';

/** Versión de la tabla (aprobada por la dueña el 15-10-2026). */
export const BR_CATMAT_MACRO_TABLE_VERSION = 'br-catmat-catser-macro-v1' as const;

/** Peso mínimo de la macro dominante (monto) para clasificar al proveedor. */
export const BR_CATMAT_DOMINANT_MIN_SHARE = 0.5;

const MANUFACTURING = 'industry_manufacturing_chemicals_automotive' as const;
const ENERGY = 'energy_mining_environment' as const;

/** Grupo CATMAT (2 dígitos) → macro industria. */
export const BR_CATMAT_GROUP_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '10': MANUFACTURING, // armamento
  '11': MANUFACTURING, // materiales bélicos nucleares
  '12': MANUFACTURING, // equipos de tiro
  '13': MANUFACTURING, // municiones y explosivos
  '14': MANUFACTURING, // misiles guiados
  '15': MANUFACTURING, // aeronaves y sus componentes estructurales
  '16': MANUFACTURING, // componentes y accesorios de aeronaves
  '17': MANUFACTURING, // equipos de lanzamiento, aterrizaje y maniobra de aeronaves
  '18': MANUFACTURING, // vehículos espaciales
  '19': MANUFACTURING, // buques, embarcaciones y diques flotantes
  '20': MANUFACTURING, // equipos para buques
  '22': MANUFACTURING, // equipos ferroviarios
  '23': 'retail', // vehículos (concesionarios, como Paraguay)
  '24': 'agroindustry', // tractores
  '25': 'retail', // componentes de vehículos
  '26': 'retail', // neumáticos
  '28': MANUFACTURING, // motores y turbinas
  '29': MANUFACTURING, // accesorios de motores
  '30': MANUFACTURING, // transmisión de fuerza mecánica
  '31': MANUFACTURING, // rodamientos
  '32': MANUFACTURING, // máquinas para madera
  '34': MANUFACTURING, // máquinas para metales
  '35': 'retail', // equipos comerciales y de servicios (cocinas, lavanderías)
  '36': MANUFACTURING, // máquinas para industrias especializadas
  '37': 'agroindustry', // máquinas y equipos agrícolas
  '38': 'property_construction', // construcción, minería, movimiento de tierras y vías
  '39': MANUFACTURING, // manipulación de materiales
  '40': MANUFACTURING, // cuerdas, cables y cadenas
  '41': MANUFACTURING, // refrigeración y aire acondicionado
  '42': 'retail', // combate a incendios, rescate y seguridad
  '43': MANUFACTURING, // bombas y compresores
  '44': MANUFACTURING, // hornos, calderas y secado
  '45': MANUFACTURING, // instalaciones hidráulicas y calefacción
  '46': MANUFACTURING, // purificación de agua y tratamiento de aguas residuales
  '47': MANUFACTURING, // caños, tubos y mangueras
  '48': MANUFACTURING, // válvulas
  '49': MANUFACTURING, // equipos para talleres de mantenimiento
  '51': MANUFACTURING, // herramientas manuales
  '52': MANUFACTURING, // instrumentos de medición
  '53': MANUFACTURING, // ferretería y abrasivos
  '54': 'property_construction', // estructuras y andamios prefabricados
  '55': 'property_construction', // tablas, aberturas y maderas
  '56': 'property_construction', // materiales de construcción
  '58': 'technology', // comunicaciones, detección y radiación coherente
  '59': MANUFACTURING, // componentes eléctricos y electrónicos
  '60': 'technology', // fibra óptica
  '61': ENERGY, // conductores eléctricos, generación y distribución de energía
  '62': MANUFACTURING, // iluminación y lámparas
  '63': 'retail', // alarmas, señalización y detección para seguridad
  '64': 'health_pharma', // medicamentos, drogas y productos biológicos
  '65': 'health_pharma', // equipos y artículos médicos, odontológicos y veterinarios
  '66': 'health_pharma', // instrumentos y equipos de laboratorio
  '67': 'technology', // equipos fotográficos
  '68': MANUFACTURING, // sustancias y productos químicos
  '69': 'retail', // aparatos para entrenamiento
  '70': 'technology', // informática: equipos, piezas, accesorios y suministros de TIC
  '71': MANUFACTURING, // mobiliario
  '72': 'retail', // utensilios de uso doméstico y comercial
  '73': 'retail', // equipos para preparar y servir alimentos
  '74': 'retail', // máquinas de oficina
  '75': 'retail', // útiles de oficina y material de expediente
  '77': 'retail', // instrumentos musicales y radios domésticas
  '78': 'retail', // recreación y deportes
  '79': 'retail', // equipos y materiales de limpieza
  '80': MANUFACTURING, // pinceles, pinturas, sellantes y adhesivos
  '81': MANUFACTURING, // recipientes y embalaje
  '83': MANUFACTURING, // tejidos, cueros, carpas y banderas
  '84': MANUFACTURING, // vestuario, equipo individual e insignias
  '85': 'consumer_goods', // artículos de higiene
  '87': 'agroindustry', // suministros agrícolas
  '88': 'agroindustry', // animales vivos
  '89': 'consumer_goods', // alimentos (subsistencia)
  '91': ENERGY, // combustibles, lubricantes, aceites y ceras
  '93': MANUFACTURING, // materiales manufacturados no metálicos
  '94': MANUFACTURING, // materias primas no metálicas
  '95': MANUFACTURING, // barras, chapas y perfiles metálicos
  '96': ENERGY, // minerales y sus productos primarios
  // '76' libros y publicaciones, '99' diversos: sin macro.
});

/** División CATSER (2 dígitos) → macro industria. */
export const BR_CATSER_DIVISION_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '11': 'technology', // desarrollo, mantenimiento y sostenimiento de software
  '13': 'technology', // computación en la nube
  '14': 'technology', // telecomunicaciones y telefonía
  '15': 'technology', // outsourcing de impresión
  '16': 'technology', // infraestructura de TIC
  '17': 'technology', // datos, consultoría y proyectos de TIC
  '18': 'technology', // licenciamiento de software y transferencia de tecnología
  '54': 'property_construction', // construcción
  '61': 'retail', // comercio mayorista
  '62': 'retail', // comercio minorista
  '64': 'transport_logistics', // transporte terrestre
  '65': 'transport_logistics', // transporte acuático
  '66': 'transport_logistics', // transporte aéreo
  '67': 'transport_logistics', // transporte auxiliar y de soporte
  '68': 'transport_logistics', // servicio postal y de mensajería
  '69': ENERGY, // distribución de electricidad, gas y agua por tubería
  '71': 'insurance_financial_services', // intermediación financiera y seguros
  '72': 'property_construction', // servicios inmobiliarios
  '73': 'services_company', // arrendamiento o alquiler sin operador
  '80': 'technology', // TIC (sección 8)
  '81': 'services_company', // investigación y desarrollo
  '82': 'services_company', // jurídicos y contables
  '83': 'services_company', // otros servicios profesionales y técnicos (ingeniería, publicidad, consultoría)
  '84': 'technology', // recuperación y suministro de información
  '85': 'services_company', // soporte (limpieza, vigilancia, personal, centrales de llamadas)
  '86': 'agroindustry', // servicios agrícolas, forestales, pesqueros y mineros
  '87': 'services_company', // mantenimiento, reparación e instalación (excepto construcción)
  '88': MANUFACTURING, // manufactura sobre insumos de terceros
  '89': MANUFACTURING, // otros servicios de manufactura
  '93': 'health_pharma', // servicios sociales y de salud
  '94': ENERGY, // alcantarillado, residuos, saneamiento y protección ambiental
  // '63' alojamiento y comida, '91' administración pública, '92' educación,
  // '95' asociaciones, '96' recreación y cultura, '97' otros, '98' domésticos,
  // '99' extraterritoriales: sin macro.
});

/** Rubro en palabras de un grupo de material. */
const BR_CATMAT_GROUP_RUBRO: Readonly<Record<string, string>> = Object.freeze({
  '23': 'Vehículos',
  '25': 'Repuestos de vehículos',
  '38': 'Maquinaria de construcción',
  '42': 'Equipos de seguridad y rescate',
  '56': 'Materiales de construcción',
  '58': 'Equipos de comunicaciones',
  '61': 'Equipos eléctricos y de energía',
  '64': 'Medicamentos',
  '65': 'Equipos y artículos médicos',
  '66': 'Equipos de laboratorio',
  '68': 'Productos químicos',
  '70': 'Equipos de informática',
  '71': 'Mobiliario',
  '75': 'Útiles de oficina',
  '79': 'Artículos de limpieza',
  '84': 'Vestuario y equipo individual',
  '85': 'Artículos de higiene',
  '89': 'Alimentos',
  '91': 'Combustibles y lubricantes',
});

/** Rubro en palabras de una clase de material que su grupo no distingue. */
const BR_CATMAT_CLASS_RUBRO: Readonly<Record<string, string>> = Object.freeze({
  '6505': 'Medicamentos',
  '6508': 'Medicamentos',
  '6510': 'Material quirúrgico',
  '6515': 'Instrumental y equipo médico',
  '6525': 'Equipos de imagen médica',
  '6532': 'Ropa hospitalaria',
  '6550': 'Reactivos de diagnóstico',
  '7010': 'Equipos de informática',
  '7020': 'Equipos de informática',
  '7030': 'Software',
  '7035': 'Equipos de informática',
});

/** Rubro en palabras de una división de servicio. */
const BR_CATSER_DIVISION_RUBRO: Readonly<Record<string, string>> = Object.freeze({
  '11': 'Desarrollo y soporte de software',
  '13': 'Servicios en la nube',
  '14': 'Telecomunicaciones',
  '15': 'Outsourcing de impresión',
  '16': 'Infraestructura de TI',
  '17': 'Consultoría y proyectos de TI',
  '18': 'Licencias de software',
  '54': 'Obras de construcción',
  '64': 'Transporte terrestre',
  '66': 'Transporte aéreo',
  '67': 'Servicios logísticos',
  '71': 'Servicios financieros y seguros',
  '73': 'Alquiler de equipos y vehículos',
  '80': 'Servicios de TI',
  '83': 'Servicios profesionales y técnicos',
  '85': 'Limpieza, vigilancia y apoyo',
  '87': 'Mantenimiento e instalación',
  '93': 'Servicios de salud',
  '94': 'Saneamiento y medio ambiente',
});

/** «Material» + 6550 → «M6550»; «Serviço» + 1821 → «S1821»; otra cosa ⇒ `null`. */
export function brCatalogFamily(tipoItem: unknown, classCode: unknown): string | null {
  const tipo = typeof tipoItem === 'string' ? tipoItem.trim().toUpperCase() : '';
  const code = typeof classCode === 'number' ? String(classCode) : typeof classCode === 'string' ? classCode.trim() : '';
  if (!/^\d{4}$/.test(code)) return null;
  if (tipo.startsWith('MATERIAL')) return `M${code}`;
  if (tipo.startsWith('SERVI')) return `S${code}`;
  return null;
}

/** Macro de UNA familia («M6550», «S1821»), o `null` si no tiene. */
export function resolveBrCatalogMacro(family: string | null | undefined): MacroIndustryKey | null {
  const match = /^([MS])(\d{2})\d{2}$/.exec((family ?? '').trim());
  if (!match) return null;
  return (match[1] === 'M' ? BR_CATMAT_GROUP_MACRO : BR_CATSER_DIVISION_MACRO)[match[2]] ?? null;
}

/** Rubro en palabras de una familia, o `null`. */
export function resolveBrCatalogRubro(family: string | null | undefined): string | null {
  const match = /^([MS])(\d{2})(\d{2})$/.exec((family ?? '').trim());
  if (!match) return null;
  if (match[1] === 'M') return BR_CATMAT_CLASS_RUBRO[`${match[2]}${match[3]}`] ?? BR_CATMAT_GROUP_RUBRO[match[2]] ?? null;
  return BR_CATSER_DIVISION_RUBRO[match[2]] ?? null;
}

/** Macro dominante por monto (regla del 50 %), o `null`. */
export function resolveBrCatalogSupplierMacro(
  amountByFamily: Readonly<Record<string, number>>,
): { macroIndustryKey: MacroIndustryKey; share: number } | null {
  const byMacro = new Map<MacroIndustryKey, number>();
  let total = 0;
  for (const [family, amount] of Object.entries(amountByFamily)) {
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
    const macro = resolveBrCatalogMacro(family);
    if (macro !== null) byMacro.set(macro, (byMacro.get(macro) ?? 0) + amount);
  }
  if (total <= 0) return null;
  let best: { macroIndustryKey: MacroIndustryKey; share: number } | null = null;
  for (const [macro, amount] of byMacro) {
    const share = amount / total;
    if (best === null || share > best.share) best = { macroIndustryKey: macro, share };
  }
  return best !== null && best.share >= BR_CATMAT_DOMINANT_MIN_SHARE ? best : null;
}

export const BR_CATMAT_CLASSIFIER: ProcurementClassifier = {
  tableVersion: BR_CATMAT_MACRO_TABLE_VERSION,
  classify: (amountByFamily) => resolveBrCatalogSupplierMacro(amountByFamily),
  rubroOf: (family) => resolveBrCatalogRubro(family),
};
