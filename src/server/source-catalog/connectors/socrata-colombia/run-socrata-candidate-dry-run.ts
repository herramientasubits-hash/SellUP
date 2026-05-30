/**
 * Socrata Colombia — Dry Run de Candidatos Revisables — Hito 16AB.6
 *
 * Simula el flujo completo:
 * Socrata → muestra limitada → normalización → StructuredSourceCandidateDraft
 *   → employeeCountStatus → reviewFlags → HubSpot checker (opcional, read-only)
 *   → candidato revisable en memoria → reporte de salida.
 *
 * REGLAS CRÍTICAS:
 *   No escribe en Supabase.
 *   No escribe en HubSpot.
 *   No crea candidatos.
 *   No crea lotes.
 *   No ejecuta IA.
 *   No imprime tokens.
 *   No incluye raw completo ni email/phone en el output.
 */

import type {
  EmployeeCountStatus,
  CommercialFitStatus,
  HubspotMatchStatus,
  RecyclableStatus,
  ReviewStatus,
  ReviewFlag,
} from '../../../agents/prospecting-toolkit/structured-candidate-types';
import { runSocrataColombiaSample } from './run-socrata-colombia-sample';
import { mapSocrataSampleToStructuredCandidate } from './candidate-mapper';
import { checkHubSpotCompanyCommercialStatus } from '../../../agents/prospecting-toolkit/hubspot-commercial-checker';
import type { ColombiaCompanySource } from './types';

// ── Constantes ────────────────────────────────────────────────

const DRY_RUN_DEFAULT_LIMIT = 3;
const DRY_RUN_HARD_MAX = 10;
const DEFAULT_DATASETS: ColombiaCompanySource[] = ['rues', 'secop2', 'reps', 'superfinanciera'];

// ── Tipos públicos ────────────────────────────────────────────

export type SocrataCandidateDryRunInput = {
  datasets?: ColombiaCompanySource[];
  limitPerDataset?: number;
  runHubSpotCheck?: boolean;
};

export type SocrataCandidateDryRunItem = {
  dataset: ColombiaCompanySource;
  sourceKey: string;
  datasetId: string | null;
  name: string | null;
  taxId: string | null;
  city: string | null;
  department: string | null;
  sectorCode: string | null;
  legalStatus: string | null;
  employeeCountStatus: EmployeeCountStatus;
  commercialFitStatus: CommercialFitStatus;
  hubspotMatchStatus: HubspotMatchStatus;
  recyclableStatus: RecyclableStatus | null;
  reviewStatus: ReviewStatus;
  reviewFlags: ReviewFlag[];
  visibleWarnings: string[];
  sourceTrace: {
    sourceProvider: string;
    sourceKey: string;
    datasetId: string | null;
    sourceRecordId: string | null;
  };
};

export type SocrataCandidateDryRunReport = {
  executedAt: string;
  limitPerDataset: number;
  runHubSpotCheck: boolean;
  summary: {
    datasetsRequested: number;
    recordsRead: number;
    candidatesPrepared: number;
    sizeUnknownCount: number;
    hubspotNoMatchCount: number;
    hubspotCustomerBlockedCount: number;
    hubspotRecyclableCount: number;
    errorsCount: number;
  };
  items: SocrataCandidateDryRunItem[];
  errors: Array<{
    dataset: ColombiaCompanySource;
    message: string;
  }>;
};

// ── Warnings visibles (nunca incluyen PII ni raw) ─────────────

const WARNING_MAP: Partial<Record<ReviewFlag, string>> = {
  size_unknown: 'Tamaño no confirmado — validar manualmente',
  missing_website: 'Sitio web no encontrado',
  missing_linkedin: 'LinkedIn no encontrado',
  missing_decision_maker: 'Decisor no encontrado',
  pii_email_risk: 'Dato de contacto potencialmente personal — validar antes de usar',
  hubspot_existing_customer: 'Cliente actual en HubSpot — no crear prospecto',
  hubspot_recyclable_prospect: 'Prospecto reciclable — requiere confirmación',
};

function buildVisibleWarnings(flags: ReviewFlag[]): string[] {
  return flags
    .map((f) => WARNING_MAP[f])
    .filter((w): w is string => w !== undefined);
}

// ── Mapeado de estado comercial HubSpot → CommercialFitStatus ─

function resolveCommercialFitFromHubspot(
  hubspotMatchStatus: HubspotMatchStatus,
): CommercialFitStatus {
  if (hubspotMatchStatus === 'exact_match_customer') return 'customer_blocked';
  if (hubspotMatchStatus === 'exact_match_prospect_recyclable') return 'recyclable_prospect';
  return 'needs_manual_review';
}

// ── Dry run ───────────────────────────────────────────────────

/**
 * Ejecuta un dry run completo del flujo Socrata → candidato revisable.
 *
 * Flujo por item:
 *   1. runSocrataColombiaSample (muestra limitada, sin writes)
 *   2. mapSocrataSampleToStructuredCandidate (siempre employeeCount=null)
 *   3. Construcción de visibleWarnings desde reviewFlags
 *   4. checkHubSpotCompanyCommercialStatus (read-only, si runHubSpotCheck=true)
 *   5. Merge de flags y estados HubSpot en el item
 *   6. Reporte en memoria — no se persiste nada
 */
