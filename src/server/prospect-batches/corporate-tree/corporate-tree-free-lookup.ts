/**
 * Agente 1 · Búsqueda en árbol — PRIMERO lo gratis (AGENT1-CORPORATE-TREE-2).
 *
 * Antes de pagar a Claude se busca la familia por NOMBRE en lo que ya es nuestro:
 *  - los registros y directorios oficiales de cada país (`source_company_snapshots`,
 *    las mismas cargas de la capa gratuita): nombre legal, número fiscal y, si la
 *    fuente lo publica, web, trabajadores y sector;
 *  - el banco de empresas (`agent1_company_bank`), sólo lectura.
 *
 * Búsqueda por PREFIJO del nombre normalizado («cencosud» encuentra «CENCOSUD PERU
 * S.A.» y «CENCOSUD RETAIL S.A.»), con el índice `(source_key, normalized_legal_name)`:
 * un rango `>= core` y `< siguiente` por fuente, acotado (0,25 ms en `cl_sii_registry`,
 * 1,7 M filas). Medido en Prod el 14-10: Cencosud aparece con número fiscal en CL, PE,
 * BR, AR y CO sin pagar nada.
 *
 * 🔴 Casi todas las fuentes guardan el nombre normalizado en MAYÚSCULAS (sólo co_siis en
 * minúsculas). El rango en minúsculas las cubre porque la base ordena con `en_US.UTF-8`
 * (mayúsculas y minúsculas comparten orden primario). Lo que el rango cuele de más se
 * descarta aquí al confirmar el prefijo.
 *
 * Lo gratis encuentra a la familia que COMPARTE el nombre (sedes en otros países,
 * filiales «X Retail», «X Perú»). La matriz y las filiales con otro nombre (Banco
 * París, Easy) las busca Claude después, sólo por lo que falte.
 *
 * Puro: las consultas se inyectan.
 */

import type { CorporateTreeRelation } from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';
import { normalizeTreeName } from './corporate-tree-search';

/**
 * Fuentes oficiales por país, de más rica (directorio con web/tamaño/sector) a más
 * amplia (registro completo). Los alias apuntan a la razón social oficial.
 */
export const CORPORATE_TREE_FREE_SOURCE_KEYS: Readonly<Record<string, readonly string[]>> = {
  AR: ['ar_rns', 'ar_public_entities', 'ar_atp_employers', 'ar_rns_registry'],
  BO: ['bo_large_taxpayers', 'bo_public_entities', 'bo_name_alias'],
  BR: ['br_receita_directory', 'br_receita_registry', 'br_receita_name_alias'],
  CL: ['cl_sii_directory', 'cl_sii_registry', 'cl_sii_name_alias'],
  CO: ['co_siis', 'co_public_entities'],
  CR: ['cr_free_directory', 'cr_company_registry', 'cr_company_name_alias'],
  DO: ['do_dgii_size_registry', 'rd_dgii_bulk', 'do_dgii_trade_name_registry'],
  EC: ['ec_scvs_directory', 'ec_scvs_registry', 'ec_sri_registry', 'ec_scvs_alias_registry'],
  ES: ['es_free_directory', 'es_official_nif_registry', 'es_nif_name_alias'],
  GT: ['gt_guatecompras_directory', 'gt_nit_registry', 'gt_nit_name_alias'],
  HN: ['hn_honducompras_directory', 'hn_ocds_rtn_registry', 'hn_rtn_name_alias'],
  MX: ['mx_rfc_public_lists_registry', 'mx_compranet_rfc_registry'],
  NI: ['ni_free_directory', 'ni_ruc_registry', 'ni_ruc_name_alias'],
  PA: ['pa_free_directory', 'pa_ruc_registry', 'pa_ruc_name_alias'],
  PE: ['pe_sunat_directory', 'pe_sunat_registry', 'pe_sunat_name_alias'],
  PY: ['py_dncp_directory', 'py_set_registry', 'py_set_name_alias'],
  SV: ['sv_large_taxpayer_directory', 'sv_nit_registry', 'sv_nit_name_alias'],
  US: ['us_free_directory', 'us_sec_edgar_registry', 'us_irs_eo_registry'],
  UY: ['uy_arce_directory', 'uy_rupe_registry', 'uy_rupe_name_alias'],
  VE: ['ve_free_directory', 've_rif_registry', 've_rif_name_alias'],
};

