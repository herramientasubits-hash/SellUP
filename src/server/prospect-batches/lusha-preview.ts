/**
 * Lusha Read-Only Preview — Q3F-5BB.3
 *
 * Núcleo puro (sin 'use server', sin I/O directo) del preview read-only de
 * empresas Lusha para el wizard del Agente 1.
 *
 * Reglas de diseño / seguridad:
 *   - No escribe en Supabase ni en ningún store. No hay dependencia de escritura.
 *   - No hace enrichment, people search ni contact search.
 *   - No emite technologies, intentTopics ni signals.
 *   - Hardcodea page = 0, size = 10, expectedMaxCredits = 1 (server-authoritative).
 *   - La ejecución solo ocurre cuando el server action llama a executeLushaPreview
 *     tras un click explícito del usuario. Este módulo no se auto-ejecuta.
 *
 * Contexto validado:
 *   - Q3F-5BB.2  : search devuelve firmografía completa; 1 crédito por página.
 *   - Q3F-5BB.2B : subIndustriesIds funciona (AND con mainIndustriesIds);
 *                  searchText funciona pero es frágil (avanzado/opcional);
 *                  Lusha exige pagination.size >= 10.
 */

import type {
  LushaCompanyProspectingV3Company,
  LushaCompanyProspectingV3Request,
  LushaCompanyProspectingV3Result,
} from '@/server/integrations/lusha-client';
import {
  isSubIndustryValidForSector,
  resolveLushaSectorOption,
  type LushaSectorKey,
} from '@/server/prospect-batches/lusha-sector-mapping';

// ─── Guardrails de crédito (server-authoritative) ────────────────────────────

/** Página forzada. Base 0 (OpenAPI V3). */
export const LUSHA_PREVIEW_PAGE = 0;
/** Tamaño de página forzado. Mínimo aceptado por Lusha V3 (Q3F-5E). */
export const LUSHA_PREVIEW_SIZE = 10;
/** Crédito máximo esperado por preview (1 crédito/página, Q3F-5BB.2B). */
export const LUSHA_PREVIEW_EXPECTED_MAX_CREDITS = 1 as const;
/** Score mínimo sugerido para pasar el gate de calidad. */
export const LUSHA_PREVIEW_DEFAULT_MIN_SCORE = 70;
/** Timeout de la llamada de preview. */
export const LUSHA_PREVIEW_TIMEOUT_MS = 20_000;

// ─── Bandas de tamaño (UI + request) ──────────────────────────────────────────

export interface LushaPreviewSizeBand {
  key: string;
  label: string;
  min?: number;
  max?: number;
}

export const LUSHA_PREVIEW_SIZE_BANDS: readonly LushaPreviewSizeBand[] = [
  { key: '51-200', label: '51–200 empleados', min: 51, max: 200 },
  { key: '201-1000', label: '201–1000 empleados', min: 201, max: 1000 },
  { key: '1001-5000', label: '1001–5000 empleados', min: 1001, max: 5000 },
  { key: '201-5000', label: '201–5000 empleados (recomendado)', min: 201, max: 5000 },
  { key: '5000+', label: 'Más de 5000 empleados', min: 5001 },
];

export const LUSHA_PREVIEW_DEFAULT_SIZE_BAND_KEY = '201-5000';

export function resolveLushaPreviewSizeBand(key: string | null | undefined): LushaPreviewSizeBand | null {
  if (!key) return null;
  return LUSHA_PREVIEW_SIZE_BANDS.find((band) => band.key === key) ?? null;
}

// ─── País: código SellUp → nombre aceptado por Lusha (inglés) ─────────────────

const COUNTRY_ISO2_TO_LUSHA_NAME: Record<string, string> = {
  CO: 'Colombia',
  MX: 'Mexico',
  CL: 'Chile',
  AR: 'Argentina',
  BR: 'Brazil',
  PE: 'Peru',
  UY: 'Uruguay',
  EC: 'Ecuador',
  PY: 'Paraguay',
  BO: 'Bolivia',
  VE: 'Venezuela',
  GT: 'Guatemala',
  HN: 'Honduras',
  SV: 'El Salvador',
  NI: 'Nicaragua',
  CR: 'Costa Rica',
  PA: 'Panama',
  DO: 'Dominican Republic',
  US: 'United States',
  ES: 'Spain',
};