export async function runSocrataCandidateDryRun(
  input?: SocrataCandidateDryRunInput,
): Promise<SocrataCandidateDryRunReport> {
  const executedAt = new Date().toISOString();
  const limitPerDataset = Math.min(
    input?.limitPerDataset ?? DRY_RUN_DEFAULT_LIMIT,
    DRY_RUN_HARD_MAX,
  );
  const datasets = input?.datasets ?? DEFAULT_DATASETS;
  const runHubSpotCheck = input?.runHubSpotCheck ?? false;

  const items: SocrataCandidateDryRunItem[] = [];
  const errors: SocrataCandidateDryRunReport['errors'] = [];

  // 1. Ejecutar muestra Socrata (sin writes)
  const sampleReport = await runSocrataColombiaSample({ datasets, limitPerDataset });

  // 2. Procesar cada dataset
  for (const dataset of datasets) {
    const result = sampleReport.results[dataset];

    if (!result?.ok) {
      errors.push({
        dataset,
        message: result?.error ?? 'Error desconocido al obtener muestra',
      });
      continue;
    }

    // 3. Convertir cada sample normalizado en candidato revisable
    for (const sample of result.sample) {
      try {
        // Mapper: employeeCount siempre null, reviewStatus = needs_manual_review
        const draft = mapSocrataSampleToStructuredCandidate(sample);

        let hubspotMatchStatus: HubspotMatchStatus = 'not_attempted';
        let commercialFitStatus: CommercialFitStatus = draft.commercialFitStatus;
        let recyclableStatus: RecyclableStatus | null = null;
        let reviewFlags: ReviewFlag[] = [...draft.reviewFlags];

        // 4. HubSpot check (read-only, opcional)
        if (runHubSpotCheck) {
          try {
            const hsResult = await checkHubSpotCompanyCommercialStatus({
              name: draft.name,
              taxId: draft.taxId,
              domain: draft.website ?? null,
              countryCode: 'CO',
            });

            hubspotMatchStatus = hsResult.hubspotMatchStatus;
            recyclableStatus = hsResult.recyclableStatus;
            commercialFitStatus = resolveCommercialFitFromHubspot(hsResult.hubspotMatchStatus);

            // Merge de flags HubSpot (sin duplicados)
            const hsFlags = hsResult.reviewFlags.filter((f) => !reviewFlags.includes(f));
            reviewFlags = [...reviewFlags, ...hsFlags];

            if (hsResult.error) {
              errors.push({
                dataset,
                message: `HubSpot lookup fallido para "${draft.name}": ${hsResult.error}`,
              });
            }
          } catch (hsErr: unknown) {
            // No romper el dry run si HubSpot falla
            hubspotMatchStatus = 'hubspot_lookup_failed';
            const msg = hsErr instanceof Error ? hsErr.message : 'Error HubSpot desconocido';
            errors.push({
              dataset,
              message: `HubSpot lookup error para "${draft.name}": ${msg}`,
            });
          }
        }

        // 5. Construir warnings visibles (sin PII, sin raw)
        const visibleWarnings = buildVisibleWarnings(reviewFlags);

        // 6. Construir item del reporte — sin email, sin phone, sin raw completo
        const item: SocrataCandidateDryRunItem = {
          dataset,
          sourceKey: draft.sourceTrace.sourceKey,
          datasetId: draft.sourceTrace.datasetId,
          name: draft.name,
          taxId: draft.taxId,
          city: draft.city,
          department: draft.department,
          sectorCode: draft.sectorCode,
          legalStatus: draft.legalStatus,
          employeeCountStatus: draft.employeeCountStatus,
          commercialFitStatus,
          hubspotMatchStatus,
          recyclableStatus,
          reviewStatus: draft.reviewStatus,
          reviewFlags,
          visibleWarnings,
          sourceTrace: {
            sourceProvider: draft.sourceTrace.sourceProvider,
            sourceKey: draft.sourceTrace.sourceKey,
            datasetId: draft.sourceTrace.datasetId,
            sourceRecordId: draft.sourceTrace.sourceRecordId,
          },
        };

        items.push(item);
      } catch (itemErr: unknown) {
        const msg = itemErr instanceof Error ? itemErr.message : 'Error procesando registro';
        errors.push({ dataset, message: msg });
      }
    }
  }

  // 7. Calcular summary
  const sizeUnknownCount = items.filter(
    (i) => i.employeeCountStatus === 'unknown_requires_manual_validation',
  ).length;

  const hubspotNoMatchCount = items.filter(
    (i) => i.hubspotMatchStatus === 'no_match',
  ).length;

  const hubspotCustomerBlockedCount = items.filter(
    (i) => i.hubspotMatchStatus === 'exact_match_customer',
  ).length;

  const hubspotRecyclableCount = items.filter(
    (i) =>
      i.hubspotMatchStatus === 'exact_match_prospect_recyclable' ||
      i.recyclableStatus === 'recyclable',
  ).length;

  const recordsRead = datasets.reduce((acc, ds) => {
    return acc + (sampleReport.results[ds]?.recordsRead ?? 0);
  }, 0);

  return {
    executedAt,
    limitPerDataset,
    runHubSpotCheck,
    summary: {
      datasetsRequested: datasets.length,
      recordsRead,
      candidatesPrepared: items.length,
      sizeUnknownCount,
      hubspotNoMatchCount,
      hubspotCustomerBlockedCount,
      hubspotRecyclableCount,
      errorsCount: errors.length,
    },
    items,
    errors,
  };
}
