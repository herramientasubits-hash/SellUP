/**
 * hubspot-free-pool-draw.ts — las empresas LIBRES de HubSpot como PRIMERA fuente de
 * una búsqueda del Agente 1.
 *
 * HUBSPOT-FREE-POOL-SOURCE-1. Decisión de la dueña (15-10): «primero en cada
 * búsqueda», antes de los registros oficiales, del banco y de cualquier pago. Son
 * empresas que UBITS ya trabajó: traen sitio, contactos y a menudo tamaño.
 *
 * Qué hace, sin gastar un crédito:
 *
 *   · pide a HubSpot las libres del país × macro industria (recicladas, bolsas, sin
 *     dueño, dueño desactivado), sin las que ya pasaron por SellUp;
 *   · cada una pasa por el camino de siempre —sitio, duplicados SellUp/HubSpot,
 *     puntaje— y sólo sigue si el chequeo de duplicados confirma QUE ES ESA ficha
 *     y que sigue libre;
 *   · las escribe el escritor de siempre en el lote de la búsqueda (país, valla de
 *     identidad, «una empresa, un vendedor», tope de entrega), sin sellar el lote;
 *   · Claude confirma sector y tamaño en línea antes de que la búsqueda decida pagar;
 *   · sólo lo que el escritor/Claude miden como completo baja el hueco.
 *
 * Núcleo con puertas inyectadas. Nunca lanza.
 */

import type { HubSpotFreeCompany, HubSpotFreeSearchResult } from '@/server/integrations/hubspot-free-company-pool.server';
import type {
  CandidateRelationshipEvidence,
  CandidateWriterOutput,
  ProspectingPipelineCandidate,
} from '@/server/agents/prospecting-toolkit/types';
import type { BankFirstContribution } from '@/server/prospect-batches/company-bank/prepaid-bank-draw.server';

/** Clave de la metadata del lote donde esta capa deja constancia. */
export const HUBSPOT_FREE_POOL_METADATA_KEY = 'hubspot_free_pool_first';

/** Cuántas libres se leen por cada lugar a llenar (algunas caen por sitio, sector o tamaño). */
export const HUBSPOT_FREE_POOL_READ_FACTOR = 2;

export type HubSpotFreePoolDrawInput = {
  countryCode: string;
  countryName: string;
  macroIndustryKey: string | null;
  requestedTarget: number;
  requestedByUserId: string;
  resolveBatchId: () => Promise<string>;
  /**
   * «Competidores de una empresa» — elige cuáles le compiten a la referencia (índices
   * de `candidates`). `null` ⇒ no se pudo elegir y no entra ninguna. Ausente ⇒ todas.
   */
  selectCandidates?: (
    candidates: readonly ProspectingPipelineCandidate[],
  ) => Promise<ReadonlyArray<{ index: number; relationshipEvidence: CandidateRelationshipEvidence }> | null>;
  /** «Competidores» — cuántas leer para elegir (en vez del tope de entrega). */
  drawLimit?: number;
};

export type HubSpotFreePoolWriteInput = {
  batchId: string;
  candidates: ProspectingPipelineCandidate[];
  countryCode: string;
  countryName: string;
  requestedTarget: number;
  requestedByUserId: string;
  metadata: Record<string, unknown>;
};

export type HubSpotFreePoolDeps = {
  search: (input: {
    countryCode: string;
    macroIndustryKey: string;
    limit: number;
    excludeHubSpotCompanyIds: ReadonlySet<string>;
  }) => Promise<HubSpotFreeSearchResult>;
  /** Ids de HubSpot que ya ofreció esta fuente (en cualquier lote). `null` ⇒ no se pudo leer. */
  listAlreadyOffered: () => Promise<ReadonlySet<string> | null>;
  /** Sitio + duplicados + puntaje. `null` si algo falla. */
  buildCandidate: (
    company: HubSpotFreeCompany,
    context: { countryName: string; industryName: string },
  ) => Promise<ProspectingPipelineCandidate | null>;
  industryName: string;
  write: (input: HubSpotFreePoolWriteInput) => Promise<CandidateWriterOutput>;
  resolveCap: () => number | null;
  reviewInline?: (input: { batchId: string; triggeredBy: string; windowMs: number }) => Promise<boolean>;
  countAcceptedByDomain?: (batchId: string, domains: readonly string[]) => Promise<number | null>;
};

