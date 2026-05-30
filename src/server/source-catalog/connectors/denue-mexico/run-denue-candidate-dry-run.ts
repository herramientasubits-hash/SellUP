/**
 * DENUE Mexico — Dry Run de Candidatos Revisables — Hito 16AD.3B
 *
 * Valida el contrato estructurado generalizado con DENUE/INEGI México.
 * Flujo completo:
 *   API DENUE → normalización → StructuredSourceCandidateDraft → reporte en memoria
 *
 * REGLAS CRÍTICAS:
 *   No escribe en Supabase.
 *   No escribe en HubSpot.
 *   No crea candidatos.
 *   No crea lotes.
 *   No ejecuta IA.
 *   No imprime el token.
 *   No incluye raw completo ni email/phone en el output.
 *   No llama al writer en ningún modo.
 */

import type {
  EmployeeCountStatus,
  CommercialFitStatus,
  HubspotMatchStatus,
  ReviewStatus,
  ReviewFlag,
} from '../../../agents/prospecting-toolkit/structured-candidate-types';
import { fetchDenueDatasetSample } from './denue-client';
import { normalizeDenueRecord } from './normalizers';
import { mapDenueSampleToStructuredCandidate } from './candidate-mapper';
import type { DenueCandidateDryRunInput, MexicoCompanySource } from './types';

// ── Constantes ────────────────────────────────────────────────

const DRY_RUN_DEFAULT_LIMIT = 5;
const DRY_RUN_HARD_MAX = 20;

// ── Tipos del reporte ─────────────────────────────────────────

export type DenueCandidateDryRunItem = {
  source: MexicoCompanySource;
  sourceKey: string;
  datasetId: string | null;
  name: string | null;
  taxId: string | null;
  taxIdentifierType: string | null;
  city: string | null;
  department: string | null;
  sectorCode: string | null;
  legalStatus: string | null;
  employeeCountStatus: EmployeeCountStatus;
  commercialFitStatus: CommercialFitStatus;
  hubspotMatchStatus: HubspotMatchStatus;
  reviewStatus: ReviewStatus;
  reviewFlags: ReviewFlag[];
  visibleWarnings: string[];
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
    entidad: string;
  };
  summary: {
    recordsRead: number;
    normalizedCount: number;
    totalDrafts: number;
    sizeUnknownCount: number;
    sizeEstimatedAboveThresholdCount: number;
    sizeEstimatedBelowThresholdCount: number;
    noTaxIdCount: number;
    errorsCount: number;
  };
  missingFieldsSummary: {
    noTaxId: number;
    noWebsite: number;
    noSectorCode: number;
    noCity: number;
  };
  items: DenueCandidateDryRunItem[];
  errors: Array<{
    source: MexicoCompanySource;
    message: string;
  }>;
  warnings: string[];
};

// ── Warnings visibles (nunca PII, nunca raw) ──────────────────

const WARNING_MAP: Partial<Record<ReviewFlag, string>> = {
  size_unknown: 'Tamaño no determinado — per_ocu ausente en DENUE',
  size_estimated: 'Tamaño estimado 51+ empleados desde per_ocu DENUE',
  size_estimated_below_threshold: 'Tamaño estimado bajo umbral desde per_ocu DENUE — requiere validación manual',
  missing_website: 'Sitio web no encontrado en DENUE',
  missing_linkedin: 'LinkedIn no encontrado',
  missing_decision_maker: 'Decisor no encontrado',
  no_tax_id: 'RFC no disponible en DENUE — requiere búsqueda manual',
  sector_match: 'Sector SCIAN identificado',
  sector_unknown: 'Código de actividad SCIAN no disponible',
};

function buildVisibleWarnings(flags: ReviewFlag[]): string[] {
  return flags
    .map((f) => WARNING_MAP[f])
    .filter((w): w is string => w !== undefined);
}

// ── Dry run ───────────────────────────────────────────────────

