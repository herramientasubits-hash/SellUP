/**
 * cr-cicr-macro-table.ts — qué macro industria corresponde a la actividad que un
 * socio de la Cámara de Industrias de Costa Rica (CICR) declara en su ficha.
 *
 * SOURCES-CR-CICR-1.
 *
 * ── 🔴 TABLA NUEVA — PROPUESTA, PENDIENTE DEL VISTO BUENO DE LA DUEÑA ───────
 *
 * CICR publica la actividad en texto libre («Industria alimentaria», «Venta y
 * alquiler de montacargas»), sin código. No hay una tabla aprobada para texto, así
 * que esta traduce palabras clave a las MISMAS macros que la tabla por división
 * CIIU aprobada (`AR_RNS_DIVISION_MACRO`, 29-09-2026): alimentos y bebidas →
 * consumo masivo (10-12), fabricación en metal/plástico/papel/químicos → industria
 * (13-33), farmacia y dispositivos médicos → salud, comercio → retail (45-47), etc.
 * Cambiarla es una decisión de producto: no se edita sin su visto bueno.
 *
 * Reglas:
 *   1. Las palabras de SECTOR (tecnología, salud, agro, alimentos, construcción,
 *      energía, transporte, finanzas, servicios profesionales) deciden. Si el texto
 *      toca DOS macros distintas no hay macro dominante y la fila queda fuera
 *      («Venta de vehículos, seguros, financiamiento»); «servicios profesionales»
 *      es el sector débil y cede ante uno específico.
 *   2. Sin palabra de sector, un verbo productivo (fabricación, manufactura,
 *      metalmecánica…) → industria; si no, un verbo de comercio (venta,
 *      distribución, importación) → retail. Producir manda sobre vender.
 *   3. Sin ninguna de las dos, `null`: la fuente gratuita nunca ofrece una muestra
 *      genérica.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

export const CR_CICR_ACTIVITY_TABLE_VERSION = 'cr-cicr-activity-v1' as const;

/** Texto sin tildes, en minúscula y con espacios simples. */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palabras de sector por macro (sobre texto ya normalizado). */
const SECTOR_RULES: readonly { macro: MacroIndustryKey; pattern: RegExp }[] = [
  {
    macro: 'technology',
    pattern:
      /\bsoftware\b|tecnolog|informatic|ciberseguridad|telecomunic|\bredes\b|aplicaciones|transformacion digital|inteligencia artificial|data ?center|sistemas de informacion|conectividad|\binternet\b/,
  },
  {
    macro: 'health_pharma',
    pattern:
      /farmac|medicament|\bmedic[oa]s?\b|dispositivos? medic|\bsalud\b|laboratorio|hospital|clinic[ao]|biomedic|medicina|veterinari|odontolog|ortoped/,
  },
  {
    macro: 'agroindustry',
    pattern:
      /\bagro|agricol|forestal|silvicult|pecuari|ganader|cultiv|fertiliz|\bsemillas?\b|plantas ornamentales|\bpina\b|banano|\bcafe\b|\bpalma\b|azucar|acuicultur|\bpesca\b/,
  },
  {
    macro: 'consumer_goods',
    pattern:
      /aliment|bebida|lacteo|carnes? |embutido|confiter|panader|galleta|\bsnacks?\b|tabaco|cerveza|licor|saborizante|condimento|especias|\bhelados?\b/,
  },
  {
    macro: 'property_construction',
    pattern:
      /construccion|constructiv|inmueble|bienes raices|desarrollo inmobiliario|obra civil|acabados de edificios|parque empresarial|\bcasas\b/,
  },
  {
    macro: 'energy_mining_environment',
    pattern:
      /energi|\bsolar\b|fotovoltaic|biomasa|\bgas lp\b|\bglp\b|gas licuado|combustible|petrol|hidroelectric|mineria|reciclaj|residuos|desechos|ambiental|aguas? residual|tratamiento de agua|electricidad/,
  },
  {
    macro: 'retail',
    pattern: /venta de (?:vehiculos|autos|automoviles|motocicletas)|concesionari|agencia de vehiculos/,
  },
  {
    macro: 'transport_logistics',
    pattern:
      /logistic|transporte|\bcargas?\b|\bfletes?\b|courier|mensajeria|aduan|agenciamiento|maritim|naviera|almacenaje|bodegaje|estacionamiento/,
  },
  {
    macro: 'insurance_financial_services',
    pattern: /\bseguros?\b|asegurador|\bbanco\b|bancari|financier|financiamiento|\bcredito|leasing|factoraje|puesto de bolsa|microfinanz/,
  },
  {
    macro: 'services_company',
    pattern:
      /consultori|asesori|asesoram|\blegales?\b|juridic|abogad|contabil|auditoria|recursos humanos|talento humano|administracion de personal|reclutamiento|capacitacion|publicidad|mercadeo|marketing|outsourcing|\bbpo\b|call center|gestion empresarial|direccion y control de proyectos|seguridad privada|servicios? de limpieza|servicios profesionales/,
  },
];

/** Verbos productivos: sin palabra de sector, mandan «industria». */
const PRODUCTIVE =
  /fabricaci|\bfabrica\b|manufactur|metalmecanic|fundicion|maquilad|ensamble|troquel|\bproduc(?:cion|tor|tora|e|imos|ir)\b|elaboraci|procesadora|transformaci|impresion|\bindustria\b/;

/** Verbos de comercio: sin sector ni producción, mandan «retail». */
const COMMERCE = /\bretail\b|\bventas?\b|\bvende|comercializ|distribu|importa|\brenta\b|alquiler|mayorist|minorist|ferreter|tienda|supermercado/;

/**
 * Macro de la actividad declarada por un socio de CICR, o `null` si no hay una
 * dominante.
 */
export function resolveCrCicrActivityMacro(activity: string | null | undefined): MacroIndustryKey | null {
  if (typeof activity !== 'string' || activity.trim().length === 0) return null;
  const text = plain(activity);
  const sectors = new Set<MacroIndustryKey>();
  for (const rule of SECTOR_RULES) if (rule.pattern.test(text)) sectors.add(rule.macro);
  // «Servicios profesionales» es el sector más débil: no anula a uno específico
  // («Consultoría en tecnología» es tecnología).
  if (sectors.size > 1) sectors.delete('services_company');
  if (sectors.size === 1) return [...sectors][0];
  if (sectors.size > 1) return null;
  if (PRODUCTIVE.test(text)) return 'industry_manufacturing_chemicals_automotive';
  if (COMMERCE.test(text)) return 'retail';
  return null;
}
