/**
 * mx-compranet-rfc-rows.ts — personas morales con RFC que le vendieron al Estado
 * mexicano (contratos de CompraNet, datos abiertos de la Secretaría Anticorrupción
 * y Buen Gobierno), para el RFC por nombre dentro de la corrida del Agente 1.
 *
 * SOURCES-MX-RFC-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * México no publica un padrón de RFC. DENUE (INEGI) no trae RFC. La única fuente
 * oficial, gratuita y masiva con RFC + razón social son los contratos anuales de
 * CompraNet (CSV, Latin-1): columnas `rfc`, `Proveedor o contratista`,
 * `Estratificación` (MICRO / PEQUEÑA / MEDIANA / GRANDE / NO MIPYME…) y
 * `País de la empresa`.
 *
 * Sólo entran RFC de PERSONA MORAL (12 caracteres: 3 letras + fecha AAMMDD +
 * homoclave). Las personas físicas (13 caracteres, su RFC identifica a una
 * persona) y los extranjeros (EXT…) nunca se guardan.
 *
 * Límite conocido: sólo cubre empresas que le han vendido al Gobierno federal.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { MEXICO_LEGAL_FORMS, normalizeCompanyNameCore } from '../../company-name-core';

export const MX_COMPRANET_RFC_SOURCE_KEY = 'mx_compranet_rfc_registry' as const;
export const MX_COUNTRY_CODE = 'MX' as const;

/**
 * CompraNet escribe la forma societaria SIN puntos («SA DE CV», «SAB DE CV»).
 * Formas propias de esta fuente, más largas primero; las de MEXICO_LEGAL_FORMS
 * (con puntos) siguen valiendo. DENUE no cambia: usa MEXICO_LEGAL_FORMS tal cual.
 */
export const MX_COMPRANET_LEGAL_FORMS: readonly string[] = [
  'SAPI DE CV SOFOM ENR',
  'SA DE CV SOFOM ENR',
  'SA DE CV SOFOM ER',
  'SAPI DE CV',
  'SAB DE CV',
  'SA DE CV',
  'S DE RL DE CV',
  'S DE RL MI',
  'S DE RL',
  'SC DE RL DE CV',
  'SC DE RL',
  'SC DE CV',
  'SAS DE CV',
  'SAS',
  'AC',
  // «A.C.» con puntos se normaliza a «A C»; sin esta forma «UNIVERSIDAD OLMECA A.C.»
  // y «UNIVERSIDAD OLMECA AC» no coincidían (SOURCES-MX-FREE-LAYER-RFC-1).
  'A C',
  // Instituciones y asociaciones de asistencia/beneficencia privada (donatarias:
  // hospitales, fundaciones) y sociedades de producción rural. Prod 06-10: DENUE
  // trae «ASOCIACION PARA EVITAR LA CEGUERA EN MEXICO» y el SAT la tiene con «IAP»
  // (SOURCES-MX-IAP-LEGAL-FORMS-1).
  'I A P',
  'IAP',
  'I B P',
  'IBP',
  'A B P',
  'ABP',
  'SPR DE RL',
  'SPR DE RI',
  'S P R DE R L',
  'S P R DE R I',
  'SC',
  ...MEXICO_LEGAL_FORMS,
];

/** RFC de persona moral: 3 letras (& y Ñ válidas) + AAMMDD + homoclave de 3. */
const MORAL_RFC = /^[A-ZÑ&]{3}(\d{2})(\d{2})(\d{2})[A-Z0-9]{3}$/;

