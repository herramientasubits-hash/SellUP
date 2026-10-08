/**
 * latam-curated-macro-table.ts — macro industria de una entrada de la capa común
 * de listas curadas (universidades, reguladores, bolsas, rankings).
 *
 * SOURCES-LATAM-CURATED-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * La macro sale del TIPO de lista cuando el regulador ya dice qué es la entidad:
 *   - universidad o colegio: PÚBLICO → Gobierno; PRIVADO → «Compañía de Servicios»
 *     (decisión de la dueña, 08-10-2026: el catálogo no tiene industria Educación
 *     y antes la educación privada quedaba sin macro);
 *   - aseguradora, banco o financiera supervisada → Seguros y Servicios Financieros;
 *   - prestador de salud habilitado → Salud.
 * Para el resto (emisores, exportadores, multinacionales, rankings) manda el
 * SECTOR que publica la lista: en inglés por la tabla de abajo y en español por la
 * tabla de actividades aprobada para CICR (`cr-cicr-macro-table.ts`, 08-10-2026),
 * que traduce texto libre a las mismas macros que la tabla CIIU por división.
 * Sin sector reconocible, `null`: la capa nunca ofrece una muestra genérica.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { CR_CICR_ACTIVITY_TABLE_VERSION, resolveCrCicrActivityMacro } from './cr-cicr-macro-table';

export const LATAM_CURATED_MACRO_TABLE_VERSION = `latam-curated-v1+proecuador+merco(${CR_CICR_ACTIVITY_TABLE_VERSION})` as const;

/** Qué es la entidad según la lista que la publica. */
export type LatamCuratedKind =
  | 'university'
  | 'school'
  | 'insurer'
  | 'bank'
  | 'financial'
  | 'health_provider'
  | 'listed_company'
  | 'exporter'
  | 'multinational'
  | 'ranking';

export const LATAM_CURATED_KINDS: ReadonlySet<string> = new Set<LatamCuratedKind>([
  'university', 'school', 'insurer', 'bank', 'financial', 'health_provider',
  'listed_company', 'exporter', 'multinational', 'ranking',
]);

/** Sectores en inglés (Pacto Global, Great Place to Work, rankings globales). */
const ENGLISH_SECTOR_RULES: readonly { macro: MacroIndustryKey; pattern: RegExp }[] = [
  { macro: 'technology', pattern: /software|computer|information technolog|\bit services\b|telecom|internet|technology hardware|semiconductor/ },
  { macro: 'insurance_financial_services', pattern: /\bbank|insurance|financial|investment|asset management|fintech|real estate investment/ },
  { macro: 'health_pharma', pattern: /pharma|health ?care|biotech|medical|hospital|life sciences/ },
  { macro: 'energy_mining_environment', pattern: /\boil\b|\bgas\b|mining|electricity|\butilities\b|renewable|energy|water|waste|environment/ },
  { macro: 'transport_logistics', pattern: /transport|logistic|airline|shipping|freight|\bports?\b|courier/ },
  { macro: 'property_construction', pattern: /construction|real estate|building materials|engineering & construction|housing/ },
  { macro: 'consumer_goods', pattern: /\bfood|beverage|tobacco|personal (care )?products|household goods|consumer goods/ },
  { macro: 'retail', pattern: /retail|wholesale|distribution|automobiles? dealer|e-?commerce/ },
  { macro: 'agroindustry', pattern: /agricultur|forestry|fishing|livestock|agribusiness/ },
  { macro: 'industry_manufacturing_chemicals_automotive', pattern: /chemical|industrial|manufactur|automo|\bsteel\b|metals?\b|packaging|paper|plastics/ },
  { macro: 'services_company', pattern: /support services|business services|professional services|consulting|media|education|hotel|travel|leisure/ },
  { macro: 'government', pattern: /public sector|government|public administration/ },
];

/**
 * Sectores cerrados de Pro Ecuador (DIREX), alineados con la tabla CIIU por
 * división aprobada: cultivo, pesca y forestal → agro (01-03); alimentos
 * procesados → consumo masivo (10-12); manufactura → industria (13-33);
 * farmacéutico → salud (21). «Servicios», «Artesanías» y «Sombreros» quedan sin
 * macro (demasiado genérico o talleres pequeños). Cuenta el PRIMER sector.
 */
const PRO_ECUADOR_SECTOR_MACRO: Readonly<Record<string, MacroIndustryKey | null>> = {
  'banano y platano': 'agroindustry',
  'flores y plantas': 'agroindustry',
  'cacao y elaborados': 'agroindustry',
  'cafe y elaborados': 'agroindustry',
  'forestal y productos elaborados': 'agroindustry',
  agroindustria: 'agroindustry',
  'frutas no tradicionales': 'agroindustry',
  pesca: 'agroindustry',
  acuacultura: 'agroindustry',
  'alimentos procesados': 'consumer_goods',
  metalmecanico: 'industry_manufacturing_chemicals_automotive',
  plasticos: 'industry_manufacturing_chemicals_automotive',
  'confeccion y textil': 'industry_manufacturing_chemicals_automotive',
  'cuidado personal y del hogar': 'industry_manufacturing_chemicals_automotive',
  'cuero y calzado': 'industry_manufacturing_chemicals_automotive',
  automotriz: 'industry_manufacturing_chemicals_automotive',
  farmaceutico: 'health_pharma',
  servicios: null,
  artesanias: null,
  sombreros: null,
};