/** Nombres (normalizados, ES/EN) → ISO2, para resolver el país del response. */
const COUNTRY_NAME_TO_ISO2: Record<string, string> = {
  colombia: 'CO',
  mexico: 'MX',
  chile: 'CL',
  argentina: 'AR',
  brazil: 'BR',
  brasil: 'BR',
  peru: 'PE',
  uruguay: 'UY',
  ecuador: 'EC',
  paraguay: 'PY',
  bolivia: 'BO',
  venezuela: 'VE',
  guatemala: 'GT',
  honduras: 'HN',
  'el salvador': 'SV',
  nicaragua: 'NI',
  'costa rica': 'CR',
  panama: 'PA',
  'dominican republic': 'DO',
  'republica dominicana': 'DO',
  'united states': 'US',
  'estados unidos': 'US',
  usa: 'US',
  spain: 'ES',
  espana: 'ES',
};

export function resolveLushaCountryName(code: string | null | undefined): string | null {
  if (!code) return null;
  return COUNTRY_ISO2_TO_LUSHA_NAME[code.trim().toUpperCase()] ?? null;
}

// ─── Normalización de texto/dominio ───────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normaliza un dominio para dedupe: minúsculas, sin protocolo/www/path. */
export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const withoutProtocol = trimmed.replace(/^[a-z]+:\/\//, '');
  const host = withoutProtocol.split('/')[0]?.split('?')[0] ?? '';
  const bare = host.replace(/^www\./, '').trim();
  return bare.length > 0 ? bare : null;
}

function countryIso2FromName(country: string | null | undefined): string | null {
  if (!country) return null;
  const normalized = normalizeText(country);
  if (normalized.length === 2 && /^[a-z]{2}$/.test(normalized)) return normalized.toUpperCase();
  return COUNTRY_NAME_TO_ISO2[normalized] ?? null;
}

// ─── Request builder (puro, guardrails hardcodeados) ──────────────────────────

export interface BuildLushaPreviewRequestInput {
  /** Nombre de país aceptado por Lusha (inglés). */
  countryName: string;
  mainIndustriesIds: number[];
  subIndustryId?: number | null;
  sizeBand?: { min?: number; max?: number } | null;
  searchText?: string | null;
}

/**
 * Construye el request POST /v3/companies/prospecting para el preview.
 * Fuerza page=0 y size=10. NUNCA emite technologies, intentTopics ni signals.
 * subIndustriesIds y searchText solo se incluyen cuando vienen válidos.
 */
export function buildLushaPreviewRequest(
  input: BuildLushaPreviewRequestInput,
): LushaCompanyProspectingV3Request {
  const include: NonNullable<
    NonNullable<LushaCompanyProspectingV3Request['filters']>['companies']
  >['include'] = {
    locations: [{ country: input.countryName }],
  };

  if (input.mainIndustriesIds.length > 0) {
    include.mainIndustriesIds = [...input.mainIndustriesIds];
  }

  if (typeof input.subIndustryId === 'number') {
    include.subIndustriesIds = [input.subIndustryId];
  }

  if (input.sizeBand && (typeof input.sizeBand.min === 'number' || typeof input.sizeBand.max === 'number')) {
    const size: { min?: number; max?: number } = {};
    if (typeof input.sizeBand.min === 'number') size.min = input.sizeBand.min;
    if (typeof input.sizeBand.max === 'number') size.max = input.sizeBand.max;
    include.sizes = [size];
  }

  const trimmedSearch = typeof input.searchText === 'string' ? input.searchText.trim() : '';
  if (trimmedSearch.length > 0) {
    include.searchText = trimmedSearch;
  }

  return {
    filters: { companies: { include } },
    pagination: { page: LUSHA_PREVIEW_PAGE, size: LUSHA_PREVIEW_SIZE },
    options: { includePartialProfiles: false },
    // signals intencionalmente ausente — nunca se emite en preview.
  };
}

// ─── Normalización + gate de calidad ──────────────────────────────────────────

export interface LushaPreviewCriteria {
  expectedCountryName: string;
  expectedCountryIso2: string;
  sectorKey: LushaSectorKey;
  sectorLabel: string;
  matchKeywords: string[];
  sizeBand: { min?: number; max?: number } | null;
  minScore: number;
}

