/**
 * Chile RES Connector — Normalizers
 *
 * Mapea campos CKAN RES al tipo NormalizedChileCompanySample.
 * Normalización defensiva: campos ausentes o inválidos no rompen el proceso.
 * No inventa giro/sector — sectorCode y sectorDescription siempre null.
 */

import type {
  ResChileRawRecord,
  NormalizedChileCompanySample,
  ChileLegalStatus,
  ResChileReviewFlag,
  ResChileQualityDecision,
} from './types';
import { RES_RESOURCE_ID_2025, RES_DATASET_ID } from './cl-res-client';

// ── Mapa de regiones Chile (códigos 1–16) ─────────────────────

const REGION_MAP: Record<string, string> = {
  'REGIÓN DE ARICA Y PARINACOTA': 'Arica y Parinacota',
  'ARICA Y PARINACOTA': 'Arica y Parinacota',
  'REGIÓN DE TARAPACÁ': 'Tarapacá',
  'TARAPACÁ': 'Tarapacá',
  'REGIÓN DE ANTOFAGASTA': 'Antofagasta',
  'ANTOFAGASTA': 'Antofagasta',
  'REGIÓN DE ATACAMA': 'Atacama',
  'ATACAMA': 'Atacama',
  'REGIÓN DE COQUIMBO': 'Coquimbo',
  'COQUIMBO': 'Coquimbo',
  'REGIÓN DE VALPARAÍSO': 'Valparaíso',
  'VALPARAÍSO': 'Valparaíso',
  "REGIÓN DEL LIBERTADOR GENERAL BERNARDO O'HIGGINS": "O'Higgins",
  "O'HIGGINS": "O'Higgins",
  "LIBERTADOR GENERAL BERNARDO O'HIGGINS": "O'Higgins",
  'REGIÓN DEL MAULE': 'Maule',
  'MAULE': 'Maule',
  'REGIÓN DEL BIOBÍO': 'Biobío',
  'BIOBÍO': 'Biobío',
  'BIOBIO': 'Biobío',
  'REGIÓN DE LA ARAUCANÍA': 'La Araucanía',
  'LA ARAUCANÍA': 'La Araucanía',
  'LA ARAUCANIA': 'La Araucanía',
  'REGIÓN DE LOS RÍOS': 'Los Ríos',
  'LOS RÍOS': 'Los Ríos',
  'LOS RIOS': 'Los Ríos',
  'REGIÓN DE LOS LAGOS': 'Los Lagos',
  'LOS LAGOS': 'Los Lagos',
  'REGIÓN DE AYSÉN DEL GENERAL CARLOS IBÁÑEZ DEL CAMPO': 'Aysén',
  'AYSÉN': 'Aysén',
  'AYSEN': 'Aysén',
  'REGIÓN DE MAGALLANES Y DE LA ANTÁRTICA CHILENA': 'Magallanes',
  'MAGALLANES': 'Magallanes',
  'REGIÓN METROPOLITANA DE SANTIAGO': 'Región Metropolitana',
  'REGIÓN METROPOLITANA': 'Región Metropolitana',
  'METROPOLITANA': 'Región Metropolitana',
  'METROPOLITANA DE SANTIAGO': 'Región Metropolitana',
  'REGIÓN DE ÑUBLE': 'Ñuble',
  'ÑUBLE': 'Ñuble',
  'NUBLE': 'Ñuble',
};

/** Mapa por código numérico oficial de regiones Chile (1–16). */
const REGION_CODE_MAP: Record<string, string> = {
  '1': 'Tarapacá',
  '2': 'Antofagasta',
  '3': 'Atacama',
  '4': 'Coquimbo',
  '5': 'Valparaíso',
  '6': "O'Higgins",
  '7': 'Maule',
  '8': 'Biobío',
  '9': 'La Araucanía',
  '10': 'Los Lagos',
  '11': 'Aysén',
  '12': 'Magallanes',
  '13': 'Región Metropolitana',
  '14': 'Los Ríos',
  '15': 'Arica y Parinacota',
  '16': 'Ñuble',
};