/** Tipo de número fiscal por país cuando la fuente no lo dice. */
const TAX_ID_TYPE_BY_COUNTRY: Readonly<Record<string, CountrySourceCompany['taxIdentifierType']>> = {
  AR: 'CUIT', BO: 'NIT', BR: 'CNPJ', CL: 'RUT', CO: 'NIT', CR: 'cedula_juridica', DO: 'RNC', EC: 'RUC',
  ES: 'NIF', GT: 'NIT', HN: 'RTN', MX: 'RFC', NI: 'RUC', PA: 'RUC', PE: 'RUC', PY: 'RUC', SV: 'NIT',
  US: 'EIN', UY: 'RUT', VE: 'RIF',
};
const KNOWN_TAX_ID_TYPES = new Set(Object.values(TAX_ID_TYPE_BY_COUNTRY).concat(['other']));

/** Filas por fuente y prefijo (homónimos y razones sociales de un mismo grupo). */
export const CORPORATE_TREE_FREE_ROWS_PER_SOURCE = 12;
/** Empresas gratis por país que entran al lote. */
export const CORPORATE_TREE_FREE_HITS_PER_COUNTRY = 6;
/** Por debajo de esto el prefijo traería media base («grupo», «banco»). */
const MIN_CORE_CHARS = 4;
/** Palabras que preceden al nombre propio y no lo identifican. */
const GENERIC_LEADING_WORDS = /^(grupo|corporacion|corporativo|holding|organizacion|compania|cia|inversiones|empresas)\s+/;

export type FreeSnapshotRow = {
  source_key: string;
  country_code: string;
  legal_name: string | null;
  normalized_legal_name: string | null;
  tax_id: string | null;
  normalized_tax_id: string | null;
  city: string | null;
  region: string | null;
  record_identity_key: string | null;
  raw_data: Record<string, unknown> | null;
};

export type FreeBankRow = {
  id: string;
  country_code: string;
  source_provider: string;
  payload: Record<string, unknown> | null;
};

export type CorporateTreeFreeHit = {
  origin: 'catalog' | 'bank';
  relation: CorporateTreeRelation;
  countryCode: string;
  name: string;
  /** Nombre normalizado SIN forma societaria (para no repetir y para Claude). */
  core: string;
  taxId: string | null;
  domain: string | null;
  workers: number | null;
  sourceKey: string;
  /** Lo que se escribe por la capa gratuita (catálogo). */
  company: CountrySourceCompany | null;
  /** Lo que se escribe por el escritor del Agente 1 (banco). */
  bankCandidate: ProspectingPipelineCandidate | null;
};

export type CorporateTreeFreeLookupDeps = {
  querySnapshotsByPrefix: (sourceKey: string, prefix: string, limit: number) => Promise<FreeSnapshotRow[]>;
  queryBankByNamePrefix: (countryCodes: readonly string[], prefix: string, limit: number) => Promise<FreeBankRow[]>;
  readBankCandidate: (payload: unknown) => ProspectingPipelineCandidate | null;
};

/** Prefijos de búsqueda: el nombre sin forma societaria y, si empieza por «Grupo…», sin esa palabra. */
export function corporateTreeNameCores(rootName: string): string[] {
  const core = normalizeTreeName(rootName);
  const cores = [core];
  const withoutGeneric = core.replace(GENERIC_LEADING_WORDS, '');
  if (withoutGeneric !== core) cores.push(withoutGeneric);
  return [...new Set(cores)].filter((c) => c.length >= MIN_CORE_CHARS);
}

/**
 * Cota superior del rango: el prefijo seguido de letras «z». Con `en_US` los signos
 * (`{`, `:`) ordenan ANTES que letras y dígitos, así que «último carácter + 1» vaciaba
 * el rango para prefijos que terminan en «z» o en un dígito («grupo diaz»). Lo que
 * pase de largo lo descarta la confirmación del prefijo.
 */
