/**
 * prepaid-bank-draw.server.ts — el banco como PRIMERA fuente de la búsqueda.
 *
 * AGENT1-COMPANY-BANK-FIRST-1. Decisión de la dueña (2026-10-02): «el banco debe
 * funcionar antes que todo, es la primera fuente gratuita». Orden de la búsqueda:
 *
 *   1. banco  →  2. capa gratuita (registros por país)  →  3. Tavily-primero
 *   →  4. Apollo  →  5. Lusha
 *
 * Qué hace, sin gastar un crédito:
 *
 *   · saca del banco del país × macro hasta el tope de entrega (listas primero);
 *   · las filas con el candidato completo (`pipeline_candidate_v1`) se vuelven a
 *     comprobar contra SellUp/HubSpot (lectura) y las escribe el escritor de
 *     siempre en el lote de la búsqueda: novedad, propiedad, país, valla de
 *     identidad del lote y reclamo global («una empresa, un vendedor») corren ahí;
 *   · el escritor NO sella el estado del lote (`holdBatchStatus`): las piernas
 *     siguientes lo siguen pudiendo adoptar;
 *   · las que cuentan para la meta (medidas por el escritor, nunca por la etiqueta
 *     del banco) bajan el hueco: si lo cierran, no corre ninguna pierna de pago;
 *   · las filas que sólo traen evidencia de Apollo se devuelven al banco: las saca
 *     la ronda 1 de Apollo, que sabe reconstruirlas;
 *   · se cierra la extracción (asignada / devuelta / invalidada).
 *
 * Nunca lanza: un banco caído o apagado deja la búsqueda exactamente como antes.
 */

import { randomUUID } from 'node:crypto';

import { checkCompanyDuplicate } from '@/server/agents/prospecting-toolkit/duplicate-checker';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import { writeProspectingCandidates } from '@/server/agents/prospecting-toolkit/candidate-writer';
import type {
  CandidateWriterOutput,
  DuplicateCheckInput,
  DuplicateCheckResult,
  ProspectingPipelineCandidate,
  ProspectingPipelineOutput,
} from '@/server/agents/prospecting-toolkit/types';
import { resolveMaxDeliveredCandidates } from '@/modules/prospect-batches/delivery-cap';
import {
  APOLLO_BANK_DRAW_PER_RUN,
  APOLLO_BANK_RESERVE_SECONDS,
  planBankSettlement,
  readApolloBankEvidence,
  type DrawnBankCompany,
} from './apollo-company-bank-bridge';
import { resolveApolloCompanyBankPort, type ApolloCompanyBankPort } from './apollo-company-bank-port.server';
import type { CompanyBankSettleItem } from './company-bank-types';
import { readBankPipelineCandidate } from './pipeline-candidate-bank-payload';

/** Clave de la metadata del lote donde el banco deja constancia. */
export const COMPANY_BANK_FIRST_METADATA_KEY = 'company_bank_first';

export type BankFirstDrawInput = {
  countryCode: string;
  countryName: string;
  macroIndustryKey: string | null;
  requestedTarget: number;
  requestedByUserId: string;
  /** El lote de la búsqueda, resuelto perezosamente (sólo si hay algo que escribir). */
  resolveBatchId: () => Promise<string>;
};

export type BankFirstContribution = {
  batchId: string | null;
  /** Filas escritas en el lote. */
  persistedCount: number;
  /** De ellas, las que cuentan para la meta (medido por el escritor). */
  acceptedCount: number;
  telemetry: Record<string, unknown>;
};

export type BankFirstDrawer = (input: BankFirstDrawInput) => Promise<BankFirstContribution>;

export type BankFirstWriteInput = {
  batchId: string;
  candidates: ProspectingPipelineCandidate[];
  countryCode: string;
  countryName: string;
  requestedTarget: number;
  requestedByUserId: string;
  metadata: Record<string, unknown>;
};

export type BankFirstDeps = {
  port: ApolloCompanyBankPort | null;
  /** Nombre visible de la industria de la búsqueda (para la entrada del escritor). */
  industryName: string;
  checkDuplicate: (input: DuplicateCheckInput) => Promise<DuplicateCheckResult>;
  write: (input: BankFirstWriteInput) => Promise<CandidateWriterOutput>;
  resolveCap: () => number | null;
  newDrawId: () => string;
};