/**
 * Sectores cortos en español de los rankings (Merco Empresas y Talento, y otras
 * listas con el mismo estilo: «BANCARIO», «CEMENTERAS», «TRANSPORTE DE
 * VIAJEROS»). Reglas en orden: la primera que acierta decide. Alineadas con la
 * tabla CIIU por división aprobada; como en ella, hoteles, restaurantes, medios,
 * entretenimiento, asociaciones y holdings quedan SIN macro. Educación va a
 * Servicios (decisión de la dueña, 08-10-2026). Texto ya en minúsculas sin tildes.
 */
const SPANISH_SECTOR_RULES: readonly { macro: MacroIndustryKey | null; pattern: RegExp }[] = [
  { macro: null, pattern: /hotel|turism|restaurant|comida rapida|gastronom|medios de comunicacion|editorial|entretenimiento|\bocio\b|parque tematico|gimnasio|asociacion|fundacion|sin fines de lucro|holding|conglomerad|grupo empresarial|empresarial corporativo|agencias de promocion/ },
  { macro: 'retail', pattern: /cadenas? de farmacias|^farmacias?$|supermercad|autoservicio|departamental|tiendas|grandes superficies|retail|ferreter|electrodomestic|electronica de consumo|electronica y hogar|equipamiento (del|para el) hogar|\bmoda\b|joyeria|librer|calzado|deportes|repuestos|comercializacion de automoviles|comercio electronico|e-?comerc|comercio al por mayor|distribucion|distribuidora|centros? comercial|shopping/ },
  { macro: 'health_pharma', pattern: /farmac|laboratorio|salud|clinica|hospital|dispositivos medicos|equipo medico|isapre|medicina prepagada|drogueria/ },
  { macro: 'insurance_financial_services', pattern: /asegurador|seguros|\bafp\b|banc|financ|fintech|fondos?\b|tarjeta|pensiones|cooperativa$|entidades financieras/ },
  { macro: 'technology', pattern: /telecomunic|tecnolog|informatic|software|internet|satelital|\bcrm\b|informacion y comunicacion|servicios electronicos/ },
  { macro: 'transport_logistics', pattern: /aerolin|aviacion|transporte|logistic|courier|mensajeria|paqueteria|aeroportuari|delivery|reparto|entrega a domicilio|movilidad/ },
  { macro: 'energy_mining_environment', pattern: /energi|petrole|hidrocarbur|combustible|gasolinera|miner|servicio petroler|residuos|medioambient|servicios publicos/ },
  { macro: 'consumer_goods', pattern: /aliment|bebida|consumo masivo|vino|vitivin|cosmetic|cuidado personal|belleza|higiene|aseo|limpieza y cuidado del hogar|mascotas/ },
  { macro: 'agroindustry', pattern: /agro|agrari|forestal|pesca|acuicultura|cafetaler|ingenio|agricol|veterinari/ },
  { macro: 'industry_manufacturing_chemicals_automotive', pattern: /cement|industri|manufactur|automotri|automocion|autopartist|quimic|sider|metalurg|plastico|papel|empaque|textil|confeccion|maquila|maquinaria/ },
  { macro: 'property_construction', pattern: /construccion|inmobili|bienes raices|infraestructur|concesiones viales|zonas? francas?|parques empresariales/ },
  { macro: 'services_company', pattern: /educacion|universidad|academi|formacion|abogad|legal|auditori|consultor|contabilidad|\bbpo\b|contact center|\bett\b|rrhh|rr\.hh|facility|seguridad|servicios de limpieza|publicid|publicitari|cajas de compensacion|cementerio|servicios varios|servicios de alimentacion/ },
];

function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Macro por el sector que publica la lista (inglés o español), o `null`. */
export function resolveLatamCuratedSectorMacro(sector: string | null | undefined): MacroIndustryKey | null {
  if (typeof sector !== 'string' || sector.trim().length === 0) return null;
  const text = plain(sector);
  const first = text.split(',')[0]?.trim() ?? '';
  if (first in PRO_ECUADOR_SECTOR_MACRO) return PRO_ECUADOR_SECTOR_MACRO[first] ?? null;
  for (const rule of SPANISH_SECTOR_RULES) if (rule.pattern.test(text)) return rule.macro;
  const english = new Set<MacroIndustryKey>();
  for (const rule of ENGLISH_SECTOR_RULES) if (rule.pattern.test(text)) english.add(rule.macro);
  if (english.size === 1) return [...english][0];
  return resolveCrCicrActivityMacro(sector);
}

/** Macro de una entrada curada según su tipo, si es pública y su sector. */
export function resolveLatamCuratedMacro(input: {
  kind: string | null | undefined;
  isPublic?: boolean | null;
  sector?: string | null;
}): MacroIndustryKey | null {
  switch (input.kind) {
    case 'university':
    case 'school':
      return input.isPublic === true ? 'government' : 'services_company';
    case 'insurer':
    case 'bank':
    case 'financial':
      return 'insurance_financial_services';
    case 'health_provider':
      return 'health_pharma';
    default:
      return resolveLatamCuratedSectorMacro(input.sector);
  }
}
