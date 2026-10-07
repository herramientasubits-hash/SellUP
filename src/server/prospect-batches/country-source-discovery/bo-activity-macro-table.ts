/**
 * bo-activity-macro-table.ts — qué macro industria corresponde a una empresa
 * boliviana de la lista de grandes contribuyentes.
 *
 * SOURCES-BO-CLOSE-1.
 *
 * ── Por qué palabras y no códigos ───────────────────────────────────────────
 *
 * Bolivia no publica la actividad codificada de cada empresa. El SEPREC sí da su
 * RAZÓN SOCIAL y su OBJETO SOCIAL (texto libre de la escritura). Cada regla de esta
 * tabla traduce unas palabras a la DIVISIÓN CIIU Rev. 4 equivalente, y la división
 * se resuelve con la tabla aprobada para Argentina (`AR_RNS_DIVISION_MACRO`, «tabla
 * AR aprobada», 29-09-2026, v2 05-10-2026). Así Bolivia clasifica igual que el
 * resto de países: comercio mayorista y minorista → Retail; integradores y
 * mayoristas de informática → Tecnología (clases 4651/4652/4741 de la v2);
 * farmacias y droguerías → Salud.
 *
 * Orden de lectura:
 *   1. la RAZÓN SOCIAL («CONSTRUCTORA …», «FARMACIA …», «BANCO …»): lo más preciso;
 *   2. si no dice nada, el COMIENZO del objeto social (las escrituras empiezan por
 *      la actividad principal y luego enumeran «y en general cualquier acto de
 *      comercio»).
 * La primera regla que coincide gana. Una empresa sin coincidencia NO tiene macro y
 * la fuente gratuita nunca la ofrece (igual que las divisiones sin macro en
 * Argentina: hoteles, restaurantes, medios, educación, asociaciones).
 *
 * Cambiar esta tabla es una decisión de producto: no se edita sin el visto bueno de
 * la dueña.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { AR_RNS_CLASS_MACRO, AR_RNS_DIVISION_MACRO } from './ar-rns-macro-table';

/** Versión de la tabla. */
export const BO_ACTIVITY_MACRO_TABLE_VERSION = 'bo-keyword-ciiu4-macro-v1' as const;

/** Una regla: palabras (raíces, en mayúsculas sin tildes) → división o clase CIIU Rev. 4. */
export type BoActivityRule = {
  /** División (2 dígitos) o clase (4 dígitos) CIIU Rev. 4; `null` = sin macro a propósito. */
  ciiu: string | null;
  /** Raíces: coinciden al comienzo de una palabra («FARMAC» → FARMACIA, FARMACEUTICA). */
  stems: readonly string[];
  /**
   * Raíces que sólo valen en la RAZÓN SOCIAL: en el objeto social son frases de
   * relleno («a cargo de», «terminal» de un equipo…).
   */
  nameOnlyStems?: readonly string[];
  /** Explicación corta para la tabla que aprueba la dueña. */
  label: string;
};

/**
 * Reglas, de la más específica a la más general. Las de «sin macro» van primero
 * para que un hotel o un colegio no caiga después en «servicios» o «comercio».
 */
