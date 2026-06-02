/**
 * Connector Registry — Source Discovery Adapters (Hito 16AJ.2)
 *
 * Registra los adapters de discovery por sourceKey.
 * Cada adapter llama la función dry-run del conector correspondiente
 * y normaliza el resultado a SourceDiscoveryOutput.
 *
 * NO escribe en Supabase. NO crea candidatos. NO toca HubSpot.
 * NO loguea tokens ni tickets. Solo lectura.
 */

import type { SourceDiscoveryInput, SourceDiscoveryOutput, SourceDiscoveryAdapter } from './source-discovery-types';
import { runClResDryRun } from './connectors/datos-gob-chile/run-cl-res-dry-run';
import { runDenueCandidateDryRun } from './connectors/denue-mexico/run-denue-candidate-dry-run';
import { runChileCompraDryRun } from './connectors/chilecompra-chile/run-chilecompra-dry-run';
import { runSocrataCandidateDryRun } from './connectors/socrata-colombia/run-socrata-candidate-dry-run';
import { resolveSourceCredential } from './source-connection-resolver';
import type { NormalizedChileCompraSupplier } from './connectors/chilecompra-chile/types';

// ── Helpers de calidad ─────────────────────────────────────────────────────────

function computeQualitySummary(candidates: SourceDiscoveryOutput['candidates']) {
  return {
    withTaxId: candidates.filter((c) => c.taxId != null).length,
    withSector: candidates.filter((c) => c.sectorCode != null).length,
    sectorUnknown: candidates.filter((c) => c.sectorCode == null).length,
    withRegion: candidates.filter((c) => c.region != null).length,
    withWebsite: candidates.filter(
      (c) => c.metadata?.website != null,
    ).length,
  };
}

// ── Adapter: cl_res ────────────────────────────────────────────────────────────

const clResSourceDiscoveryAdapter: SourceDiscoveryAdapter = async (
  input: SourceDiscoveryInput,
): Promise<SourceDiscoveryOutput> => {
  const limit = input.limit ?? 20;

  const report = await runClResDryRun({ limit });

  const candidates = report.acceptedSamples.map((sample) => ({
    name: sample.legalName ?? sample.companyName ?? 'Sin nombre',
    legalName: sample.legalName,
    taxId: sample.taxId,
    taxIdentifierType: sample.taxIdentifierType,
    country: sample.country,
    countryCode: sample.countryCode,
    city: sample.city,
    region: sample.region,
    sectorCode: null,
    sectorDescription: null,
    sourcePrimary: 'datos_gob_cl',
    sourceTrace: {
      datasetId: sample.datasetId,
      resourceId: sample.resourceId,
      rawRecordId: sample.rawRecordId,
    },
    metadata: {
      companyType: sample.companyType,
      legalStatus: sample.legalStatus,
      incorporationDate: sample.incorporationDate,
      capitalAmount: sample.capitalAmount,
    },
    reviewFlags: sample.reviewFlags as string[],
    qualityDecision: sample.qualityDecision,
  }));

  return {
    sourceKey: 'cl_res',
    sourceProvider: 'datos_gob_cl',
    countryCode: 'CL',
    mode: input.mode ?? 'dry_run',
    recordsRead: report.summary.recordsRead,
    candidates,
    acceptedCount: candidates.length,
    lowPriorityCount: 0,
    filteredOutCount: report.summary.filteredOutCount,
    warnings: report.warnings,
    errors: report.errors,
    qualitySummary: computeQualitySummary(candidates),
  };
};

// ── Adapter: mx_denue ──────────────────────────────────────────────────────────

const denueSourceDiscoveryAdapter: SourceDiscoveryAdapter = async (
  input: SourceDiscoveryInput,
): Promise<SourceDiscoveryOutput> => {
  let resolvedToken: string | undefined;

  try {
    const cred = await resolveSourceCredential('mx_denue');
    resolvedToken = cred?.token;
  } catch (credErr: unknown) {
    const msg = credErr instanceof Error ? credErr.message : 'Error resolviendo credencial mx_denue';
    return {
      sourceKey: 'mx_denue',
      sourceProvider: 'denue_mexico',
      countryCode: 'MX',
      mode: input.mode ?? 'dry_run',
      recordsRead: 0,
      candidates: [],
      acceptedCount: 0,
      lowPriorityCount: 0,
      filteredOutCount: 0,
      warnings: ['No se pudo resolver la credencial para mx_denue — configurar INEGI_DENUE_TOKEN en Vault.'],
      errors: [msg],
      qualitySummary: { withTaxId: 0, withSector: 0, sectorUnknown: 0, withRegion: 0, withWebsite: 0 },
    };
  }

  const report = await runDenueCandidateDryRun({ resolvedToken });

  const allItems = report.items.slice(0, input.limit ?? report.items.length);

  const candidates = allItems.map((item) => ({
    name: item.name ?? 'Sin nombre',
    legalName: null,
    taxId: item.taxId,
    taxIdentifierType: item.taxIdentifierType,
    country: 'Mexico',
    countryCode: 'MX',
    city: item.city,
    region: item.department,
    sectorCode: item.sectorCode,
    sectorDescription: item.activity,
    sourcePrimary: 'denue_mexico',
    sourceTrace: item.sourceTrace,
    metadata: { perOcuRaw: item.perOcuRaw, legalStatus: item.legalStatus },
    reviewFlags: item.reviewFlags as string[],
    qualityDecision: item.qualityDecision,
  }));

  const errors = report.errors.map((e) => e.message);

  return {
    sourceKey: 'mx_denue',
    sourceProvider: 'denue_mexico',
    countryCode: 'MX',
    mode: input.mode ?? 'dry_run',
    recordsRead: report.summary.recordsRead,
    candidates,
    acceptedCount: report.summary.acceptedDraftsCount,
    lowPriorityCount: report.summary.lowPriorityCount,
    filteredOutCount: report.summary.filteredOutCount,
    warnings: report.warnings,
    errors,
    qualitySummary: computeQualitySummary(candidates),
  };
};