export interface LushaPreviewCompany {
  providerCompanyId: string | null;
  name: string | null;
  domain: string | null;
  country: string | null;
  countryIso2: string | null;
  industry: string | null;
  employeesExact: number | null;
  employeesMin: number | null;
  employeesMax: number | null;
  linkedinUrl: string | null;
  score: number;
  passesGate: boolean;
  issues: string[];
}

function clampScore(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function countryMatches(company: LushaCompanyProspectingV3Company, criteria: LushaPreviewCriteria): boolean {
  const companyIso2 =
    (typeof company.countryIso2 === 'string' && company.countryIso2.trim()
      ? company.countryIso2.trim().toUpperCase()
      : null) ?? countryIso2FromName(company.country);
  if (companyIso2 && criteria.expectedCountryIso2) {
    return companyIso2 === criteria.expectedCountryIso2;
  }
  if (!company.country) return false;
  const normalizedCompany = normalizeText(company.country);
  const normalizedExpected = normalizeText(criteria.expectedCountryName);
  if (!normalizedCompany || !normalizedExpected) return false;
  return normalizedCompany === normalizedExpected || normalizedCompany.includes(normalizedExpected);
}

function industryMatches(industry: string | null | undefined, keywords: string[]): boolean {
  if (!industry) return false;
  const normalized = normalizeText(industry);
  if (!normalized) return false;
  return keywords.some((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) return false;
    return normalized.includes(normalizedKeyword) || normalizedKeyword.includes(normalized);
  });
}

function employeesOutOfBand(
  company: LushaCompanyProspectingV3Company,
  band: { min?: number; max?: number } | null,
): boolean {
  if (!band || (typeof band.min !== 'number' && typeof band.max !== 'number')) return false;
  const exact = typeof company.employeeCountExact === 'number' ? company.employeeCountExact : null;
  if (exact !== null) {
    if (typeof band.min === 'number' && exact < band.min) return true;
    if (typeof band.max === 'number' && exact > band.max) return true;
    return false;
  }
  const companyMin = typeof company.employeeCountMin === 'number' ? company.employeeCountMin : null;
  const companyMax = typeof company.employeeCountMax === 'number' ? company.employeeCountMax : null;
  if (companyMin === null && companyMax === null) return false;
  // Sin solapamiento entre el rango de la empresa y la banda pedida.
  if (typeof band.min === 'number' && companyMax !== null && companyMax < band.min) return true;
  if (typeof band.max === 'number' && companyMin !== null && companyMin > band.max) return true;
  return false;
}

/**
 * Normaliza una empresa cruda de Lusha aplicando el gate de calidad.
 * NO deduplica (eso ocurre en normalizeLushaPreviewCompanies).
 */
export function normalizeLushaPreviewCompany(
  raw: LushaCompanyProspectingV3Company,
  criteria: LushaPreviewCriteria,
): LushaPreviewCompany {
  const issues: string[] = [];
  const domain = typeof raw.domain === 'string' && raw.domain.trim() ? raw.domain.trim() : null;
  const country = typeof raw.country === 'string' && raw.country.trim() ? raw.country.trim() : null;

  let score = 100;

  if (!domain) {
    score -= 50;
    issues.push('missing_domain');
  }

  const matchesCountry = countryMatches(raw, criteria);
  if (!matchesCountry) {
    score -= 50;
    issues.push('country_mismatch');
  }

  if (raw.industry) {
    if (!industryMatches(raw.industry, criteria.matchKeywords)) {
      score -= 20;
      issues.push('industry_mismatch');
    }
  } else {
    score -= 10;
    issues.push('industry_unknown');
  }

  // Empleados: tolerante — solo warning, nunca causa fallo por sí solo.
  if (employeesOutOfBand(raw, criteria.sizeBand)) {
    score -= 15;
    issues.push('employees_out_of_range');
  }

  score = clampScore(score);
  const passesGate = !!domain && matchesCountry && score >= criteria.minScore;

  return {
    providerCompanyId: raw.id ?? null,
    name: raw.name ?? null,
    domain,
    country,
    countryIso2:
      (typeof raw.countryIso2 === 'string' && raw.countryIso2.trim()
        ? raw.countryIso2.trim().toUpperCase()
        : null) ?? countryIso2FromName(country),
    industry: raw.industry ?? null,
    employeesExact: typeof raw.employeeCountExact === 'number' ? raw.employeeCountExact : null,
    employeesMin: typeof raw.employeeCountMin === 'number' ? raw.employeeCountMin : null,
    employeesMax: typeof raw.employeeCountMax === 'number' ? raw.employeeCountMax : null,
    linkedinUrl: raw.linkedinUrl ?? null,
    score,
    passesGate,
    issues,
  };
}

