/**
 * ChileCompra Connector — Normalizers
 *
 * Mapea registros raw de ChileCompra/OCDS al tipo NormalizedChileCompraSupplier.
 * Normalización defensiva: campos ausentes no rompen el proceso.
 *
 * Señal B2G: todos los registros vienen de contratos/licitaciones públicas.
 * sectorCode/sectorDescription se derivan de UNSPSC cuando está disponible.
 * No inventa contactos ni website.
 */

import type {
  ChileCompraRawRecord,
  NormalizedChileCompraSupplier,
  ChileCompraReviewFlag,
  ChileCompraQualityDecision,
} from './types';

// ── ICP UBITS — keywords de categorías relevantes ─────────────

const ICP_KEYWORDS = [
  'capacitacion',
  'capacitación',
  'formacion',
  'formación',
  'educacion',
  'educación',
  'training',
  'e-learning',
  'elearning',
  'learning',
  'aprendizaje',
  'software',
  'tecnologia',
  'tecnología',
  'technology',
  'informatica',
  'informática',
  'sistemas',
  'consultoria',
  'consultoría',
  'consulting',
  'recursos humanos',
  'human resources',
  'capital humano',
  'gestion del cambio',
  'gestión del cambio',
  'change management',
  'desarrollo organizacional',
  'organizational development',
  'servicios profesionales',
  'professional services',
  'outsourcing',
];

export { ICP_KEYWORDS };

// ── Región Chile normalization ─────────────────────────────────

const REGION_MAP: Record<string, string> = {
  'METROPOLITANA': 'Región Metropolitana',
  'SANTIAGO': 'Región Metropolitana',
  'RM': 'Región Metropolitana',
  'VALPARAÍSO': 'Valparaíso',
  'VALPARAISO': 'Valparaíso',
  'BIOBÍO': 'Biobío',
  'BIOBIO': 'Biobío',
  'LA ARAUCANÍA': 'La Araucanía',
  'LA ARAUCANIA': 'La Araucanía',
  'LOS LAGOS': 'Los Lagos',
  'MAULE': 'Maule',
  'O\'HIGGINS': "O'Higgins",
  'OHIGGINS': "O'Higgins",
  'COQUIMBO': 'Coquimbo',
  'ANTOFAGASTA': 'Antofagasta',
  'TARAPACÁ': 'Tarapacá',
  'TARAPACA': 'Tarapacá',
  'ATACAMA': 'Atacama',
  'ARICA Y PARINACOTA': 'Arica y Parinacota',
  'AYSÉN': 'Aysén',
  'AYSEN': 'Aysén',
  'MAGALLANES': 'Magallanes',
  'LOS RÍOS': 'Los Ríos',
  'LOS RIOS': 'Los Ríos',
  'ÑUBLE': 'Ñuble',
  'NUBLE': 'Ñuble',
};

// ── Helpers ────────────────────────────────────────────────────

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

function normalizeRut(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  return s.replace(/\s+/g, '').toUpperCase();
}

function normalizeName(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  return s.replace(/\s+/g, ' ').trim();
}

function normalizeRegion(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  const upper = s.trim().toUpperCase();
  return REGION_MAP[upper] ?? s.trim();
}

function normalizeCity(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  const trimmed = s.trim();
  return trimmed.length > 0
    ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
    : null;
}

function normalizeUnspsc(
  codeRaw: unknown,
  descRaw: unknown,
): { code: string | null; description: string | null } {
  const code = str(codeRaw);
  const desc = str(descRaw);
  return { code, description: desc };
}

function checkIcpMatch(
  categoryName: string | null,
  unspscDesc: string | null,
): { match: boolean; keyword: string | null } {
  const haystack = [categoryName, unspscDesc]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  for (const kw of ICP_KEYWORDS) {
    const kwNorm = kw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    if (haystack.includes(kwNorm)) {
      return { match: true, keyword: kw };
    }
  }
  return { match: false, keyword: null };
}

