/**
 * DENUE Mexico — Dry Run de Candidatos Revisables — Hito 16AD.3C
 *
 * Mejora de calidad comercial sobre 16AD.3B:
 *   - Multi-query: múltiples entidades y términos de búsqueda (condicion)
 *   - Deduplicación por rawRecordId antes de filtrar
 *   - Filtros de calidad post-fetch: tamaño, nombre ruidoso, actividad B2B
 *   - Reporte enriquecido: qualitySummary, filteredSamples, acceptedDraftsCount
 *
 * REGLAS CRÍTICAS:
 *   No escribe en Supabase. No escribe en HubSpot. No crea candidatos.
 *   No crea lotes. No ejecuta IA. No imprime el token.
 *   No incluye raw completo ni email/phone en el output.
 */

import type {
  EmployeeCountStatus,
  CommercialFitStatus,
  HubspotMatchStatus,
  ReviewStatus,
  ReviewFlag,
} from '../../../agents/prospecting-toolkit/structured-candidate-types';
import { fetchDenueDatasetSample } from './denue-client';
import { normalizeDenueRecord, deriveSizeFlagFromPerOcu } from './normalizers';
import { mapDenueSampleToStructuredCandidate } from './candidate-mapper';
import type { DenueCandidateDryRunInput, MexicoCompanySource, NormalizedMexicoCompanySample } from './types';

// ── Constantes ────────────────────────────────────────────────

const DRY_RUN_HARD_MAX = 20;
const PER_QUERY_LIMIT = 5;

const DEFAULT_CONDICIONES = ['tecnologia', 'consultoria', 'software'];
const DEFAULT_ENTIDADES = ['09', '19', '14']; // CDMX, Nuevo León, Jalisco

/** Keywords que indican actividad B2B relevante para UBITS (check en sectorDescription) */
const B2B_ACTIVITY_KEYWORDS = [
  'tecnolog', 'software', 'informat', 'consultor', 'capacitac',
  'servicios profesional', 'servicios empresarial', 'recursos human',
  'corporativ', 'financier', 'contab', 'auditor', 'comunicaci',
  'publicidad', 'mercadotecni', 'seguros', 'legal', 'juridic',
  'mantenimiento industrial', 'manufactura', 'logistic', 'transport empresar',
];

/** Señales de negocio micro/local/retail — descarte heurístico mínimo */
const NOISE_NAME_KEYWORDS = [
  'barbacoa', 'tortill', 'papeleri', 'miscelane', 'estetica',
  'abarrotes', 'carniceri', 'taqueri', 'loncheria', 'quesadill',
  'cocina economica', 'comida corrida', 'tacos ', 'polleria',
];

// ── Tipos del reporte ─────────────────────────────────────────

/** Decisión de calidad derivada de los filtros post-fetch */
export type QualityDecision = 'accepted' | 'low_priority' | 'filtered';

export type DenueCandidateDryRunItem = {
  source: MexicoCompanySource;
  sourceKey: string;
  datasetId: string | null;
  name: string | null;
  taxId: string | null;
  taxIdentifierType: string | null;
  city: string | null;
  department: string | null;
  activity: string | null;
  sectorCode: string | null;
  legalStatus: string | null;
  perOcuRaw: string | null;
  employeeCountStatus: EmployeeCountStatus;
  commercialFitStatus: CommercialFitStatus;
  hubspotMatchStatus: HubspotMatchStatus;
  reviewStatus: ReviewStatus;
  reviewFlags: ReviewFlag[];
  visibleWarnings: string[];
  qualityDecision: QualityDecision;
  qualityReason: string;
  sourceTrace: {
    sourceProvider: string;
    sourceKey: string;
    sourceType: string;
    sourceMode: string;
    countryCode: string;
    datasetId: string | null;
    sourceRecordId: string | null;
    connectorVersion: string;
    perOcuRaw: string | null;
    queryCondicion: string;
    queryEntidad: string;
  };
};