// ── Tipos societarios aceptables ──────────────────────────────

const ACCEPTED_COMPANY_TYPES = new Set([
  'SpA', 'SRL', 'S.R.L.', 'SA', 'S.A.', 'EIRL', 'E.I.R.L.',
  'SPA', 'Ltda.', 'LTDA', 'SA CERRADA', 'SA ABIERTA',
  'SOCIEDAD POR ACCIONES', 'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD ANÓNIMA', 'EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA',
]);

// ── Helpers ───────────────────────────────────────────────────

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

function normalizeRegion(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Código numérico (e.g. "13") — usar mapa numérico primero
  if (/^\d{1,2}$/.test(trimmed)) return REGION_CODE_MAP[trimmed] ?? trimmed;
  const upper = trimmed.toUpperCase();
  return REGION_MAP[upper] ?? trimmed;
}

function normalizeCity(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0
    ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
    : null;
}

function normalizeRut(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  // RUTs chilenos: "76.123.456-7" o "76123456-7" — mantener como vienen, solo trim
  return s.replace(/\s+/g, '');
}

function parseCapital(raw: unknown): number | null {
  const s = str(raw);
  if (!s) return null;
  const cleaned = s.replace(/[.,\s]/g, '').replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}

function parseDate(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [day, month, year] = s.split('/');
    return `${year}-${month}-${day}`;
  }
  // DD-MM-YYYY (formato real de datos.gob.cl, e.g. "01-01-2025")
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [day, month, year] = s.split('-');
    return `${year}-${month}-${day}`;
  }
  return s.slice(0, 10);
}

function inferLegalStatus(tipoActuacion: string | null): ChileLegalStatus {
  if (!tipoActuacion) return 'unknown_requires_review';
  const t = tipoActuacion.toUpperCase().trim();
  if (t.includes('CONSTITUCIÓN') || t === 'CONSTITUCION') return 'active_candidate';
  if (t.includes('DISOLUCIÓN') || t.includes('DISOLUCION')) return 'dissolved_candidate';
  if (t.includes('MODIFICACIÓN') || t.includes('MODIFICACION')) return 'modified_candidate';
  if (t.includes('CONVERSIÓN') || t.includes('CONVERSION')) return 'modified_candidate';
  return 'unknown_requires_review';
}

function buildReviewFlags(params: {
  taxId: string | null;
  legalName: string | null;
  legalStatus: ChileLegalStatus;
  capitalAmount: number | null;
  tipoActuacion: string | null;
}): ResChileReviewFlag[] {
  const flags: ResChileReviewFlag[] = [
    'no_sector_data',
    'no_contact_data',
    'official_registry',
    'status_inferred',
    'requires_manual_industry_validation',
  ];

  if (params.taxId) {
    flags.push('rut_available');
  } else {
    flags.push('missing_rut');
  }

  if (!params.legalName) {
    flags.push('missing_legal_name');
  }

  if (params.capitalAmount !== null) {
    flags.push('capital_available');
  }

  if (params.legalStatus === 'dissolved_candidate') {
    flags.push('dissolved_entity');
  }

  if (params.legalStatus === 'unknown_requires_review') {
    flags.push('unknown_legal_action');
  }

  return flags;
}