const nothing = (telemetry: Record<string, unknown>): BankFirstContribution => ({
  batchId: null,
  persistedCount: 0,
  acceptedCount: 0,
  telemetry,
});

/** La entrada mínima del escritor para filas que ya pasaron por un proveedor antes. */
export function buildBankPipelineOutput(input: {
  industryName: string;
  countryCode: string;
  countryName: string;
  requestedTarget: number;
  candidates: ProspectingPipelineCandidate[];
}): ProspectingPipelineOutput {
  return {
    input: {
      country: input.countryName,
      countryCode: input.countryCode,
      industry: input.industryName,
      webSearchProvider: 'apollo_organizations',
      mode: 'multi_query',
      targetCount: input.requestedTarget,
      subindustries: [],
    },
    catalogContext: getCatalogContext({
      country: input.countryName,
      countryCode: input.countryCode,
      industry: input.industryName,
      searchDepth: 'standard',
    }),
    searchQuery: 'company_bank',
    webSearch: {
      provider: 'apollo_organizations',
      query: 'company_bank',
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason: 'company_bank_first',
      estimatedCostUsd: 0,
    },
    candidates: input.candidates,
    summary: {
      requested: input.requestedTarget,
      searched: 0,
      returned: input.candidates.length,
      highQualityNew: 0,
      needsReview: input.candidates.length,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [],
    metadata: {
      pipelineVersion: 'company-bank-first-1',
      provider: 'company_bank',
      search_mode: 'company_bank_first',
    },
  } as ProspectingPipelineOutput;
}

export function createBankFirstDrawer(deps: BankFirstDeps): BankFirstDrawer {
  return async (input) => {
    try {
      return await drawBankFirst(deps, input);
    } catch (err) {
      console.error('[company-bank-first] draw failed (non-critical):', err);
      return nothing({ status: 'error' });
    }
  };
}

async function drawBankFirst(deps: BankFirstDeps, input: BankFirstDrawInput): Promise<BankFirstContribution> {
  const { port } = deps;
  if (!port || !input.macroIndustryKey || !input.countryCode) return nothing({ status: 'not_attempted' });

  const drawId = deps.newDrawId();
  const limit = deps.resolveCap() ?? APOLLO_BANK_DRAW_PER_RUN;
  const draw = await port.store.draw({
    countryCode: input.countryCode,
    macroIndustryKey: input.macroIndustryKey,
    limit,
    tiers: ['ready', 'to_complete'],
    reserveSeconds: APOLLO_BANK_RESERVE_SECONDS,
    drawId,
  });
  if (draw.status !== 'ok') return nothing({ status: 'unavailable', reason: draw.reason });

  const closing: CompanyBankSettleItem[] = [];
  const usable: Array<{ id: string; domain: string; candidate: ProspectingPipelineCandidate }> = [];
  for (const company of draw.companies) {
    const candidate = readBankPipelineCandidate(company.payload);
    const domain = candidate?.domain ? normalizeDomain(candidate.domain) : null;
    if (candidate && domain) {
      usable.push({ id: company.id, domain, candidate });
    } else if (readApolloBankEvidence(company)) {
      // Sólo evidencia de Apollo: la ronda 1 de Apollo sabe reconstruirla.
      closing.push({ id: company.id, outcome: 'released' });
    } else {
      closing.push({ id: company.id, outcome: 'invalidated', reason: 'unreadable_payload' });
    }
  }

  const releasedForApollo = closing.filter((item) => item.outcome === 'released').length;
  const baseTelemetry = {
    status: 'ok',
    drawn: draw.companies.length,
    usable: usable.length,
    released_for_apollo: releasedForApollo,
    unreadable: closing.length - releasedForApollo,
  };

  if (usable.length === 0) {
    if (closing.length > 0) await port.store.settle(drawId, closing);
    return nothing(baseTelemetry);
  }

  // Lo guardado puede haber cambiado: SellUp/HubSpot se vuelven a mirar (lectura).
  const refreshed = await Promise.all(
    usable.map(async (entry) => {
      const duplicateCheck = await deps
        .checkDuplicate({
          name: entry.candidate.name,
          website: entry.candidate.website ?? null,
          domain: entry.candidate.domain ?? null,
          country: entry.candidate.country ?? null,
          countryCode: entry.candidate.countryCode ?? null,
        })
        .catch(() => entry.candidate.duplicateCheck ?? null);
      return { ...entry.candidate, duplicateCheck } as ProspectingPipelineCandidate;
    }),
  );

  let batchId: string;
  try {
    batchId = await input.resolveBatchId();
  } catch {
    await port.store.settle(drawId, [
      ...closing,
      ...usable.map((entry) => ({ id: entry.id, outcome: 'released' as const })),
    ]);
    return nothing({ ...baseTelemetry, status: 'batch_unavailable' });
  }

  const written = await deps.write({
    batchId,
    candidates: refreshed,
    countryCode: input.countryCode,
    countryName: input.countryName,
    requestedTarget: input.requestedTarget,
    requestedByUserId: input.requestedByUserId,
    metadata: { [COMPANY_BANK_FIRST_METADATA_KEY]: { ...baseTelemetry, draw_id: drawId } },
  });

  const persistedCount = Math.max(0, written.candidatesCreated ?? 0);
  const acceptedCount = Math.min(
    Math.max(0, written.persistence?.completeValidCandidates ?? 0),
    persistedCount,
  );

  const drawn: DrawnBankCompany[] = usable.map((entry) => ({ bankId: entry.id, domain: entry.domain }));
  const persistedByDomain = await port.readPersistedCandidateIdsByDomain(
    batchId,
    drawn.map((entry) => entry.domain),
  );
  const settleItems: CompanyBankSettleItem[] = [
    ...closing,
    ...(persistedByDomain === null
      ? []
      : planBankSettlement({
          batchId,
          drawn,
          persistedCandidateIdByDomain: persistedByDomain,
          cappedDomains: new Set(
            (written.deliveryCappedCompanies ?? [])
              .map((company) => (company.domain ? normalizeDomain(company.domain) : null))
              .filter((domain): domain is string => domain !== null),
          ),
        })),
  ];
  const settled = settleItems.length > 0 ? await port.store.settle(drawId, settleItems) : null;

  return {
    batchId,
    persistedCount,
    acceptedCount,
    telemetry: {
      ...baseTelemetry,
      delivered: persistedCount,
      accepted_for_target: acceptedCount,
      settle: settled?.status === 'ok'
        ? { assigned: settled.assigned, released: settled.released, invalidated: settled.invalidated, ignored: settled.ignored }
        : settled === null
          ? null
          : { status: settled.status },
    },
  };
}

/** El banco primero tal como corre en Producción. `null` ⇒ banco apagado o sin cliente. */
export function resolveProductionBankFirstDrawer(industryName: string): BankFirstDrawer | null {
  const port = resolveApolloCompanyBankPort();
  if (!port) return null;
  return createBankFirstDrawer({
    port,
    industryName,
    checkDuplicate: (dupInput) => checkCompanyDuplicate(dupInput),
    resolveCap: () => resolveMaxDeliveredCandidates(),
    newDrawId: () => randomUUID(),
    write: (writeInput) =>
      writeProspectingCandidates({
        pipelineOutput: buildBankPipelineOutput({
          industryName,
          countryCode: writeInput.countryCode,
          countryName: writeInput.countryName,
          requestedTarget: writeInput.requestedTarget,
          candidates: writeInput.candidates,
        }),
        triggeredByUserId: writeInput.requestedByUserId,
        ownerId: writeInput.requestedByUserId,
        source: 'agent_1',
        dryRun: false,
        existingBatchId: writeInput.batchId,
        targetPersistibleCandidates: writeInput.requestedTarget,
        maxDeliveredCandidates: resolveMaxDeliveredCandidates(),
        holdBatchStatus: true,
        candidateProvenance: 'apollo',
        extraBatchMetadata: writeInput.metadata,
      }),
  });
}