/**
 * Normaliza una lista de empresas y marca duplicados por dominio.
 * Los duplicados se conservan pero se marcan con issue 'duplicate_domain' y
 * passesGate=false (no se re-cuentan como candidatos válidos).
 */
export function normalizeLushaPreviewCompanies(
  rawList: LushaCompanyProspectingV3Company[],
  criteria: LushaPreviewCriteria,
): LushaPreviewCompany[] {
  const seenDomains = new Set<string>();
  return rawList.map((raw) => {
    const normalized = normalizeLushaPreviewCompany(raw, criteria);
    const domainKey = normalizeDomain(normalized.domain);
    if (domainKey) {
      if (seenDomains.has(domainKey)) {
        return {
          ...normalized,
          passesGate: false,
          issues: normalized.issues.includes('duplicate_domain')
            ? normalized.issues
            : [...normalized.issues, 'duplicate_domain'],
        };
      }
      seenDomains.add(domainKey);
    }
    return normalized;
  });
}

// ─── Ejecución (core inyectable, testeable) ───────────────────────────────────

export interface LushaPreviewInput {
  countryCode: string;
  sectorKey: string;
  subIndustryId?: number | null;
  sizeBandKey?: string | null;
  searchText?: string | null;
}

export type LushaPreviewStatus =
  | 'success'
  | 'empty'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'missing_mapping'
  | 'invalid_input'
  | 'provider_error';

export interface LushaPreviewResult {
  ok: boolean;
  status: LushaPreviewStatus;
  results: LushaPreviewCompany[];
  billing: {
    creditsCharged: number | null;
    resultsReturned: number | null;
    expectedMaxCredits: typeof LUSHA_PREVIEW_EXPECTED_MAX_CREDITS;
  };
  warnings: string[];
  requestSummary: {
    country: string | null;
    countryCode: string;
    sector: string | null;
    sectorKey: string;
    mainIndustriesIds: number[];
    subIndustryId: number | null;
    sizeBand: { min?: number; max?: number } | null;
    hasSearchText: boolean;
  };
  error?: string;
}

export interface LushaPreviewDeps {
  /** Recupera la API key de forma segura (server-side). null si no disponible. */
  resolveApiKey: () => Promise<string | null>;
  /** Ejecuta la búsqueda de compañías. NO enrich, NO people search. */
  searchCompanies: (
    apiKey: string,
    request: LushaCompanyProspectingV3Request,
  ) => Promise<LushaCompanyProspectingV3Result>;
}

function emptyBilling(): LushaPreviewResult['billing'] {
  return {
    creditsCharged: null,
    resultsReturned: 0,
    expectedMaxCredits: LUSHA_PREVIEW_EXPECTED_MAX_CREDITS,
  };
}

/**
 * Núcleo del preview. Determinístico dado `deps`. NO tiene dependencia de
 * escritura: es estructuralmente imposible que escriba en DB, cree candidatos
 * o llame a enrichment desde aquí.
 */