export const BO_ACTIVITY_RULES: readonly BoActivityRule[] = [
  // ── Sin macro (igual que Argentina) ──
  { ciiu: null, stems: ['HOTEL', 'HOSTAL', 'RESTAURANT', 'GASTRONOM', 'CATERING'], label: 'hoteles y restaurantes' },
  { ciiu: null, stems: ['UNIVERSIDAD', 'COLEGIO', 'EDUCATIV', 'EDUCACION', 'INSTITUTO DE FORMACION'], label: 'educación' },
  { ciiu: null, stems: ['RADIO', 'TELEVISION', 'PERIODIC', 'EDITORIAL', 'COMUNICACION SOCIAL'], label: 'medios' },
  // ── Finanzas (64-66) ──
  {
    ciiu: '64',
    stems: ['BANCO', 'BANCA', 'FINANCIER', 'MICROCREDIT', 'MUTUAL', 'AHORRO Y CREDITO', 'LEASING', 'FACTORAJE', 'CASA DE CAMBIO', 'FONDO FINANCIERO', 'INSTITUCION FINANCIERA'],
    label: 'bancos, financieras y microcrédito',
  },
  { ciiu: '65', stems: ['SEGUROS', 'REASEGURO', 'ASEGURADORA', 'FONDOS DE PENSIONES'], label: 'seguros y pensiones' },
  { ciiu: '66', stems: ['FONDOS DE INVERSION', 'AGENCIA DE BOLSA', 'CORREDORES DE SEGURO', 'CORREDORA DE SEGURO', 'TITULARIZADORA'], label: 'fondos, bolsa y corredores' },
  // ── Salud (21, 86, 4772) ──
  { ciiu: '4772', stems: ['FARMACIA', 'DROGUERIA', 'BOTICA'], label: 'farmacias y droguerías' },
  { ciiu: '86', stems: ['LABORATORIO CLINICO', 'LABORATORIOS CLINICOS'], label: 'laboratorios clínicos' },
  { ciiu: '21', stems: ['FARMACEUTIC', 'LABORATORIOS FARMAC', 'MEDICAMENTO', 'PRODUCTOS FARMAC'], nameOnlyStems: ['LABORATORIO', 'LABORATORIOS'], label: 'industria y venta de medicamentos' },
  { ciiu: '86', stems: ['CLINICA', 'HOSPITAL', 'POLICLINIC', 'SERVICIOS MEDICOS', 'SERVICIOS DE SALUD', 'CENTRO MEDICO', 'DIAGNOSTICO', 'ODONTOLOG'], label: 'clínicas, hospitales y diagnóstico' },
  // ── Tecnología (61-63, 4651, 4652) ──
  { ciiu: '61', stems: ['TELECOMUNICACION', 'TELECOM', 'TELEFONIA', 'TELEFONICA', 'CELULAR', 'INTERNET', 'TELEVISION POR CABLE'], label: 'telecomunicaciones' },
  { ciiu: '62', stems: ['SOFTWARE', 'INFORMATICA', 'SISTEMAS INFORMATICOS', 'DESARROLLO DE SISTEMAS', 'TECNOLOGIAS DE LA INFORMACION', 'PROCESAMIENTO DE DATOS', 'COMPUTACION'], label: 'software e informática' },
  { ciiu: '4651', stems: ['EQUIPOS DE COMPUTACION', 'EQUIPOS INFORMATICOS', 'COMPUTADORAS'], label: 'mayoristas de informática' },
  { ciiu: '4652', stems: ['EQUIPOS DE TELECOMUNICACION', 'EQUIPOS ELECTRONICOS'], label: 'mayoristas de electrónica y telecomunicaciones' },
  { ciiu: '62', stems: [], nameOnlyStems: ['TECHNOLOGY', 'TECHNOLOGIES', 'TECNOLOGIA', 'TECNOLOGIAS', 'SYSTEMS', 'SISTEMAS', 'SOLUTIONS', 'DIGITAL'], label: 'tecnología (por el nombre)' },
  // ── Energía, minería y ambiente (05-09, 19, 35-39) ──
  { ciiu: '06', stems: ['PETROLER', 'HIDROCARBURO', 'PETROLEO'], label: 'hidrocarburos' },
  { ciiu: '07', stems: ['MINERA', 'MINERIA', 'MINERO', 'MINERALES', 'CONCENTRADO DE MINERAL', 'METALURGIA EXTRACTIVA'], label: 'minería' },
  { ciiu: '35', stems: ['ELECTRICIDAD', 'ENERGIA ELECTRICA', 'GENERACION ELECTRICA', 'DISTRIBUIDORA DE ELECTRICIDAD', 'DISTRIBUIDORA DE GAS', 'GAS NATURAL'], nameOnlyStems: ['ELECTRICA', 'ENERGIA', 'HIDROELECTRICA'], label: 'electricidad y gas' },
  { ciiu: '36', stems: ['AGUA POTABLE', 'ALCANTARILLADO'], label: 'agua' },
  { ciiu: '38', stems: ['RESIDUOS', 'RECICLAJE', 'RECICLADO', 'SERVICIOS AMBIENTALES'], label: 'residuos y reciclaje' },
  { ciiu: '19', stems: ['COMBUSTIBLE', 'LUBRICANTE', 'ESTACION DE SERVICIO', 'SURTIDOR', 'GAS LICUADO', 'GLP', 'CARBURANTE', 'GASOLINA'], label: 'combustibles' },
  // ── Construcción e inmobiliario (41-43, 68) ──
  { ciiu: '41', stems: ['CONSTRUCTORA', 'CONSTRUCCION', 'CONSTRUCCIONES', 'OBRAS CIVILES', 'EDIFICACION', 'INGENIERIA Y CONSTRUCCION'], label: 'construcción' },
  { ciiu: '68', stems: ['INMOBILIARIA', 'BIENES RAICES', 'URBANIZADORA', 'URBANIZACION'], label: 'inmobiliario' },
  // ── Transporte y logística (49-53) ──
  { ciiu: '47', stems: ['GRANDES ALMACENES'], label: 'grandes almacenes (comercio minorista)' },
  { ciiu: '52', stems: ['DESPACHANTE DE ADUANA', 'AGENCIA DESPACHANTE', 'ALMACENAJE', 'DEPOSITO ADUANERO', 'LOGISTIC', 'OPERADOR LOGISTICO'], nameOnlyStems: ['ALMACENES', 'TERMINAL'], label: 'logística, aduanas y almacenes' },
  { ciiu: '49', stems: ['TRANSPORTE', 'TRANSPORTES', 'CARGA PESADA', 'FLETE', 'COURIER'], nameOnlyStems: ['CARGO'], label: 'transporte terrestre' },
  { ciiu: '51', stems: ['AEROLINEA', 'AVIACION', 'AEREO', 'AEREA'], label: 'transporte aéreo' },
  // ── Química antes que agro: «AGROQUÍMICOS» es química ──
  { ciiu: '20', stems: ['QUIMIC', 'PINTURA', 'DETERGENTE', 'FERTILIZANTE', 'AGROQUIMIC'], label: 'química' },
  // ── Agro (01-03) ──
  { ciiu: '01', stems: ['AGROPECUARI', 'AGRICOLA', 'AGROINDUSTRI', 'GANADER', 'AVICOLA', 'PORCINO', 'SEMILLA', 'SOYA', 'OLEAGINOS', 'AGRO', 'CULTIVO', 'CRIA DE', 'GANADO'], label: 'agropecuario' },
  { ciiu: '02', stems: ['FORESTAL', 'MADERERA', 'MADERA', 'ASERRADERO'], label: 'forestal' },
  // ── Consumo masivo (10-12) ──
  { ciiu: '11', stems: ['CERVECERIA', 'EMBOTELLADORA', 'BEBIDAS', 'DESTILERIA', 'BODEGAS Y VIÑEDOS', 'VINOS', 'SINGANI'], label: 'bebidas' },
  { ciiu: '10', stems: ['ALIMENTOS', 'ALIMENTICI', 'LACTEO', 'PANIFICADORA', 'MOLINERA', 'MOLINO', 'ACEITE', 'ACEITERA', 'GOLOSINA', 'CHOCOLATE', 'CONSERVAS', 'EMBUTIDO', 'FRIGORIFICO', 'MATADERO', 'INGENIO AZUCARERO', 'AZUCAR', 'ARROCERA'], label: 'alimentos' },
  // ── Industria (13-33, salvo las de arriba) ──
  {
    ciiu: '22',
    stems: ['PLASTICO', 'ENVASES', 'EMBALAJE', 'CAUCHO', 'POLIURETANO', 'PVC'],
    label: 'plásticos y envases',
  },
  { ciiu: '23', stems: ['CEMENTO', 'CERAMICA', 'VIDRIO', 'LADRILLO', 'HORMIGON', 'PREFABRICADO'], label: 'cemento y minerales no metálicos' },
  { ciiu: '24', stems: ['METALURGIC', 'SIDERURGIC', 'FUNDICION', 'ACERO'], label: 'metalurgia' },
  { ciiu: '13', stems: ['TEXTIL', 'HILANDERIA', 'CONFECCION'], label: 'textil y confección' },
  { ciiu: '17', stems: ['PAPEL', 'PAPELERA', 'CARTON'], label: 'papel' },
  { ciiu: '18', stems: ['IMPRENTA', 'GRAFICA', 'IMPRESION'], label: 'imprenta' },
  { ciiu: '31', stems: ['MUEBLES', 'MUEBLERIA'], label: 'muebles' },
  { ciiu: '25', stems: ['INDUSTRIA', 'INDUSTRIAS', 'INDUSTRIAL', 'FABRICA', 'FABRICACION', 'MANUFACTURA', 'METALMECANIC'], label: 'industria (general)' },
  // ── Servicios a empresas (69-82) ──
  { ciiu: '71', stems: ['CONSULTORA', 'CONSULTORES', 'CONSULTORIA', 'CONSULTING', 'INGENIERIA', 'ARQUITECTURA', 'SUPERVISION DE OBRAS'], label: 'consultoría e ingeniería' },
  { ciiu: '69', stems: ['AUDITOR', 'CONTABLE', 'ABOGADOS', 'JURIDIC', 'BUFETE'], label: 'auditoría y legal' },
  { ciiu: '73', stems: ['PUBLICIDAD', 'MARKETING', 'PUBLICITARI', 'INVESTIGACION DE MERCADO', 'ESTUDIOS DE MERCADO'], label: 'publicidad e investigación de mercados' },
  { ciiu: '80', stems: ['SEGURIDAD PRIVADA', 'VIGILANCIA', 'GUARDIAS'], label: 'seguridad privada' },
  { ciiu: '81', stems: ['LIMPIEZA', 'FUMIGACION', 'MANTENIMIENTO DE EDIFICIOS'], label: 'limpieza y mantenimiento' },
  { ciiu: '78', stems: ['RECURSOS HUMANOS', 'OUTSOURCING', 'TERCERIZACION', 'PERSONAL TEMPORAL'], label: 'personal y tercerización' },
  { ciiu: '77', stems: ['ALQUILER DE MAQUINARIA', 'ALQUILER DE EQUIPOS', 'ARRENDAMIENTO DE MAQUINARIA', 'ARRENDAMIENTO DE EQUIPOS', 'RENT A CAR'], label: 'alquiler de equipos' },
  // ── Comercio (45-47) ──
  { ciiu: '45', stems: ['AUTOMOTRIZ', 'AUTOMOTORES', 'CONCESIONARI', 'VEHICULOS', 'REPUESTOS', 'NEUMATICOS', 'LLANTAS', 'MOTOCICLETAS'], label: 'vehículos y repuestos' },
  { ciiu: '47', stems: ['SUPERMERCADO', 'HIPERMERCADO', 'TIENDA', 'TIENDAS', 'MINIMARKET'], label: 'comercio minorista' },
  {
    ciiu: '46',
    stems: ['IMPORTADORA', 'IMPORTACION', 'IMPORTACIONES', 'EXPORTADORA', 'EXPORTACION', 'DISTRIBUIDORA', 'DISTRIBUCION', 'COMERCIALIZADORA', 'COMERCIALIZACION', 'COMERCIAL', 'MAYORISTA', 'FERRETERIA', 'REPRESENTACIONES'],
    label: 'comercio mayorista, importación y distribución',
  },
];

