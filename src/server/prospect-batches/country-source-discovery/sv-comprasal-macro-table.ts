/**
 * sv-comprasal-macro-table.ts — qué macro industria corresponde a una empresa o
 * entidad salvadoreña de la capa gratuita, según LO QUE VENDE AL ESTADO.
 *
 * SOURCES-SV-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué palabras y no códigos ───────────────────────────────────────────
 *
 * La API pública de COMPRASAL (adjudicaciones 2025-2026) no trae UNSPSC ni actividad
 * del proveedor: sólo el NOMBRE DEL PROCESO («ADQUISICIÓN DE MEDICAMENTOS…»,
 * «SERVICIO DE VIGILANCIA…»). Cada regla traduce unas palabras del proceso a una
 * macro, con las mismas cubetas que la tabla de objeto del gasto de Honduras (aprobada
 * por la dueña el 07-10-2026). La macro de la empresa es la que suma al menos la
 * mitad de su monto adjudicado; lo que no coincide con ninguna regla (fiestas,
 * papelería, publicidad, capacitación…) no se clasifica.
 *
 * Aprobada por la dueña el 07-10-2026 (junto con el umbral de US$ 50.000). Si
 * `SV_COMPRASAL_MACRO_TABLE_APPROVED` fuera `false`, el ETL no cargaría la capa
 * gratuita de empresas (`--only=directory`). Cambiar la clasificación es una
 * decisión de producto: no se edita sin su visto bueno.
 *
 * ── Relevancia (no hay tamaño oficial vigente) ─────────────────────────────
 *
 * Ninguna fuente abierta de El Salvador publica trabajadores ni ingresos por
 * empresa. La capa gratuita sólo ofrece proveedoras con NIT seguro (empatadas a UN
 * solo NIT del registro de Hacienda, que sólo tiene grandes y medianos
 * contribuyentes), sin consorcios, con al menos US$ 50.000 adjudicados.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

/** Versión de la tabla de palabras de COMPRASAL. */
export const SV_COMPRASAL_MACRO_TABLE_VERSION = 'sv-comprasal-proceso-palabras-macro-v1' as const;

/** ¿Aprobó la dueña la tabla? Hasta entonces el ETL no carga la capa de empresas. */
export const SV_COMPRASAL_MACRO_TABLE_APPROVED: boolean = true;

/** Las entidades públicas se ofrecen sólo para Gobierno. */
export const SV_PUBLIC_ENTITY_MACRO: MacroIndustryKey = 'government';

/** Una macro es la de la empresa si suma al menos esta parte de su monto. */
export const SV_COMPRASAL_DOMINANT_MIN_SHARE = 0.5;

/** Monto mínimo adjudicado en COMPRASAL (dólares). */
export const SV_COMPRASAL_MIN_AWARDED_USD = 50_000;

/** Año desde el que la empresa debe seguir vendiendo al Estado. */
export const SV_COMPRASAL_MIN_LAST_YEAR = 2022;

/** Una regla: raíces (mayúsculas sin tildes, al comienzo de palabra) → macro. */
export type SvProcessRule = {
  key: string;
  /** `null` = sin macro a propósito (no dice nada de la industria del proveedor). */
  macro: MacroIndustryKey | null;
  stems: readonly string[];
  /** Lo que el vendedor ve en la columna «Industria». */
  label: string;
};

/**
 * Reglas, de la más específica a la más general: la primera que coincide gana. Las
 * de «sin macro» van primero para que unas fiestas patronales con «alimentación» o
 * una capacitación en informática no clasifiquen al proveedor.
 */