export function prefixUpperBound(prefix: string): string {
  return `${prefix}zzzzzzzzzz`;
}

/** Para `ilike`: el prefijo sin comodines (`%`, `_`) ni la barra de escape. */
export function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function readDomain(raw: Record<string, unknown> | null): string | null {
  const domain = text(raw?.['website_domain']);
  return domain ? domain.toLowerCase().replace(/^www\./, '') : null;
}

function readWorkers(raw: Record<string, unknown> | null): number | null {
  return positiveInt(raw?.['workers']) ?? positiveInt(raw?.['official_workers']);
}

function readTaxIdType(raw: Record<string, unknown> | null, countryCode: string): CountrySourceCompany['taxIdentifierType'] {
  const declared = text(raw?.['tax_identifier_type']);
  if (declared && KNOWN_TAX_ID_TYPES.has(declared as never)) return declared as CountrySourceCompany['taxIdentifierType'];
  return TAX_ID_TYPE_BY_COUNTRY[countryCode] ?? 'other';
}

/** Rama de una empresa encontrada gratis: misma razón base en el país de partida = la propia. */
export function classifyFreeHit(params: {
  core: string;
  rootCore: string;
  countryCode: string;
  rootCountryCode: string | null;
}): CorporateTreeRelation {
  if (params.rootCountryCode && params.countryCode !== params.rootCountryCode) return 'other_country';
  if (params.core === params.rootCore) return 'root';
  return params.rootCountryCode ? 'subsidiary' : 'other_country';
}

function toCompany(row: FreeSnapshotRow): CountrySourceCompany | null {
  const legalName = text(row.legal_name);
  if (!legalName) return null;
  const raw = row.raw_data ?? null;
  return {
    recordIdentityKey: row.record_identity_key ?? `${row.source_key}:${row.normalized_tax_id ?? legalName}`,
    legalName,
    normalizedLegalName: row.normalized_legal_name,
    taxId: text(row.tax_id) ?? text(row.normalized_tax_id),
    taxIdentifierType: readTaxIdType(raw, row.country_code),
    countryCode: row.country_code,
    city: row.city,
    region: row.region,
    domain: readDomain(raw),
    declaredIndustry: text(raw?.['activity_text']) ?? text(raw?.['activity']) ?? null,
    industryCode: text(raw?.['activity_code']) ?? text(raw?.['ciiu4_code']) ?? null,
    coarseSector: null,
    officialMacroIndustry: null,
    // El tamaño oficial viaja como en la capa gratuita: el escritor y la ficha lo usan.
    officialWorkforce: (() => {
      const workers = readWorkers(raw);
      return workers ? { workers, year: positiveInt(raw?.['metrics_year']), sourceLabel: row.source_key } : null;
    })(),
    originSourceKey: row.source_key,
  };
}

/**
 * El país de partida cuando no se sabe: el de la fila cuyo nombre es EXACTAMENTE el
 * de la empresa (sin forma societaria), y entre ellas la de más trabajadores.
 */
export function inferRootCountry(hits: readonly Pick<CorporateTreeFreeHit, 'core' | 'countryCode' | 'workers'>[], rootCore: string): string | null {
  const exact = hits.filter((h) => h.core === rootCore);
  if (exact.length === 0) return null;
  return [...exact].sort((a, b) => (b.workers ?? 0) - (a.workers ?? 0))[0].countryCode;
}