export type HubSpotFreePoolDrawer = (input: HubSpotFreePoolDrawInput) => Promise<BankFirstContribution>;

/** Ventana para que Claude revise lo escrito antes de decidir pagar (la del banco). */
export const HUBSPOT_FREE_POOL_CLAUDE_WINDOW_MS = 60_000;

const nothing = (telemetry: Record<string, unknown>): BankFirstContribution => ({
  batchId: null,
  persistedCount: 0,
  acceptedCount: 0,
  telemetry,
});

/** ¿El chequeo de duplicados confirma que es ESA ficha de HubSpot, y libre? */
export function isConfirmedFreeCandidate(candidate: ProspectingPipelineCandidate, hubspotCompanyId: string): boolean {
  const check = candidate.duplicateCheck;
  if (!check) return false;
  if (check.status === 'existing_in_sellup' || check.status === 'existing_in_hubspot') return false;
  return check.hubspotFreeToTake?.hubspotCompanyId === hubspotCompanyId;
}

export function createHubSpotFreePoolDrawer(deps: HubSpotFreePoolDeps): HubSpotFreePoolDrawer {
  return async (input) => {
    try {
      return await drawHubSpotFreePool(deps, input);
    } catch (err) {
      console.error('[hubspot-free-pool] draw failed (non-critical):', err);
      return nothing({ status: 'error' });
    }
  };
}