export type DenueCandidateDryRunReport = {
  executedAt: string;
  limitPerDataset: number;
  hasToken: boolean;
  sourceProvider: string;
  sourceKey: string;
  countryCode: string;
  queryParams: {
    codigoActividad: string;
    entidades: string[];
    condiciones: string[];
  };
  summary: {
    recordsRead: number;
    normalizedCount: number;
    totalDrafts: number;
    filteredOutCount: number;
    acceptedDraftsCount: number;
    lowPriorityCount: number;
    sizeEstimatedAboveThresholdCount: number;
    sizeEstimatedBelowThresholdCount: number;
    noTaxIdCount: number;
    errorsCount: number;
  };
  qualitySummary: {
    filterStrategy: string;
    includedActivityKeywords: string[];
    excludedNameKeywords: string[];
    minEmployeeThreshold: string;
    entitiesTested: string[];
    condicionesTested: string[];
    acceptedRate: string;
  };
  missingFieldsSummary: {
    noTaxId: number;
    noWebsite: number;
    noSectorCode: number;
    noCity: number;
  };
  items: DenueCandidateDryRunItem[];
  filteredSamples: Array<{
    name: string | null;
    city: string | null;
    department: string | null;
    sectorDescription: string | null;
    perOcuRaw: string | null;
    filterReason: string;
  }>;
  errors: Array<{
    source: MexicoCompanySource;
    message: string;
    queryCondicion?: string;
    queryEntidad?: string;
  }>;
  warnings: string[];
};

// ── Filtros de calidad ────────────────────────────────────────

function classifySizeDecision(perOcuRaw: string | null): QualityDecision {
  if (!perOcuRaw) return 'accepted'; // desconocido → aceptar con flag
  const n = perOcuRaw.toLowerCase();
  if (n.includes('51 a') || n.includes('101 a') || n.includes('251')) return 'accepted';
  if (n.includes('31 a 50')) return 'low_priority';
  return 'filtered'; // 0-5, 6-10, 11-30, sin personal
}

function isNoisyName(name: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return NOISE_NAME_KEYWORDS.some((k) => n.includes(k));
}

function hasB2BActivity(sectorDescription: string | null): boolean {
  if (!sectorDescription) return false;
  const n = sectorDescription.toLowerCase();
  return B2B_ACTIVITY_KEYWORDS.some((k) => n.includes(k));
}

function applyQualityFilter(
  normalized: NormalizedMexicoCompanySample,
): { decision: QualityDecision; reason: string } {
  const name = normalized.companyName ?? normalized.legalName ?? '';
  if (isNoisyName(name)) {
    return { decision: 'filtered', reason: 'Nombre indica negocio micro/local/retail (heurística)' };
  }
  const sizeDecision = classifySizeDecision(normalized.perOcuRaw);
  if (sizeDecision === 'filtered') {
    return { decision: 'filtered', reason: `Tamaño bajo umbral mínimo (${normalized.perOcuRaw ?? 'desconocido'})` };
  }
  if (sizeDecision === 'low_priority') {
    return { decision: 'low_priority', reason: `Tamaño 31-50 personas — útil pero por debajo del umbral preferido 51+` };
  }
  // Aceptado — anotar si tiene actividad B2B identificable
  const b2b = hasB2BActivity(normalized.sectorDescription);
  const reason = b2b
    ? `Actividad B2B identificada: "${normalized.sectorDescription?.slice(0, 80) ?? ''}"`
    : 'Tamaño 51+ — actividad no clasificada como B2B explícita (puede ser válida)';
  return { decision: 'accepted', reason };
}

// ── Warnings visibles (nunca PII, nunca raw) ──────────────────

const WARNING_MAP: Partial<Record<ReviewFlag, string>> = {
  size_unknown: 'Tamaño no determinado — per_ocu ausente en DENUE',
  size_estimated: 'Tamaño estimado 51+ empleados desde per_ocu DENUE',
  size_estimated_below_threshold: 'Tamaño estimado bajo umbral desde per_ocu DENUE',
  missing_website: 'Sitio web no encontrado en DENUE',
  missing_linkedin: 'LinkedIn no encontrado',
  missing_decision_maker: 'Decisor no encontrado',
  no_tax_id: 'RFC no disponible en DENUE — requiere búsqueda manual',
  sector_match: 'Sector SCIAN identificado',
  sector_unknown: 'Código de actividad SCIAN no disponible',
};

function buildVisibleWarnings(flags: ReviewFlag[]): string[] {
  return flags.map((f) => WARNING_MAP[f]).filter((w): w is string => w !== undefined);
}

// ── Dry run ───────────────────────────────────────────────────