function applyQualityDecision(params: {
  taxId: string | null;
  legalName: string | null;
  tipoActuacion: string | null;
  companyType: string | null;
}): { decision: ResChileQualityDecision; reason: string } {
  if (!params.taxId) {
    return { decision: 'filtered', reason: 'Falta RUT — no se puede identificar la empresa' };
  }
  if (!params.legalName) {
    return { decision: 'filtered', reason: 'Falta Razón Social — registro incompleto' };
  }

  const tipo = (params.tipoActuacion ?? '').toUpperCase().trim();
  if (!tipo.includes('CONSTITUCIÓN') && !tipo.includes('CONSTITUCION')) {
    return {
      decision: 'filtered',
      reason: `Tipo de actuación "${params.tipoActuacion ?? 'desconocido'}" no es CONSTITUCIÓN`,
    };
  }

  // Tipo societario opcional — si existe y no es aceptable, filtrar
  if (params.companyType) {
    const upperType = params.companyType.toUpperCase().trim();
    const isAccepted = [...ACCEPTED_COMPANY_TYPES].some(
      (t) => t.toUpperCase() === upperType || upperType.includes(t.toUpperCase()),
    );
    if (!isAccepted) {
      return {
        decision: 'filtered',
        reason: `Tipo societario "${params.companyType}" no es SpA/SRL/SA/EIRL u otro aceptable`,
      };
    }
  }

  return {
    decision: 'accepted',
    reason: params.companyType
      ? `CONSTITUCIÓN con RUT, razón social y tipo societario "${params.companyType}"`
      : 'CONSTITUCIÓN con RUT y razón social — tipo societario ausente pero aceptable',
  };
}

/**
 * Normaliza un registro raw del CKAN RES Chile.
 *
 * Campos fuente disponibles:
 *   ID, RUT, Razon Social, Fecha de actuacion (1era firma),
 *   Fecha de registro (ultima firma), Fecha de aprobacion x SII,
 *   Anio, Mes, Comuna Tributaria, Region Tributaria,
 *   Codigo de sociedad, Tipo de actuacion, Capital,
 *   Comuna Social, Region Social
 *
 * No inventa giro/actividad económica — sectorCode/sectorDescription = null.
 */
export function normalizeResChileRecord(
  raw: ResChileRawRecord,
  resourceId: string = RES_RESOURCE_ID_2025,
): NormalizedChileCompanySample {
  const rawId = str(raw.ID ?? raw._id);
  const rutRaw = str(raw.RUT);
  const taxId = normalizeRut(rutRaw);
  const legalName = str(raw['Razon Social']);
  const tipoActuacion = str(raw['Tipo de actuacion']);
  const codigoSociedad = str(raw['Codigo de sociedad']);
  const capitalRaw = raw.Capital;
  const capitalAmount = parseCapital(capitalRaw);

  // Preferir datos sociales sobre tributarios para ciudad/región
  const ciudadSocial = str(raw['Comuna Social']);
  const regionSocial = str(raw['Region Social']);
  const ciudadTrib = str(raw['Comuna Tributaria']);
  const regionTrib = str(raw['Region Tributaria']);

  const city = normalizeCity(ciudadSocial ?? ciudadTrib);
  const region = normalizeRegion(regionSocial ?? regionTrib);

  const incorporationDate = parseDate(raw['Fecha de registro (ultima firma)'] ?? raw['Fecha de actuacion (1era firma)']);
  const legalStatus = inferLegalStatus(tipoActuacion);

  const companyName = legalName
    ? legalName.replace(/\s+(S\.?P\.?A\.?|S\.?R\.?L\.?|LTDA\.?|S\.?A\.?|E\.?I\.?R\.?L\.?)\s*$/i, '').trim() || legalName
    : null;

  const reviewFlags = buildReviewFlags({
    taxId,
    legalName,
    legalStatus,
    capitalAmount,
    tipoActuacion,
  });

  const { decision, reason } = applyQualityDecision({
    taxId,
    legalName,
    tipoActuacion,
    companyType: codigoSociedad,
  });

  return {
    sourceKey: 'cl_res',
    datasetId: RES_DATASET_ID,
    resourceId,
    companyName,
    legalName,
    taxId,
    taxIdentifierType: 'RUT',
    country: 'Chile',
    countryCode: 'CL',
    city,
    region,
    companyType: codigoSociedad,
    legalStatus,
    incorporationDate,
    capitalAmount,
    capitalCurrency: 'CLP',
    sourceRecordId: taxId ?? rawId,
    rawRecordId: rawId,
    reviewFlags,
    qualityDecision: decision,
    qualityReason: reason,
  };
}