export const SV_PROCESS_RULES: readonly SvProcessRule[] = [
  // ── Sin macro ──
  { key: 'eventos', macro: null, stems: ['FIESTA', 'CELEBRACION', 'FESTIVIDAD', 'NAVIDEN', 'JUGUETE', 'EVENTO', 'DECORACION', 'CANASTA'], label: 'eventos y celebraciones' },
  { key: 'oficina', macro: null, stems: ['PAPELERIA', 'ARTICULOS DE OFICINA', 'UTILES', 'TONER', 'TINTA', 'IMPRESION', 'IMPRENTA', 'PUBLICIDAD', 'PUBLICACION', 'ROTULO', 'MOBILIARIO'], label: 'papelería, impresión y mobiliario' },
  { key: 'capacitacion', macro: null, stems: ['CAPACITACION', 'CURSO', 'DIPLOMADO', 'TALLER DE', 'FORMACION'], label: 'capacitación' },
  // ── Seguros y finanzas ──
  { key: 'seguros', macro: 'insurance_financial_services', stems: ['SEGURO DE', 'SEGUROS DE', 'SEGURO MEDICO', 'SEGURO COLECTIVO', 'POLIZA', 'REASEGURO'], label: 'Seguros' },
  { key: 'servicios_financieros', macro: 'insurance_financial_services', stems: ['SERVICIOS BANCARIOS', 'SERVICIOS FINANCIEROS', 'ADMINISTRACION DE FONDOS'], label: 'Servicios financieros' },
  // ── Salud ──
  {
    key: 'medicamentos',
    macro: 'health_pharma',
    stems: ['MEDICAMENT', 'FARMAC', 'REACTIVO', 'VACUNA', 'INSUMOS MEDICOS', 'INSUMO MEDICO', 'MATERIAL MEDICO', 'MEDICO QUIRURGIC', 'QUIRURGIC', 'ODONTOLOG', 'OXIGENO MEDICINAL', 'SANGRE', 'DIALISIS', 'LABORATORIO CLINICO', 'PRUEBAS DE LABORATORIO', 'INSTRUMENTAL MEDICO', 'TERAPIA RESPIRATORIA', 'ENFERMERIA', 'CIRUGIA', 'ANESTESIOLOG', 'ESTERILIZACION', 'SUTURA', 'UROLOGIA', 'RADIOLOGIA', 'ORTOPEDI', 'OFTALMOLOG', 'APOSITO', 'HEMODINAMIA'],
    label: 'Medicinas e insumos médicos',
  },
  { key: 'servicios_medicos', macro: 'health_pharma', stems: ['SERVICIOS MEDICOS', 'SERVICIO MEDICO', 'ATENCION MEDICA', 'HOSPITALARI', 'IMAGENOLOG', 'RAYOS X', 'HEMODIALISIS', 'EQUIPO MEDICO', 'EQUIPOS MEDICOS'], label: 'Servicios y equipo médico' },
  // ── Tecnología ──
  {
    key: 'informatica',
    macro: 'technology',
    stems: ['SOFTWARE', 'LICENCIA', 'INFORMATIC', 'COMPUTADORA', 'COMPUTO', 'SERVIDOR', 'PERIFERICO', 'SISTEMA DE INFORMACION', 'SISTEMAS INFORMATICOS', 'DESARROLLO DE SISTEMA', 'NUBE', 'CIBERSEGURIDAD', 'TECNOLOGIAS DE LA INFORMACION', 'TECNOLOGICO'],
    label: 'Informática y software',
  },
  { key: 'telecomunicaciones', macro: 'technology', stems: ['TELECOMUNICACION', 'INTERNET', 'ENLACE DE DATOS', 'ENLACES DE DATOS', 'TELEFONIA', 'TELEFONICO', 'RADIOCOMUNICACION', 'FIBRA OPTICA', 'VIDEOVIGILANCIA'], label: 'Telecomunicaciones' },
  // ── Energía y ambiente ──
  { key: 'combustibles', macro: 'energy_mining_environment', stems: ['COMBUSTIBLE', 'DIESEL', 'GASOLINA', 'LUBRICANTE', 'GAS LICUADO', 'GAS PROPANO'], label: 'Combustibles y lubricantes' },
  { key: 'energia_agua', macro: 'energy_mining_environment', stems: ['ENERGIA ELECTRICA', 'SUMINISTRO DE ENERGIA', 'ALUMBRADO', 'PANELES SOLARES', 'AGUA POTABLE', 'BOMBEO', 'POZO'], label: 'Energía y agua' },
  { key: 'desechos', macro: 'energy_mining_environment', stems: ['DESECHOS', 'RESIDUOS', 'RELLENO SANITARIO', 'AGUAS RESIDUALES'], label: 'Desechos y ambiente' },
  // ── Construcción ──
  {
    key: 'construccion',
    macro: 'property_construction',
    stems: ['CONSTRUCCION', 'OBRA', 'OBRAS', 'PAVIMENTA', 'REMODELA', 'CONCRETO', 'ASFALT', 'CARRETERA', 'PUENTE', 'ALBANILERIA', 'MATERIALES DE CONSTRUCCION', 'FERRETER', 'INFRAESTRUCTURA', 'EDIFICIO', 'TECHO', 'CIELO FALSO'],
    label: 'Construcción y materiales',
  },
  // ── Servicios a empresas ──
  { key: 'vigilancia_limpieza', macro: 'services_company', stems: ['VIGILANCIA', 'SEGURIDAD PRIVADA', 'SERVICIO DE LIMPIEZA', 'SERVICIOS DE LIMPIEZA', 'FUMIGACION', 'LAVANDERIA'], label: 'Vigilancia y limpieza' },
  { key: 'consultoria', macro: 'services_company', stems: ['CONSULTORIA', 'AUDITORIA', 'ASESORIA', 'ESTUDIO DE', 'SUPERVISION DE'], label: 'Consultoría y auditoría' },
  // ── Transporte ──
  { key: 'transporte', macro: 'transport_logistics', stems: ['TRANSPORTE', 'FLETE', 'ACARREO', 'MENSAJERIA', 'COURIER', 'PASAJES', 'BOLETOS AEREOS'], label: 'Transporte' },
  // ── Industria, vehículos y repuestos ──
  { key: 'vehiculos', macro: 'industry_manufacturing_chemicals_automotive', stems: ['VEHICULO', 'CAMION', 'AUTOMOT', 'REPUESTO', 'LLANTA', 'MOTOCICLETA', 'MAQUINARIA'], label: 'Vehículos, repuestos y maquinaria' },
  { key: 'quimicos', macro: 'industry_manufacturing_chemicals_automotive', stems: ['QUIMICO', 'PINTURA', 'PRODUCTOS METALICOS', 'ESTRUCTURAS METALICAS'], label: 'Químicos, pinturas y metal' },
  // ── Consumo ──
  { key: 'alimentos', macro: 'consumer_goods', stems: ['ALIMENT', 'BEBIDA', 'AGUA ENVASADA', 'VIVERES', 'REFRIGERIO'], label: 'Alimentos y bebidas' },
  { key: 'limpieza_higiene', macro: 'consumer_goods', stems: ['PRODUCTOS DE LIMPIEZA', 'MATERIALES DE LIMPIEZA', 'ARTICULOS DE LIMPIEZA', 'HIGIENE', 'CALZADO', 'UNIFORME'], label: 'Limpieza, higiene y vestuario' },
  // ── Agro ──
  { key: 'agro', macro: 'agroindustry', stems: ['AGRICOLA', 'AGROQUIMIC', 'FERTILIZANT', 'SEMILLA', 'VETERINARI', 'CONCENTRADO PARA'], label: 'Insumos agrícolas' },
];