export type MxCompranetRfcRow = {
  source_key: typeof MX_COMPRANET_RFC_SOURCE_KEY;
  country_code: typeof MX_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Núcleo del nombre mexicano: el MISMO que calcula el resolvedor de la corrida. */
export function normalizeMexicoCompanyCore(name: string | null | undefined): string {
  return stripMexicoLegalFormTail(normalizeCompanyNameCore(name, MX_COMPRANET_LEGAL_FORMS));
}

/** «SAPI» → «S ?A ?P ?I»: las letras de la sigla, con o sin espacio entre ellas. */
const spaced = (acronym: string): string => acronym.split('').join(' ?');

/**
 * SOURCES-MX-LEGAL-FORM-TAIL-1 — la forma societaria escrita de cualquier manera.
 *
 * Prod 06-10 (lote 97c51fb0, MX×Retail): «ACOPOL SA CV» y «ABARROTERA DEL DUERO
 * SA CV» (padrón de importadores del SAT) no cruzaban con «ACOPOL» de DENUE. Unas
 * 3.000 filas de las dos fuentes de México quedaban con restos así: «S A P I DE CV»,
 * «SA CV», «SPR DE RL DE CV», «S DE P R DE R L», «S DE RL MI DE CV», «SAPI DE CV
 * SOFOM ENR»… Una lista de formas exactas nunca las cubre todas; aquí se reconoce
 * la estructura: sigla base (SA, SAB, SAPI, SAS, SC, SCP, SPR, SRL, S DE RL, S DE
 * PR DE RL, S EN NC…) + complementos opcionales (DE RL/RI, MI, DE CV, SOFOM ENR/ER).
 *
 * Sólo se quita al FINAL y si queda nombre: «ACEROS SA CV» → «ACEROS»; «CASA» o
 * «PRESAS» no cambian (la sigla tiene que empezar como palabra propia).
 */
const MX_LEGAL_FORM_BASE = [
  `${spaced('SAPI')}`,
  `${spaced('SAB')}`,
  `${spaced('SAS')}`,
  `${spaced('SCP')}(?: DE B Y S)?`,
  `${spaced('SPR')}`,
  `${spaced('SRL')}`,
  `S ?(?:DE|DEL) (?:${spaced('PR')} (?:DE )?)?${spaced('RL')}`,
  `S ?EN ?N? ?C`,
  `${spaced('SC')} DE (?:C|P|B Y S) (?:DE )?${spaced('RL')}`,
  `${spaced('SA')} DE ${spaced('RL')}`,
  `${spaced('SA')}`,
  `${spaced('SC')}`,
].join('|');

const MX_LEGAL_FORM_TAIL = new RegExp(
  ` (?:${MX_LEGAL_FORM_BASE})` +
    `(?: (?:DE )?R ?[LI])?` +
    `(?: M ?I)?` +
    `(?: (?:DE )?${spaced('CV')})?` +
    `(?: SOFO[ML](?: (?:${spaced('ENR')}|${spaced('ER')}))?)?$`,
);

export function stripMexicoLegalFormTail(core: string): string {
  const match = MX_LEGAL_FORM_TAIL.exec(core);
  if (match === null || match.index < 2) return core;
  return core.slice(0, match.index).trim();
}

/** RFC crudo → RFC de persona moral normalizado (mes 01-12, día 01-31), o `null`. */
export function normalizeMexicoMoralRfc(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const rfc = raw.toUpperCase().replace(/[\s.-]/g, '');
  const match = MORAL_RFC.exec(rfc);
  if (match === null) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? rfc : null;
}

export type MxCompranetContract = {
  rfc: string | null;
  supplier: string | null;
  stratification: string | null;
  year: number;
};

/** Columnas de CompraNet por nombre (la cabecera llega en Latin-1). */
export function indexCompranetHeader(header: readonly string[]): { rfc: number; supplier: number; stratification: number } | null {
  const find = (test: (h: string) => boolean) => header.findIndex((h) => test(h.trim()));
  const rfc = find((h) => h.toLowerCase() === 'rfc');
  const supplier = find((h) => h.startsWith('Proveedor o contratista'));
  const stratification = find((h) => h.startsWith('Estratificaci'));
  return rfc < 0 || supplier < 0 ? null : { rfc, supplier, stratification };
}

/**
 * Contratos → una fila por RFC de persona moral. Gana el contrato más reciente
 * (su nombre y su estratificación).
 */
export function buildMxCompranetRfcRows(
  contracts: Iterable<MxCompranetContract>,
  params: { importedAt: string },
): MxCompranetRfcRow[] {
  const latest = new Map<string, MxCompranetContract & { rfc: string; supplier: string }>();
  for (const contract of contracts) {
    const rfc = normalizeMexicoMoralRfc(contract.rfc);
    const supplier = (contract.supplier ?? '').replace(/\s+/g, ' ').trim();
    if (rfc === null || supplier.length === 0) continue;
    const previous = latest.get(rfc);
    if (previous === undefined || contract.year >= previous.year) latest.set(rfc, { ...contract, rfc, supplier });
  }

  const rows: MxCompranetRfcRow[] = [];
  for (const contract of latest.values()) {
    const core = normalizeMexicoCompanyCore(contract.supplier);
    if (core.length < 2) continue;
    const identity = deriveTaxRecordIdentity(contract.rfc);
    const stratification = (contract.stratification ?? '').trim().toUpperCase();
    rows.push({
      source_key: MX_COMPRANET_RFC_SOURCE_KEY,
      country_code: MX_COUNTRY_CODE,
      source_year: contract.year,
      tax_id: contract.rfc,
      normalized_tax_id: contract.rfc,
      legal_name: contract.supplier,
      normalized_legal_name: core,
      raw_data: stratification.length > 0 ? { stratification, last_contract_year: contract.year } : { last_contract_year: contract.year },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows.sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
}