export async function findCorporateTreeFreeHits(
  input: { rootName: string; rootCountryCode: string | null; countryCodes: readonly string[] },
  deps: CorporateTreeFreeLookupDeps,
): Promise<{ hits: CorporateTreeFreeHit[]; rootCountryCode: string | null; queries: number; errors: number }> {
  const rootCore = normalizeTreeName(input.rootName);
  const cores = corporateTreeNameCores(input.rootName);
  if (cores.length === 0) return { hits: [], rootCountryCode: input.rootCountryCode, queries: 0, errors: 0 };

  let queries = 0;
  let errors = 0;
  const tasks: Array<Promise<CorporateTreeFreeHit[]>> = [];
  for (const countryCode of input.countryCodes) {
    for (const sourceKey of CORPORATE_TREE_FREE_SOURCE_KEYS[countryCode] ?? []) {
      for (const core of cores) {
        queries++;
        tasks.push(
          deps
            .querySnapshotsByPrefix(sourceKey, core, CORPORATE_TREE_FREE_ROWS_PER_SOURCE)
            .catch(() => {
              errors++;
              return [] as FreeSnapshotRow[];
            })
            .then((rows) =>
              rows.flatMap((row): CorporateTreeFreeHit[] => {
                // La colación de la base puede colar vecinos del rango: se confirma el prefijo aquí.
                const company = toCompany(row);
                if (!company || row.country_code !== countryCode) return [];
                const hitCore = normalizeTreeName(company.legalName ?? '');
                if (!hitCore.startsWith(core)) return [];
                return [
                  {
                    origin: 'catalog',
                    relation: 'other_country',
                    countryCode,
                    name: company.legalName ?? hitCore,
                    core: hitCore,
                    taxId: company.taxId,
                    domain: company.domain,
                    workers: readWorkers(row.raw_data),
                    sourceKey,
                    company,
                    bankCandidate: null,
                  },
                ];
              }),
            ),
        );
      }
    }
  }
  for (const core of cores) {
    queries++;
    tasks.push(
      deps
        .queryBankByNamePrefix(input.countryCodes, core, CORPORATE_TREE_FREE_ROWS_PER_SOURCE)
        .catch(() => {
          errors++;
          return [] as FreeBankRow[];
        })
        .then((rows) =>
          rows.flatMap((row): CorporateTreeFreeHit[] => {
            const candidate = deps.readBankCandidate(row.payload);
            if (!candidate) return [];
            const hitCore = normalizeTreeName(candidate.name);
            if (!hitCore.startsWith(core)) return [];
            return [
              {
                origin: 'bank',
                relation: 'other_country',
                countryCode: row.country_code,
                name: candidate.name,
                core: hitCore,
                taxId: null,
                domain: candidate.domain ?? null,
                workers: null,
                sourceKey: `company_bank:${row.source_provider}`,
                company: null,
                bankCandidate: candidate,
              },
            ];
          }),
        ),
    );
  }

  const all = (await Promise.all(tasks)).flat();
  const rootCountryCode = input.rootCountryCode ?? inferRootCountry(all, rootCore);

  // Una empresa una vez: por país × número fiscal, o país × nombre. Gana la fuente
  // más rica (orden de la lista; el banco va primero porque trae web y tamaño).
  const rank = (hit: CorporateTreeFreeHit) =>
    hit.origin === 'bank' ? -1 : (CORPORATE_TREE_FREE_SOURCE_KEYS[hit.countryCode] ?? []).indexOf(hit.sourceKey);
  const sorted = [...all].sort((a, b) => rank(a) - rank(b) || (b.workers ?? 0) - (a.workers ?? 0));
  const seen = new Set<string>();
  const perCountry = new Map<string, number>();
  const hits: CorporateTreeFreeHit[] = [];
  for (const hit of sorted) {
    const keys = [`${hit.countryCode}|name:${hit.core}`, ...(hit.taxId ? [`${hit.countryCode}|tax:${hit.taxId.replace(/\W/g, '')}`] : [])];
    if (keys.some((k) => seen.has(k))) continue;
    if ((perCountry.get(hit.countryCode) ?? 0) >= CORPORATE_TREE_FREE_HITS_PER_COUNTRY) continue;
    keys.forEach((k) => seen.add(k));
    perCountry.set(hit.countryCode, (perCountry.get(hit.countryCode) ?? 0) + 1);
    hits.push({
      ...hit,
      relation: classifyFreeHit({ core: hit.core, rootCore, countryCode: hit.countryCode, rootCountryCode }),
    });
  }
  return { hits, rootCountryCode, queries, errors };
}