/** Texto → palabras en mayúsculas, sin tildes ni signos, separadas por un espacio. */
export function normalizeBoActivityText(text: string | null | undefined): string {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/Ñ/g, 'N')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Las escrituras transcritas pegan palabras («YFARMACEUTICOS», «DEPRODUCTOS»): en el
 * objeto social, una raíz larga vale también dentro de una palabra.
 */
const GLUED_STEM_MIN_CHARS = 8;

function stemMatches(text: string, stem: string, allowGlued: boolean): boolean {
  const normalizedStem = normalizeBoActivityText(stem);
  if (` ${text}`.includes(` ${normalizedStem}`)) return true;
  return allowGlued && normalizedStem.length >= GLUED_STEM_MIN_CHARS && text.includes(normalizedStem);
}

/** Primera regla que coincide con el texto, o `null`. */
export function matchBoActivityRule(
  text: string | null | undefined,
  basis: 'legal_name' | 'social_purpose' = 'legal_name',
): BoActivityRule | null {
  const normalized = normalizeBoActivityText(text);
  if (normalized.length === 0) return null;
  for (const rule of BO_ACTIVITY_RULES) {
    const stems = basis === 'legal_name' ? [...rule.stems, ...(rule.nameOnlyStems ?? [])] : rule.stems;
    if (stems.some((stem) => stemMatches(normalized, stem, basis === 'social_purpose'))) return rule;
  }
  return null;
}

