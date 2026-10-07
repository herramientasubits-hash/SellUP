/**
 * cr-company-registry-rows.ts — empresas y entidades de Costa Rica con cédula
 * jurídica y nombre, para la cédula por nombre dentro de la corrida del Agente 1.
 *
 * SOURCES-CR-CEDULA-BY-NAME-1 + SOURCES-CR-CLOSE-1. Puro: sin env, sin I/O, sin
 * DB, sin reloj.
 *
 * Costa Rica no publica un padrón completo de personas jurídicas (el Registro
 * Nacional exige usuario y captcha; la consulta de Hacienda bloquea por
 * geografía). Se combinan archivos oficiales y gratuitos, de más a menos
 * autoridad sobre el NOMBRE (el primero que trae una cédula pone la razón social;
 * los nombres de las demás fuentes quedan como alias):
 *
 *   1. Hacienda «Grandes Contribuyentes Nacionales» (cuando la dueña lo aporta).
 *   2. PROCOMER «Empresas en Régimen de Zona Franca» (Excel oficial; trae el
 *      nombre anterior: «(antes …)»).
 *   3. SUGEF «Entidades supervisadas» (bancos, financieras, cooperativas).
 *   4. Instituciones compradoras de SICOP (Hacienda, datos.go.cr, CC-BY):
 *      ministerios, poderes, autónomas, municipalidades, universidades públicas.
 *   5. MEIC «Lista de Pymes activas» (datos.go.cr, CC-BY): su TAMAÑO (micro,
 *      pequeña, mediana) viaja SIEMPRE, aunque el nombre venga de otra fuente.
 *   6. Hacienda SICOP «recursos» y «aclaraciones» 2022-2024 (proveedores con nombre;
 *      la columna SOLICITANTE de aclaraciones es una persona y NUNCA se lee).
 *
 * Entran cédulas jurídicas de sociedades (3…) y de entes públicos (2… poderes y
 * ministerios, 4… autónomas y bancos del Estado). Nunca cédulas físicas ni DIMEX.
 * Una cédula = una fila.
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  costaRicaNameCore,
  costaRicaOwnNameKeys,
  costaRicaRegistryAliasKeys,
  currentCostaRicaName,
} from './cr-name-keys';
import { costaRicaWebAliasKey } from './cr-domain';

export const CR_COMPANY_REGISTRY_SOURCE_KEY = 'cr_company_registry' as const;
export const CR_COMPANY_NAME_ALIAS_SOURCE_KEY = 'cr_company_name_alias' as const;
export const CR_COUNTRY_CODE = 'CR' as const;

/** Espacio de nombres de la identidad de un alias (`cr-name-alias:<cédula>:<clave>`). */
export const CR_NAME_ALIAS_IDENTITY_NAMESPACE = 'cr-name-alias' as const;

/** Cédula jurídica de sociedad (3…) o de ente público (2…, 4…): 10 dígitos. */
export const CR_JURIDICAL_CEDULA = /^[234]\d{9}$/;

/** Año de corte de la lista de PYMES del MEIC publicada (enero 2025). */
export const CR_MEIC_SIZE_DEFAULT_YEAR = 2025;

export type CrRegistryOrigin =
  | 'hacienda_grandes_contribuyentes'
  | 'procomer_zona_franca'
  | 'sugef'
  | 'sicop_institution'
  | 'meic_pymes'
  | 'sicop_recursos'
  | 'sicop_aclaraciones';

/** Orden de autoridad sobre el nombre (el menor gana). */
const ORIGIN_RANK: Readonly<Record<CrRegistryOrigin, number>> = {
  hacienda_grandes_contribuyentes: 0,
  procomer_zona_franca: 1,
  sugef: 2,
  sicop_institution: 3,
  meic_pymes: 4,
  sicop_recursos: 5,
  sicop_aclaraciones: 6,
};