function buildReviewFlags(params: {
  taxId: string | null;
  icpMatch: boolean;
  hasCategory: boolean;
}): ChileCompraReviewFlag[] {
  const flags: ChileCompraReviewFlag[] = [
    'procurement_signal',
    'b2g_supplier',
    'no_website',
    'no_contact_data',
    'requires_manual_business_validation',
  ];

  if (params.taxId) {
    flags.push('rut_available');
  } else {
    flags.push('missing_rut');
  }

  if (params.hasCategory) {
    flags.push('sector_from_procurement_category');
  } else {
    flags.push('missing_category');
  }

  if (params.icpMatch) {
    flags.push('icp_category_match');
  } else {
    flags.push('icp_category_no_match');
  }

  return flags;
}

function applyQualityDecision(params: {
  taxId: string | null;
  legalName: string | null;
  icpMatch: boolean;
  hasCategory: boolean;
}): { decision: ChileCompraQualityDecision; reason: string } {
  if (!params.taxId) {
    return { decision: 'filtered', reason: 'Falta RUT — no se puede identificar la empresa' };
  }
  if (!params.legalName) {
    return { decision: 'filtered', reason: 'Falta Razón Social — registro incompleto' };
  }

  if (params.icpMatch) {
    return {
      decision: 'accepted',
      reason: params.hasCategory
        ? 'RUT + razón social + categoría relevante para ICP UBITS'
        : 'RUT + razón social — categoría relacionada con ICP UBITS',
    };
  }

  if (!params.hasCategory) {
    return {
      decision: 'low_priority',
      reason: 'RUT + razón social disponibles — sin categoría UNSPSC para evaluar ICP',
    };
  }

  return {
    decision: 'low_priority',
    reason: 'RUT + razón social disponibles — categoría no relacionada con ICP UBITS',
  };
}

/**
 * Normaliza un registro raw de ChileCompra/OCDS.
 *
 * Campos fuente disponibles:
 *   RutProveedor, NombreProveedor, RazonSocial,
 *   CodigoUnspsc, NombreUnspsc, Region, Ciudad,
 *   OrganismoComprador
 *
 * Señal procurement siempre = true para este conector.
 */
export function normalizeChileCompraRecord(
  raw: ChileCompraRawRecord,
  index: number,
): NormalizedChileCompraSupplier {
  const rawId = str(raw['CodigoProveedor'] ?? raw['CodigoLicitacion'] ?? index);

  const taxId = normalizeRut(raw.RutProveedor ?? raw.Rut ?? raw['rut']);
  const legalName = normalizeName(
    raw.RazonSocial ?? raw.NombreProveedor ?? raw.Nombre ?? raw['nombre'],
  );
  const companyName = legalName;

  const { code: unspscCode, description: unspscDescription } = normalizeUnspsc(
    raw.CodigoUnspsc ?? raw.Unspsc ?? raw.CodigoProducto,
    raw.NombreUnspsc ?? raw.NombreProducto,
  );

  const procurementCategoryCode = unspscCode;
  const procurementCategoryName = unspscDescription;

  const region = normalizeRegion(raw.Region);
  const city = normalizeCity(raw.Ciudad ?? raw.Municipio);

  const governmentBuyer = normalizeName(raw.OrganismoComprador ?? raw.NombreOrganismo);

  const hasCategory = !!(procurementCategoryCode ?? procurementCategoryName);
  const { match: icpMatch, keyword: icpMatchKeyword } = checkIcpMatch(
    procurementCategoryName,
    unspscDescription,
  );

  const reviewFlags = buildReviewFlags({ taxId, icpMatch, hasCategory });
  const { decision, reason } = applyQualityDecision({
    taxId,
    legalName,
    icpMatch,
    hasCategory,
  });

  return {
    sourceKey: 'cl_chilecompra',
    companyName,
    legalName,
    taxId,
    taxIdentifierType: 'RUT',
    country: 'Chile',
    countryCode: 'CL',
    city,
    region,
    procurementCategoryCode,
    procurementCategoryName,
    unspscCode,
    unspscDescription,
    governmentBuyer,
    procurementActivityCount: null,
    procurementSignal: true,
    sourceType: 'structured_procurement',
    sourceRecordId: taxId ?? rawId,
    rawRecordId: rawId,
    reviewFlags,
    qualityDecision: decision,
    qualityReason: reason,
    icpMatch,
    icpMatchKeyword,
  };
}