/** Macro de una división o clase CIIU Rev. 4, con las clases de la v2 de Argentina. */
export function boCiiuMacro(ciiu: string | null): MacroIndustryKey | null {
  if (ciiu === null) return null;
  if (ciiu.length === 4) {
    if (ciiu === '4772') return 'health_pharma';
    return AR_RNS_CLASS_MACRO[ciiu] ?? AR_RNS_DIVISION_MACRO[ciiu.slice(0, 2)] ?? null;
  }
  return AR_RNS_DIVISION_MACRO[ciiu] ?? null;
}

/** Cuánto del objeto social se lee: la actividad principal va al comienzo. */
export const BO_SOCIAL_PURPOSE_HEAD_CHARS = 240;

export type BoActivityClassification = {
  macroIndustryKey: MacroIndustryKey | null;
  ciiu: string | null;
  rule: string | null;
  /** De dónde salió: la razón social o el objeto social. */
  basis: 'legal_name' | 'social_purpose' | null;
};

/** Razón social y objeto social → macro (o ninguna). */
export function classifyBoliviaActivity(
  legalName: string | null | undefined,
  socialPurpose: string | null | undefined,
): BoActivityClassification {
  const byName = matchBoActivityRule(legalName, 'legal_name');
  if (byName !== null) {
    return { macroIndustryKey: boCiiuMacro(byName.ciiu), ciiu: byName.ciiu, rule: byName.label, basis: 'legal_name' };
  }
  const head = typeof socialPurpose === 'string' ? socialPurpose.slice(0, BO_SOCIAL_PURPOSE_HEAD_CHARS) : null;
  const byPurpose = matchBoActivityRule(head, 'social_purpose');
  if (byPurpose !== null) {
    return { macroIndustryKey: boCiiuMacro(byPurpose.ciiu), ciiu: byPurpose.ciiu, rule: byPurpose.label, basis: 'social_purpose' };
  }
  return { macroIndustryKey: null, ciiu: null, rule: null, basis: null };
}

/** ¿Tiene esta macro alguna regla boliviana? */
export function macroHasBoCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return BO_ACTIVITY_RULES.some((rule) => boCiiuMacro(rule.ciiu) === macroIndustryKey);
}