/**
 * Ejecuta un dry run completo del flujo DENUE → candidato revisable.
 *
 * Flujo por item:
 *   1. fetchDenueDatasetSample (muestra limitada, sin writes)
 *   2. normalizeDenueRecord (mapeo defensivo de campos DENUE)
 *   3. mapDenueSampleToStructuredCandidate (draft en memoria)
 *   4. buildVisibleWarnings desde reviewFlags
 *   5. Reporte en memoria — no se persiste nada
 *
 * No llama HubSpot. No llama Supabase. No escribe nada.
 */
export async function runDenueCandidateDryRun(
  input?: DenueCandidateDryRunInput,
): Promise<DenueCandidateDryRunReport> {
  const executedAt = new Date().toISOString();
  const limitPerDataset = Math.min(
    input?.limitPerDataset ?? DRY_RUN_DEFAULT_LIMIT,
    DRY_RUN_HARD_MAX,
  );
  const codigoActividad = input?.codigoActividad ?? '5415';
  const entidad = input?.entidad ?? '09';

  const hasToken = Boolean(
    process.env.INEGI_DENUE_TOKEN && process.env.INEGI_DENUE_TOKEN.trim() !== '',
  );

  const items: DenueCandidateDryRunItem[] = [];
  const errors: DenueCandidateDryRunReport['errors'] = [];
  const warnings: string[] = [];

  // 1. Consultar DENUE
  const fetchResult = await fetchDenueDatasetSample({
    codigoActividad,
    entidad,
    limit: limitPerDataset,
  });

  if (!fetchResult.ok) {
    errors.push({
      source: 'denue',
      message: fetchResult.error,
    });
    if (!hasToken) {
      warnings.push('INEGI_DENUE_TOKEN no configurado — los resultados serán vacíos');
    }
  }

  const rawRecords = fetchResult.ok ? fetchResult.records : [];
  let normalizedCount = 0;

  // 2. Normalizar y mapear cada registro
  for (const raw of rawRecords) {
    try {
      const record = raw as Record<string, unknown>;
      const normalized = normalizeDenueRecord(record);
      normalizedCount++;

      // 3. Mapper → draft (no escribe en Supabase)
      const draft = mapDenueSampleToStructuredCandidate(normalized);

      // 4. Warnings visibles (sin PII, sin raw)
      const visibleWarnings = buildVisibleWarnings(draft.reviewFlags);

      // 5. Construir item del reporte — sin email, sin phone, sin raw
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
        sectorCode: draft.sectorCode,
        legalStatus: draft.legalStatus,
        employeeCountStatus: draft.employeeCountStatus,
        commercialFitStatus: draft.commercialFitStatus,
        hubspotMatchStatus: draft.hubspotMatchStatus,
        reviewStatus: draft.reviewStatus,
        reviewFlags: draft.reviewFlags,
        visibleWarnings,
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
        },
      };

      items.push(item);
    } catch (itemErr: unknown) {
      const msg = itemErr instanceof Error ? itemErr.message : 'Error procesando registro DENUE';
      errors.push({ source: 'denue', message: msg });
    }
  }

  // 6. Calcular summary
  const sizeUnknownCount = items.filter((i) =>
    i.reviewFlags.includes('size_unknown'),
  ).length;

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

  return {
    executedAt,
    limitPerDataset,
    hasToken,
    sourceProvider: 'denue_mexico',
    sourceKey: 'mx_denue',
    countryCode: 'MX',
    queryParams: {
      codigoActividad,
      entidad,
    },
    summary: {
      recordsRead: rawRecords.length,
      normalizedCount,
      totalDrafts: items.length,
      sizeUnknownCount,
      sizeEstimatedAboveThresholdCount,
      sizeEstimatedBelowThresholdCount,
      noTaxIdCount,
      errorsCount: errors.length,
    },
    missingFieldsSummary,
    items,
    errors,
    warnings,
  };
}