export async function executeLushaPreview(
  deps: LushaPreviewDeps,
  input: LushaPreviewInput,
): Promise<LushaPreviewResult> {
  const warnings: string[] = [];

  const sector = resolveLushaSectorOption(input.sectorKey);
  const baseSummary = {
    country: null as string | null,
    countryCode: input.countryCode,
    sector: sector?.label ?? null,
    sectorKey: input.sectorKey,
    mainIndustriesIds: sector ? [sector.mainIndustryId] : [],
    subIndustryId: null as number | null,
    sizeBand: null as { min?: number; max?: number } | null,
    hasSearchText: false,
  };

  if (!sector) {
    return {
      ok: false,
      status: 'missing_mapping',
      results: [],
      billing: emptyBilling(),
      warnings: ['sector_not_supported'],
      requestSummary: baseSummary,
      error: 'El sector seleccionado no está soportado por el preview de Lusha.',
    };
  }

  const countryName = resolveLushaCountryName(input.countryCode);
  if (!countryName) {
    return {
      ok: false,
      status: 'invalid_input',
      results: [],
      billing: emptyBilling(),
      warnings: ['unknown_country'],
      requestSummary: { ...baseSummary, sector: sector.label, mainIndustriesIds: [sector.mainIndustryId] },
      error: 'País no reconocido para el preview de Lusha.',
    };
  }

  // Sub-industria: validar pertenencia. Si no pertenece, se descarta con warning.
  let effectiveSubId: number | null = null;
  if (typeof input.subIndustryId === 'number') {
    if (isSubIndustryValidForSector(sector.key, input.subIndustryId)) {
      effectiveSubId = input.subIndustryId;
    } else {
      warnings.push('subindustry_not_in_sector');
    }
  }

  const sizeBand = resolveLushaPreviewSizeBand(input.sizeBandKey);
  const trimmedSearch = typeof input.searchText === 'string' ? input.searchText.trim() : '';
  const hasSearchText = trimmedSearch.length > 0;
  if (hasSearchText) warnings.push('advanced_search_text_used');

  const requestSummary = {
    country: countryName,
    countryCode: input.countryCode,
    sector: sector.label,
    sectorKey: sector.key,
    mainIndustriesIds: [sector.mainIndustryId],
    subIndustryId: effectiveSubId,
    sizeBand: sizeBand ? { min: sizeBand.min, max: sizeBand.max } : null,
    hasSearchText,
  };

  const apiKey = await deps.resolveApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 'provider_unavailable',
      results: [],
      billing: emptyBilling(),
      warnings: [...warnings, 'provider_unavailable'],
      requestSummary,
      error: 'Lusha no está disponible: falta la API key configurada.',
    };
  }

  const request = buildLushaPreviewRequest({
    countryName,
    mainIndustriesIds: [sector.mainIndustryId],
    subIndustryId: effectiveSubId,
    sizeBand: sizeBand ? { min: sizeBand.min, max: sizeBand.max } : null,
    searchText: hasSearchText ? trimmedSearch : null,
  });

  const providerResult = await deps.searchCompanies(apiKey, request);

  const billing = {
    creditsCharged: typeof providerResult.creditsCharged === 'number' ? providerResult.creditsCharged : null,
    resultsReturned:
      typeof providerResult.resultsReturned === 'number' ? providerResult.resultsReturned : null,
    expectedMaxCredits: LUSHA_PREVIEW_EXPECTED_MAX_CREDITS,
  };

  const criteria: LushaPreviewCriteria = {
    expectedCountryName: countryName,
    expectedCountryIso2: input.countryCode.trim().toUpperCase(),
    sectorKey: sector.key,
    sectorLabel: sector.label,
    matchKeywords: sector.matchKeywords,
    sizeBand: sizeBand ? { min: sizeBand.min, max: sizeBand.max } : null,
    minScore: LUSHA_PREVIEW_DEFAULT_MIN_SCORE,
  };

  switch (providerResult.status) {
    case 'success': {
      const results = normalizeLushaPreviewCompanies(providerResult.results ?? [], criteria);
      if (results.length === 0) {
        return { ok: true, status: 'empty', results: [], billing, warnings, requestSummary };
      }
      return { ok: true, status: 'success', results, billing, warnings, requestSummary };
    }
    case 'no_results':
      return { ok: true, status: 'empty', results: [], billing, warnings, requestSummary };
    case 'rate_limited':
      return {
        ok: false,
        status: 'rate_limited',
        results: [],
        billing,
        warnings: [...warnings, 'rate_limited'],
        requestSummary,
        error: 'Lusha respondió con límite de tasa (429). Intenta de nuevo en unos minutos.',
      };
    case 'provider_auth_error':
    case 'insufficient_credits':
    case 'feature_unavailable':
      return {
        ok: false,
        status: 'provider_unavailable',
        results: [],
        billing,
        warnings: [...warnings, providerResult.status],
        requestSummary,
        error: 'Lusha no está disponible en este momento.',
      };
    default:
      return {
        ok: false,
        status: 'provider_error',
        results: [],
        billing,
        warnings: [...warnings, providerResult.status],
        requestSummary,
        error: (providerResult.errorMessage ?? 'Error del proveedor Lusha.').slice(0, 200),
      };
  }
}