/**
 * Ejecuta un dry run de calidad mejorada del flujo DENUE → candidato revisable.
 *
 * Flujo:
 *   1. Multi-query: por cada (entidad × condicion) llama fetchDenueDatasetSample
 *   2. Deduplica por rawRecordId (CLEE) antes de normalizar
 *   3. Normaliza cada registro único
 *   4. Aplica filtros de calidad: tamaño, nombre ruidoso, actividad B2B
 *   5. Mapea aceptados/low_priority a StructuredSourceCandidateDraft
 *   6. Devuelve reporte completo en memoria — no persiste nada
 *
 * No llama HubSpot. No llama Supabase. No escribe nada.
 */
export async function runDenueCandidateDryRun(
  input?: DenueCandidateDryRunInput,
): Promise<DenueCandidateDryRunReport> {
  const executedAt = new Date().toISOString();
  const codigoActividad = input?.codigoActividad ?? '5415';

  // Construir lista de (entidad, condicion) a consultar
  const entidades = input?.entidades ?? DEFAULT_ENTIDADES;
  const condiciones = input?.condiciones ?? DEFAULT_CONDICIONES;
  const entidadPrimaria = input?.entidad ?? entidades[0] ?? '09';

  // Unificar la entidad primaria con el array entidades (sin duplicar)
  const allEntidades = Array.from(new Set([entidadPrimaria, ...entidades]));

  const resolvedToken = input?.resolvedToken?.trim();
  const hasToken = Boolean(
    resolvedToken || (process.env.INEGI_DENUE_TOKEN && process.env.INEGI_DENUE_TOKEN.trim() !== ''),
  );

  const allRawRecords: Array<{ raw: Record<string, unknown>; condicion: string; entidad: string }> = [];
  const errors: DenueCandidateDryRunReport['errors'] = [];
  const warnings: string[] = [];

  // 1. Multi-query — secuencial para evitar rate limiting
  for (const entidad of allEntidades) {
    for (const condicion of condiciones) {
      const fetchResult = await fetchDenueDatasetSample({
        entidad,
        condicion,
        limit: PER_QUERY_LIMIT,
        ...(resolvedToken ? { token: resolvedToken } : {}),
      });
      if (!fetchResult.ok) {
        errors.push({ source: 'denue', message: fetchResult.error, queryCondicion: condicion, queryEntidad: entidad });
      } else {
        for (const raw of fetchResult.records) {
          allRawRecords.push({ raw: raw as Record<string, unknown>, condicion, entidad });
        }
      }
    }
  }

  const recordsRead = allRawRecords.length;

  if (!hasToken) {
    warnings.push('INEGI_DENUE_TOKEN no configurado — los resultados serán vacíos');
  }

  // 2. Deduplicar por CLEE/Id (rawRecordId)
  const seenIds = new Set<string>();
  const uniqueRecords: typeof allRawRecords = [];
  for (const entry of allRawRecords) {
    const id = String(entry.raw.CLEE ?? entry.raw.Id ?? '');
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    uniqueRecords.push(entry);
  }

  // 3. Normalizar y clasificar
  let normalizedCount = 0;
  const items: DenueCandidateDryRunItem[] = [];
  const filteredSamples: DenueCandidateDryRunReport['filteredSamples'] = [];

  // Hard limit total de drafts procesados
  const effectiveLimit = Math.min(uniqueRecords.length, DRY_RUN_HARD_MAX * condiciones.length);

  for (const { raw, condicion, entidad } of uniqueRecords.slice(0, effectiveLimit)) {
    try {
      const normalized = normalizeDenueRecord(raw);
      normalizedCount++;

      // 4. Filtro de calidad
      const { decision, reason } = applyQualityFilter(normalized);

      if (decision === 'filtered') {
        if (filteredSamples.length < 5) {
          filteredSamples.push({
            name: normalized.companyName ?? normalized.legalName,
            city: normalized.city,
            department: normalized.department,
            sectorDescription: normalized.sectorDescription,
            perOcuRaw: normalized.perOcuRaw,
            filterReason: reason,
          });
        }
        continue;
      }

      // 5. Mapear a draft (solo aceptados y low_priority)
      const draft = mapDenueSampleToStructuredCandidate(normalized);
      const visibleWarnings = buildVisibleWarnings(draft.reviewFlags);

      const perOcuRaw = typeof draft.sourceTrace.queryParams.perOcuRaw === 'string'
        ? draft.sourceTrace.queryParams.perOcuRaw
        : null;

      const item: DenueCandidateDryRunItem = {
        source: 'denue',
        sourceKey: draft.sourceTrace.sourceKey,
        datasetId: draft.sourceTrace.datasetId,
        name: draft.name,
        taxId: draft.taxId,
        taxIdentifierType: draft.taxIdentifierType,
        city: draft.city,
        department: draft.department,
        activity: normalized.sectorDescription,
        sectorCode: draft.sectorCode,
        legalStatus: draft.legalStatus,
        perOcuRaw,
        employeeCountStatus: draft.employeeCountStatus,
        commercialFitStatus: draft.commercialFitStatus,
        hubspotMatchStatus: draft.hubspotMatchStatus,
        reviewStatus: draft.reviewStatus,
        reviewFlags: draft.reviewFlags,
        visibleWarnings,
        qualityDecision: decision,
        qualityReason: reason,
        sourceTrace: {
          sourceProvider: draft.sourceTrace.sourceProvider,
          sourceKey: draft.sourceTrace.sourceKey,
          sourceType: draft.sourceTrace.sourceType,
          sourceMode: draft.sourceTrace.sourceMode,
          countryCode: draft.sourceTrace.countryCode,
          datasetId: draft.sourceTrace.datasetId,
          sourceRecordId: draft.sourceTrace.sourceRecordId,
          connectorVersion: draft.sourceTrace.connectorVersion,
          perOcuRaw,
          queryCondicion: condicion,
          queryEntidad: entidad,
        },
      };

      items.push(item);
    } catch (itemErr: unknown) {
      const msg = itemErr instanceof Error ? itemErr.message : 'Error procesando registro DENUE';
      errors.push({ source: 'denue', message: msg });
    }
  }

  // 6. Calcular summary
  const filteredOutCount = filteredSamples.length
    + (normalizedCount - items.length - filteredSamples.length);
  const acceptedDraftsCount = items.filter((i) => i.qualityDecision === 'accepted').length;
  const lowPriorityCount = items.filter((i) => i.qualityDecision === 'low_priority').length;

  const sizeEstimatedAboveThresholdCount = items.filter((i) =>
    i.reviewFlags.includes('size_estimated'),
  ).length;
  const sizeEstimatedBelowThresholdCount = items.filter((i) =>
    i.reviewFlags.includes('size_estimated_below_threshold'),
  ).length;
  const noTaxIdCount = items.filter((i) => i.taxId === null).length;

  const missingFieldsSummary = {
    noTaxId: items.filter((i) => i.taxId === null).length,
    noWebsite: items.filter((i) => i.reviewFlags.includes('missing_website')).length,
    noSectorCode: items.filter((i) => i.reviewFlags.includes('sector_unknown')).length,
    noCity: items.filter((i) => i.city === null).length,
  };

  const totalDrafts = normalizedCount;
  const acceptedRate = totalDrafts > 0
    ? `${Math.round((acceptedDraftsCount / totalDrafts) * 100)}%`
    : '0%';

  const realFilteredOut = normalizedCount - items.length;

  return {
    executedAt,
    limitPerDataset: PER_QUERY_LIMIT,
    hasToken,
    sourceProvider: 'denue_mexico',
    sourceKey: 'mx_denue',
    countryCode: 'MX',
    queryParams: {
      codigoActividad,
      entidades: allEntidades,
      condiciones,
    },
    summary: {
      recordsRead,
      normalizedCount,
      totalDrafts,
      filteredOutCount: realFilteredOut,
      acceptedDraftsCount,
      lowPriorityCount,
      sizeEstimatedAboveThresholdCount,
      sizeEstimatedBelowThresholdCount,
      noTaxIdCount,
      errorsCount: errors.length,
    },
    qualitySummary: {
      filterStrategy: 'multi_query_keyword + size_threshold + name_noise_heuristic',
      includedActivityKeywords: B2B_ACTIVITY_KEYWORDS,
      excludedNameKeywords: NOISE_NAME_KEYWORDS,
      minEmployeeThreshold: '51 personas (low_priority: 31-50)',
      entitiesTested: allEntidades,
      condicionesTested: condiciones,
      acceptedRate,
    },
    missingFieldsSummary,
    items: items.slice(0, 10),
    filteredSamples,
    errors,
    warnings,
  };
}