async function drawHubSpotFreePool(
  deps: HubSpotFreePoolDeps,
  input: HubSpotFreePoolDrawInput,
): Promise<BankFirstContribution> {
  if (!input.macroIndustryKey || !input.countryCode || input.requestedTarget <= 0) {
    return nothing({ status: 'not_attempted' });
  }
  const cap = deps.resolveCap() ?? input.requestedTarget;
  const limit = input.drawLimit ?? Math.max(input.requestedTarget, cap) * HUBSPOT_FREE_POOL_READ_FACTOR;
  const offeredRead = await deps.listAlreadyOffered().catch(() => null);
  const alreadyOffered = offeredRead ?? new Set<string>();
  const found = await deps.search({
    countryCode: input.countryCode,
    macroIndustryKey: input.macroIndustryKey,
    limit,
    excludeHubSpotCompanyIds: alreadyOffered,
  });
  const baseTelemetry: Record<string, unknown> = {
    status: found.status,
    hubspot_records_read: found.recordsRead,
    found: found.companies.length,
    by_reason: found.byReason,
    already_offered_excluded: alreadyOffered.size,
    ...(offeredRead === null ? { already_offered_unavailable: true } : {}),
    ...(found.droppedBy ? { dropped_by: found.droppedBy } : {}),
    ...(found.failure ? { unavailable_reason: found.failure } : {}),
  };
  if (found.status !== 'ok' || found.companies.length === 0) return nothing(baseTelemetry);

  // De a pocas: cada una hace varias búsquedas en HubSpot (≈5 por segundo por cuenta).
  let buildFailed = 0;
  let firstBuildError: string | null = null;
  const built = await mapWithConcurrency(found.companies, HUBSPOT_FREE_POOL_BUILD_CONCURRENCY, async (company) => ({
    company,
    candidate: await deps
      .buildCandidate(company, { countryName: input.countryName, industryName: deps.industryName })
      .catch((err) => {
        buildFailed += 1;
        firstBuildError ??= err instanceof Error ? err.message.slice(0, 200) : String(err);
        return null;
      }),
  }));
  if (firstBuildError) console.error('[hubspot-free-pool] no se pudo armar el candidato:', firstBuildError);
  type UsableEntry = { company: HubSpotFreeCompany; candidate: ProspectingPipelineCandidate };
  let usable: UsableEntry[] = built.filter(
    (entry): entry is UsableEntry =>
      entry.candidate !== null && isConfirmedFreeCandidate(entry.candidate, entry.company.hubspotCompanyId),
  );
  const notConfirmed = found.companies.length - usable.length - buildFailed;

  let selectionTelemetry: Record<string, unknown> = {};
  if (input.selectCandidates && usable.length > 0) {
    const picked = await input.selectCandidates(usable.map((entry) => entry.candidate)).catch((err) => {
      console.error('[hubspot-free-pool] el juez de competidores falló:', err);
      return null;
    });
    const byIndex = new Map((picked ?? []).map((item) => [item.index, item.relationshipEvidence]));
    const before = usable.length;
    usable = usable.flatMap((entry, index): UsableEntry[] => {
      const relationshipEvidence = byIndex.get(index);
      return relationshipEvidence ? [{ ...entry, candidate: { ...entry.candidate, relationshipEvidence } }] : [];
    });
    selectionTelemetry = { selected: usable.length, not_selected: before - usable.length, selection_failed: picked === null };
  }

  const telemetry = {
    ...baseTelemetry,
    confirmed_free: usable.length,
    not_confirmed: notConfirmed,
    ...(buildFailed > 0 ? { build_failed: buildFailed, build_error: firstBuildError } : {}),
    ...selectionTelemetry,
  };
  if (usable.length === 0) return nothing(telemetry);

  let batchId: string;
  try {
    batchId = await input.resolveBatchId();
  } catch (err) {
    console.error('[hubspot-free-pool] lote no disponible:', err);
    return nothing({ ...telemetry, status: 'batch_unavailable' });
  }

  const written = await deps.write({
    batchId,
    candidates: usable.map((entry) => entry.candidate),
    countryCode: input.countryCode,
    countryName: input.countryName,
    requestedTarget: input.requestedTarget,
    requestedByUserId: input.requestedByUserId,
    metadata: { [HUBSPOT_FREE_POOL_METADATA_KEY]: telemetry },
  });
  const writeErrors = (written.errors ?? []).slice(0, 5);
  if (writeErrors.length > 0) console.error('[hubspot-free-pool] el escritor reportó errores:', writeErrors);
  const persistedCount = Math.max(0, written.candidatesCreated ?? 0);
  let acceptedCount = Math.min(Math.max(0, written.persistence?.completeValidCandidates ?? 0), persistedCount);

  // Claude confirma sector y tamaño ANTES de que la búsqueda decida pagar.
  let claudeReviewed = false;
  let reviewError: string | null = null;
  let acceptedAfterClaude: number | null = null;
  if (persistedCount > 0 && acceptedCount < input.requestedTarget && deps.reviewInline) {
    claudeReviewed = await deps
      .reviewInline({ batchId, triggeredBy: input.requestedByUserId, windowMs: HUBSPOT_FREE_POOL_CLAUDE_WINDOW_MS })
      .catch((err) => {
        reviewError = err instanceof Error ? err.message.slice(0, 200) : String(err);
        console.error('[hubspot-free-pool] revisión de Claude falló:', reviewError);
        return false;
      });
    if (claudeReviewed && deps.countAcceptedByDomain) {
      acceptedAfterClaude = await deps
        .countAcceptedByDomain(batchId, usable.map((entry) => entry.company.domain).filter((d): d is string => d !== null))
        .catch(() => null);
      if (acceptedAfterClaude !== null) {
        acceptedCount = Math.max(acceptedCount, Math.min(acceptedAfterClaude, persistedCount));
      }
    }
  }

  return {
    batchId,
    persistedCount,
    acceptedCount,
    telemetry: {
      ...telemetry,
      delivered: persistedCount,
      accepted_for_target: acceptedCount,
      claude_reviewed: claudeReviewed,
      accepted_after_claude: acceptedAfterClaude,
      ...(claudeReviewed && acceptedAfterClaude === null && deps.countAcceptedByDomain ? { count_error: true } : {}),
      ...(reviewError ? { review_error: reviewError } : {}),
      ...(writeErrors.length > 0 ? { write_errors: writeErrors } : {}),
    },
  };
}

/** Cuántas empresas se arman a la vez (cada una consulta HubSpot varias veces). */
export const HUBSPOT_FREE_POOL_BUILD_CONCURRENCY = 2;

/** `Promise.all` con tope de concurrencia; conserva el orden. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}