const RULE_BY_KEY: ReadonlyMap<string, SvProcessRule> = new Map(SV_PROCESS_RULES.map((rule) => [rule.key, rule]));

function plainProcess(text: string): string {
  return ` ${text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()}`;
}

/** La primera regla cuyas palabras están en el nombre del proceso, o `null`. */
export function resolveSvProcessRule(processName: string | null | undefined): SvProcessRule | null {
  if (typeof processName !== 'string' || processName.trim().length === 0) return null;
  const text = plainProcess(processName);
  return SV_PROCESS_RULES.find((rule) => rule.stems.some((stem) => text.includes(` ${stem}`))) ?? null;
}

/** Macro de una regla (por su clave), o `null`. */
export function resolveSvProcessRuleMacro(ruleKey: string | null | undefined): MacroIndustryKey | null {
  return typeof ruleKey === 'string' ? RULE_BY_KEY.get(ruleKey)?.macro ?? null : null;
}

/** Rubro en palabras de una regla, o `null`. */
export function resolveSvProcessRuleLabel(ruleKey: string | null | undefined): string | null {
  const rule = typeof ruleKey === 'string' ? RULE_BY_KEY.get(ruleKey) : undefined;
  return rule !== undefined && rule.macro !== null ? rule.label : null;
}

/**
 * Macro dominante por monto (≥ 50 % de TODO lo adjudicado, también lo que no se
 * clasifica) y la regla que más pesa dentro de ella, o `null`.
 */
export function resolveSvComprasalSupplierMacro(
  amountByRule: Readonly<Record<string, number>>,
): { macroIndustryKey: MacroIndustryKey; share: number; ruleKey: string } | null {
  const byMacro = new Map<MacroIndustryKey, { amount: number; rule: string; ruleAmount: number }>();
  let total = 0;
  for (const [key, amount] of Object.entries(amountByRule)) {
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
    const macro = resolveSvProcessRuleMacro(key);
    if (macro === null) continue;
    const current = byMacro.get(macro) ?? { amount: 0, rule: key, ruleAmount: 0 };
    const better = amount > current.ruleAmount || (amount === current.ruleAmount && key < current.rule);
    byMacro.set(macro, {
      amount: current.amount + amount,
      rule: better ? key : current.rule,
      ruleAmount: better ? amount : current.ruleAmount,
    });
  }
  if (total <= 0) return null;
  let best: { macroIndustryKey: MacroIndustryKey; share: number; ruleKey: string } | null = null;
  for (const [macro, stat] of byMacro) {
    const share = stat.amount / total;
    if (best === null || share > best.share) best = { macroIndustryKey: macro, share, ruleKey: stat.rule };
  }
  return best !== null && best.share >= SV_COMPRASAL_DOMINANT_MIN_SHARE ? best : null;
}

/** Por qué tabla se clasificó la fila. */
export type SvDirectoryKind = 'comprasal_supplier' | 'public_entity';

/** Macro de una fila del directorio según su tipo y su regla, o `null`. */
export function resolveSvDirectoryMacro(kind: string | null | undefined, ruleKey: string | null | undefined): MacroIndustryKey | null {
  if (kind === 'public_entity') return SV_PUBLIC_ENTITY_MACRO;
  if (kind === 'comprasal_supplier') return resolveSvProcessRuleMacro(ruleKey);
  return null;
}

/** ¿Tiene esta macro alguna fuente salvadoreña clasificada? */
export function macroHasSvCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return macroIndustryKey === SV_PUBLIC_ENTITY_MACRO || SV_PROCESS_RULES.some((rule) => rule.macro === macroIndustryKey);
}

/** ¿Es la empresa lo bastante relevante para la capa gratuita? */
export function isSvComprasalRelevant(input: { awardedUsd: number; lastYear: number | null }): boolean {
  if (input.lastYear === null || input.lastYear < SV_COMPRASAL_MIN_LAST_YEAR) return false;
  return Number.isFinite(input.awardedUsd) && input.awardedUsd >= SV_COMPRASAL_MIN_AWARDED_USD;
}