// ── Adapter: cl_chilecompra ────────────────────────────────────────────────────

const chileCompraSourceDiscoveryAdapter: SourceDiscoveryAdapter = async (
  input: SourceDiscoveryInput,
): Promise<SourceDiscoveryOutput> => {
  let ticket: string | undefined;

  try {
    const cred = await resolveSourceCredential('chilecompra_chile');
    ticket = cred?.token;
  } catch {
    // No ticket disponible — runChileCompraDryRun lo maneja con error controlado
  }

  const keywords = input.criteria?.keywords;

  const report = await runChileCompraDryRun(
    ticket
      ? {
          ticket,
          mode: 'compra_agil_discovery',
          searchKeywords: keywords && keywords.length > 0 ? keywords : undefined,
        }
      : undefined,
  );

  const supplierToCandidate = (supplier: NormalizedChileCompraSupplier) => ({
    name: supplier.legalName ?? supplier.companyName ?? 'Sin nombre',
    legalName: supplier.legalName,
    taxId: supplier.taxId,
    taxIdentifierType: supplier.taxIdentifierType,
    country: supplier.country,
    countryCode: supplier.countryCode,
    city: supplier.city,
    region: supplier.region,
    sectorCode: supplier.procurementCategoryCode,
    sectorDescription: supplier.procurementCategoryName,
    sourcePrimary: 'chilecompra_chile',
    sourceTrace: {
      sourceRecordId: supplier.sourceRecordId,
      governmentBuyer: supplier.governmentBuyer,
    },
    metadata: {
      procurementSignal: supplier.procurementSignal,
      icpMatch: supplier.icpMatch,
      icpMatchKeyword: supplier.icpMatchKeyword,
    },
    reviewFlags: supplier.reviewFlags as string[],
    qualityDecision: supplier.qualityDecision,
  });

  const accepted = report.acceptedSamples.map(supplierToCandidate);
  const lowPriority = (report.lowPrioritySamples ?? []).map(supplierToCandidate);
  const allCandidates = [...accepted, ...lowPriority].slice(0, input.limit ?? undefined);

  return {
    sourceKey: 'cl_chilecompra',
    sourceProvider: 'chilecompra_chile',
    countryCode: 'CL',
    mode: input.mode ?? 'dry_run',
    recordsRead: report.summary.recordsRead,
    candidates: allCandidates,
    acceptedCount: report.summary.acceptedDraftsCount,
    lowPriorityCount: report.summary.lowPriorityCount,
    filteredOutCount: report.summary.filteredOutCount,
    warnings: report.warnings,
    errors: report.errors,
    qualitySummary: computeQualitySummary(allCandidates),
  };
};

// ── Adapter: co_rues ───────────────────────────────────────────────────────────

const socrataSourceDiscoveryAdapter: SourceDiscoveryAdapter = async (
  input: SourceDiscoveryInput,
): Promise<SourceDiscoveryOutput> => {
  let cred: Awaited<ReturnType<typeof resolveSourceCredential>> = null;

  try {
    cred = await resolveSourceCredential('co_rues');
  } catch {
    // co_rues puede no requerir credenciales — continuar sin ellas
  }

  void cred; // co_rues usa Socrata sin token explícito en el dry-run actual

  const limitPerDataset = Math.min(input.limit ?? 3, 10);
  const offsetPerDataset = input.offset ?? 0;

  const report = await runSocrataCandidateDryRun({ limitPerDataset, offsetPerDataset });

  const candidates = report.items.slice(0, input.limit ?? report.items.length).map((item) => ({
    name: item.name ?? 'Sin nombre',
    legalName: item.name,
    taxId: item.taxId,
    taxIdentifierType: null,
    country: 'Colombia',
    countryCode: 'CO',
    city: item.city,
    region: item.department,
    sectorCode: item.sectorCode,
    sectorDescription: null,
    sourcePrimary: 'socrata_colombia',
    sourceTrace: item.sourceTrace,
    metadata: { legalStatus: item.legalStatus, dataset: item.dataset },
    reviewFlags: item.reviewFlags as string[],
    qualityDecision: 'accepted',
  }));

  const errors = report.errors.map((e) => e.message);

  return {
    sourceKey: 'co_rues',
    sourceProvider: 'socrata_colombia',
    countryCode: 'CO',
    mode: input.mode ?? 'dry_run',
    recordsRead: report.summary.recordsRead,
    candidates,
    acceptedCount: candidates.length,
    lowPriorityCount: 0,
    filteredOutCount: 0,
    warnings: [],
    errors,
    qualitySummary: computeQualitySummary(candidates),
  };
};

// ── Registry ───────────────────────────────────────────────────────────────────

export const SOURCE_DISCOVERY_REGISTRY: Record<string, SourceDiscoveryAdapter> = {
  cl_res: clResSourceDiscoveryAdapter,
  mx_denue: denueSourceDiscoveryAdapter,
  cl_chilecompra: chileCompraSourceDiscoveryAdapter,
  co_rues: socrataSourceDiscoveryAdapter,
};