export type CrCompanyRegistryRow = {
  source_key: typeof CR_COMPANY_REGISTRY_SOURCE_KEY;
  country_code: typeof CR_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

export type CrCompanyNameAliasRow = Omit<CrCompanyRegistryRow, 'source_key'> & {
  source_key: typeof CR_COMPANY_NAME_ALIAS_SOURCE_KEY;
};

/** Una cédula con su nombre, tal como la da una fuente. */
export type CrNamedCedula = { cedula: unknown; name: unknown };

export type CrSourceRecords = {
  pymes?: readonly Record<string, unknown>[];
  recursos?: readonly Record<string, unknown>[];
  aclaraciones?: readonly Record<string, unknown>[];
  /** Filas del Excel de Zona Franca de PROCOMER. */
  zonaFranca?: readonly Record<string, unknown>[];
  /** Entidades de la lista de SUGEF (ya extraídas del PDF). */
  sugef?: readonly CrNamedCedula[];
  /** Instituciones compradoras de SICOP (CEDULA_INSTITUCION, INSTITUCION). */
  institutions?: readonly CrNamedCedula[];
  /** Grandes Contribuyentes Nacionales de Hacienda (ya extraídos del PDF). */
  grandesContribuyentes?: readonly CrNamedCedula[];
  /** Siglas oficiales por cédula (MIDEPLAN, cruzadas por nombre en la carga). */
  acronymsByCedula?: ReadonlyMap<string, readonly string[]>;
  /**
   * Web oficial por cédula (ficha de MIDEPLAN de una entidad pública). Se guarda
   * como alias `web:<dominio>`: la candidata con esa misma web encuentra la cédula
   * aunque su nombre sea una sigla que MIDEPLAN no publica («TEC» → tec.ac.cr).
   */
  websitesByCedula?: ReadonlyMap<string, string>;
};

/** Núcleo del nombre costarricense: el MISMO que calcula el resolvedor de la corrida. */
export function normalizeCostaRicaCompanyCore(name: string | null | undefined): string {
  return costaRicaNameCore(name);
}

/**
 * Cédula cruda → 10 dígitos de sociedad o ente público, o `null`. Zona Franca
 * escribe a veces un sufijo de planta («3-101-028685-24»): mandan los 10 primeros.
 */
export function normalizeCostaRicaCompanyCedula(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const groups = String(raw).trim().split(/[^\d]+/).filter((g) => g.length > 0);
  const joined = groups.join('');
  if (CR_JURIDICAL_CEDULA.test(joined)) return joined;
  // «3-101-028685-24»: cédula + sufijo de planta.
  if (groups.length >= 4 && joined.length > 10 && CR_JURIDICAL_CEDULA.test(joined.slice(0, 10))) {
    const firstTen = groups.slice(0, 3).join('');
    return CR_JURIDICAL_CEDULA.test(firstTen) ? firstTen : null;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const clean = String(value).replace(/\s+/g, ' ').trim();
  return clean.length > 0 ? clean : null;
}

/** Tramo PYME del MEIC normalizado, o `null`. */
export function normalizeCostaRicaMeicSize(raw: unknown): 'MICRO' | 'PEQUEÑA' | 'MEDIANA' | null {
  const value = text(raw)?.toUpperCase().replace('PEQUENA', 'PEQUEÑA') ?? null;
  return value === 'MICRO' || value === 'PEQUEÑA' || value === 'MEDIANA' ? value : null;
}

type Entry = {
  cedula: string;
  legalName: string;
  rank: number;
  origins: Set<CrRegistryOrigin>;
  otherNames: string[];
  meicSize: 'MICRO' | 'PEQUEÑA' | 'MEDIANA' | null;
  meicProvince: string | null;
  meicCiiu: string | null;
};

/** Combina las fuentes en una fila por cédula (el nombre lo pone la más autorizada). */
export function buildCrCompanyRegistryRows(
  records: CrSourceRecords,
  params: { sourceYear: number; importedAt: string; meicSizeYear?: number },
): CrCompanyRegistryRow[] {
  return buildCrCompanyRegistry(records, params).registry;
}

/** Registro + alias. Los alias nunca son el nombre propio de otra cédula. */
export function buildCrCompanyRegistry(
  records: CrSourceRecords,
  params: { sourceYear: number; importedAt: string; meicSizeYear?: number },
): { registry: CrCompanyRegistryRow[]; aliases: CrCompanyNameAliasRow[] } {
  const byCedula = new Map<string, Entry>();

  const offer = (cedulaRaw: unknown, nameRaw: unknown, origin: CrRegistryOrigin): Entry | null => {
    const cedula = normalizeCostaRicaCompanyCedula(cedulaRaw);
    // La primera línea manda (Zona Franca escribe sus plantas en las siguientes).
    const firstLine = typeof nameRaw === 'string' ? nameRaw.split(/\r?\n/)[0] : nameRaw;
    const rawName = text(firstLine);
    if (cedula === null || rawName === null) return null;
    const legalName = text(currentCostaRicaName(rawName)) ?? rawName;
    if (costaRicaNameCore(legalName).length < 2) return null;
    const rank = ORIGIN_RANK[origin];
    const existing = byCedula.get(cedula);
    if (existing === undefined) {
      const entry: Entry = {
        cedula,
        legalName,
        rank,
        origins: new Set([origin]),
        otherNames: rawName !== legalName ? [rawName] : [],
        meicSize: null,
        meicProvince: null,
        meicCiiu: null,
      };
      byCedula.set(cedula, entry);
      return entry;
    }
    existing.origins.add(origin);
    if (rank < existing.rank) {
      existing.otherNames.push(existing.legalName);
      existing.legalName = legalName;
      existing.rank = rank;
      if (rawName !== legalName) existing.otherNames.push(rawName);
    } else {
      existing.otherNames.push(rawName);
    }
    return existing;
  };

  const pairs = (list: readonly CrNamedCedula[] | undefined, origin: CrRegistryOrigin) => {
    for (const item of list ?? []) offer(item.cedula, item.name, origin);
  };
  pairs(records.grandesContribuyentes, 'hacienda_grandes_contribuyentes');
  for (const record of records.zonaFranca ?? []) {
    offer(record['CED. JURID.'], record['Empresa'], 'procomer_zona_franca');
  }
  pairs(records.sugef, 'sugef');
  pairs(records.institutions, 'sicop_institution');
  for (const record of records.pymes ?? []) {
    const entry = offer(record['IDENTIFICACION'], record['NOMBRE'], 'meic_pymes');
    if (entry === null) continue;
    entry.meicSize = normalizeCostaRicaMeicSize(record['TAMAÑO']);
    entry.meicProvince = text(record['PROVINCIA']);
    entry.meicCiiu = text(record['ACTIVIDAD CIIU']);
  }
  for (const record of records.recursos ?? []) offer(record['CEDULA_PROVEEDOR'], record['PROVEEDOR'], 'sicop_recursos');
  for (const record of records.aclaraciones ?? []) {
    offer(record['CEDULA_PROVEEDOR'], record['EMPRESA_PROVEEDORA'], 'sicop_aclaraciones');
  }

  const meicYear = params.meicSizeYear ?? CR_MEIC_SIZE_DEFAULT_YEAR;
  const registry: CrCompanyRegistryRow[] = [];
  for (const entry of byCedula.values()) {
    const identity = deriveTaxRecordIdentity(entry.cedula);
    const origins = [...entry.origins].sort((a, b) => ORIGIN_RANK[a] - ORIGIN_RANK[b]);
    registry.push({
      source_key: CR_COMPANY_REGISTRY_SOURCE_KEY,
      country_code: CR_COUNTRY_CODE,
      source_year: params.sourceYear,
      tax_id: entry.cedula,
      normalized_tax_id: entry.cedula,
      legal_name: entry.legalName,
      normalized_legal_name: costaRicaNameCore(entry.legalName),
      raw_data: {
        origin: origins[0],
        origins,
        ...(entry.meicSize
          ? { cr_meic_size: entry.meicSize, cr_meic_size_year: meicYear }
          : {}),
        ...(entry.meicProvince ? { province: entry.meicProvince } : {}),
        ...(entry.meicCiiu ? { ciiu: entry.meicCiiu } : {}),
      },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  registry.sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));

  // Nombres PROPIOS de cada cédula: un alias nunca puede ser el de otra.
  const ownerByKey = new Map<string, Set<string>>();
  for (const row of registry) {
    for (const key of costaRicaOwnNameKeys(row.normalized_legal_name)) {
      ownerByKey.set(key, (ownerByKey.get(key) ?? new Set()).add(row.tax_id));
    }
  }

  // Una web que aparece en dos cédulas sólo identifica a la que la tiene en la
  // raíz (un órgano adscrito suele apuntar a una página dentro de la web de su
  // ministerio); si ninguna o varias, no identifica a ninguna.
  const webKeyByCedula = new Map<string, string>();
  const webCedulas = new Map<string, { cedula: string; root: boolean }[]>();
  for (const [cedula, url] of records.websitesByCedula ?? []) {
    const key = costaRicaWebAliasKey(url);
    if (key === null || !byCedula.has(cedula)) continue;
    const root = !/^[a-z]+:\/\/[^/]+\/[^?#\s]+/i.test(url.trim());
    webCedulas.set(key, [...(webCedulas.get(key) ?? []), { cedula, root }]);
  }
  for (const [key, owners] of webCedulas) {
    const pick = owners.length === 1 ? owners : owners.filter((o) => o.root);
    if (pick.length === 1) webKeyByCedula.set(pick[0].cedula, key);
  }

  const aliases: CrCompanyNameAliasRow[] = [];
  for (const row of registry) {
    const entry = byCedula.get(row.tax_id)!;
    const keys = costaRicaRegistryAliasKeys({
      legalName: entry.legalName,
      otherNames: entry.otherNames,
      acronyms: records.acronymsByCedula?.get(row.tax_id) ?? [],
    });
    const webKey = webKeyByCedula.get(row.tax_id);
    if (webKey !== undefined) keys.push(webKey);
    const seen = new Set<string>([row.normalized_legal_name]);
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      const owners = ownerByKey.get(key);
      if (owners !== undefined && !(owners.size === 1 && owners.has(row.tax_id))) continue;
      const identity = buildRecordIdentityKey(CR_NAME_ALIAS_IDENTITY_NAMESPACE, `${row.tax_id}:${key}`);
      aliases.push({
        ...row,
        source_key: CR_COMPANY_NAME_ALIAS_SOURCE_KEY,
        normalized_legal_name: key,
        raw_data: { ...row.raw_data, alias_of: row.normalized_legal_name },
        record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
      });
    }
  }
  aliases.sort((a, b) => a.tax_id.localeCompare(b.tax_id) || a.normalized_legal_name.localeCompare(b.normalized_legal_name));
  return { registry, aliases };
}
