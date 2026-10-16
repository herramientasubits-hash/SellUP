/**
 * hubspot-free-pool-draw.server.ts — la capa «primero HubSpot» tal como corre en
 * Producción (HUBSPOT-FREE-POOL-SOURCE-1). `null` con la bandera apagada.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isAgent1ClaudeRescueEnabled, isHubSpotFreePoolEnabled } from '@/lib/feature-flags.server';
import { resolveMaxDeliveredCandidates } from '@/modules/prospect-batches/delivery-cap';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';
import { writeProspectingCandidates } from '@/server/agents/prospecting-toolkit/candidate-writer';
import { scoreCandidate } from '@/server/agents/prospecting-toolkit/candidate-scorer';
import { checkCompanyDuplicate } from '@/server/agents/prospecting-toolkit/duplicate-checker';
import { verifyWebsite } from '@/server/agents/prospecting-toolkit/website-verifier';
import type { ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';
import { buildBankPipelineOutput } from '@/server/prospect-batches/company-bank/prepaid-bank-draw.server';
import { HUBSPOT_FREE_REASON_LABEL } from '@/server/integrations/hubspot-free-company-policy';
import {
  searchHubSpotFreeCompanies,
  type HubSpotFreeCompany,
} from '@/server/integrations/hubspot-free-company-pool.server';
import {
  createHubSpotFreePoolDrawer,
  HUBSPOT_FREE_POOL_METADATA_KEY,
  HUBSPOT_FREE_POOL_REJECTED_IDS_KEY,
  type HubSpotFreePoolDrawer,
} from './hubspot-free-pool-draw';

/** Una empresa ofrecida por esta fuente no se vuelve a ofrecer en este plazo. */
export const HUBSPOT_FREE_POOL_REOFFER_DAYS = 90;

/** Filas que se leen como máximo; si se llena, la telemetría lo dice. */
export const HUBSPOT_FREE_POOL_ALREADY_OFFERED_MAX = 10_000;

/**
 * AUDIT-A1-WS7 — una ficha leída y rechazada (tomada, sin dominio, no confirmada
 * libre) no se vuelve a leer en este plazo: la regla de actividad reciente es de 30
 * días, así que después puede haber cambiado.
 */
export const HUBSPOT_FREE_POOL_REJECTED_RETRY_DAYS = 30;
/** Lotes recientes que se leen como máximo para recuperar los rechazados. */
export const HUBSPOT_FREE_POOL_REJECTED_BATCHES_MAX = 500;

/** Ids rechazados por la capa en lotes recientes (metadata del lote). Sólo lectura. */
export async function listHubSpotFreePoolRecentlyRejected(
  client: Pick<ReturnType<typeof createSupabaseAdminClient>, 'from'> = createSupabaseAdminClient(),
  nowMs: number = Date.now(),
): Promise<ReadonlySet<string>> {
  const since = new Date(nowMs - HUBSPOT_FREE_POOL_REJECTED_RETRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('prospect_batches')
    .select(`rejected:metadata->${HUBSPOT_FREE_POOL_METADATA_KEY}->${HUBSPOT_FREE_POOL_REJECTED_IDS_KEY}`)
    .not(`metadata->${HUBSPOT_FREE_POOL_METADATA_KEY}->${HUBSPOT_FREE_POOL_REJECTED_IDS_KEY}`, 'is', null)
    .gte('created_at', since)
    .limit(HUBSPOT_FREE_POOL_REJECTED_BATCHES_MAX);
  if (error || !data) throw new Error(error?.message ?? 'sin datos');
  const out = new Set<string>();
  for (const row of data as Array<{ rejected: unknown }>) {
    if (!Array.isArray(row.rejected)) continue;
    for (const id of row.rejected) if (typeof id === 'string' && id !== '') out.add(id);
  }
  return out;
}

export async function listHubSpotFreePoolAlreadyOffered(): Promise<ReadonlySet<string> | null> {
  try {
    const since = new Date(Date.now() - HUBSPOT_FREE_POOL_REOFFER_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await createSupabaseAdminClient()
      .from('prospect_candidates')
      .select('company_id:metadata->hubspot_free_pool->>company_id')
      .not('metadata->hubspot_free_pool', 'is', null)
      .gte('created_at', since)
      .limit(HUBSPOT_FREE_POOL_ALREADY_OFFERED_MAX);
    if (error || !data) {
      console.error('[hubspot-free-pool] no se pudo leer lo ya ofrecido:', error?.message ?? 'sin datos');
      return null;
    }
    if (data.length >= HUBSPOT_FREE_POOL_ALREADY_OFFERED_MAX) {
      console.warn('[hubspot-free-pool] lo ya ofrecido llegó al tope de lectura; puede repetirse alguna empresa');
    }
    const offered = new Set(
      (data as Array<{ company_id: string | null }>)
        .map((row) => row.company_id)
        .filter((id): id is string => typeof id === 'string' && id !== ''),
    );
    // AUDIT-A1-WS7 — y lo leído y rechazado hace poco. Fail-open: si esa lectura
    // falla, se excluye sólo lo ya ofrecido (como antes).
    try {
      for (const id of await listHubSpotFreePoolRecentlyRejected()) offered.add(id);
    } catch (err) {
      console.error('[hubspot-free-pool] no se pudo leer lo rechazado hace poco:', err);
    }
    return offered;
  } catch (err) {
    console.error('[hubspot-free-pool] no se pudo leer lo ya ofrecido:', err);
    return null;
  }
}

async function countAcceptedByDomain(batchId: string, domains: readonly string[]): Promise<number | null> {
  const wanted = [...new Set(domains)];
  if (wanted.length === 0) return 0;
  try {
    const { count, error } = await createSupabaseAdminClient()
      .from('prospect_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', batchId)
      .in('domain', wanted)
      .not('status', 'in', '(duplicate,discarded)')
      .eq('metadata->target_completeness->>counts_toward_target', 'true');
    return error || count === null ? null : count;
  } catch {
    return null;
  }
}

/** Sitio, duplicados y puntaje: el mismo camino que cualquier candidato web. */
export async function buildHubSpotFreePoolCandidate(
  company: HubSpotFreeCompany,
  context: { countryName: string; industryName: string },
): Promise<ProspectingPipelineCandidate | null> {
  const websiteVerification = await verifyWebsite({
    candidateName: company.name,
    websiteOrDomain: company.website ?? company.domain ?? undefined,
    country: context.countryName,
    countryCode: company.countryCode,
  });
  const duplicateCheck = await checkCompanyDuplicate({
    name: company.name,
    website: company.website ?? undefined,
    domain: company.domain ?? undefined,
    country: context.countryName,
    countryCode: company.countryCode,
    ...(company.taxIdentifier ? { taxIdentifier: company.taxIdentifier } : {}),
  });
  const catalogContext = getCatalogContext({
    country: context.countryName,
    countryCode: company.countryCode,
    industry: context.industryName,
    searchDepth: 'standard',
  });
  const sourceTitle = `HubSpot — empresa libre (${HUBSPOT_FREE_REASON_LABEL[company.freeReason]})`;
  const scoring = scoreCandidate({
    name: company.name,
    country: context.countryName,
    countryCode: company.countryCode,
    industry: context.industryName,
    city: company.city,
    region: company.region,
    website: company.website,
    domain: company.domain,
    linkedinCompanyUrl: company.linkedinUrl,
    taxIdentifier: company.taxIdentifier,
    companySize: company.employees !== null ? String(company.employees) : null,
    sourcePrimary: 'hubspot',
    websiteVerification,
    duplicateCheck,
    catalogContext,
    sourceTitle,
    sourceSnippet: company.description,
    // El país lo registró el equipo de UBITS en la ficha de HubSpot (`pais`).
    countryEvidenceLevel: 'strong',
  });
  return {
    name: company.name,
    website: company.website,
    domain: company.domain,
    country: context.countryName,
    countryCode: company.countryCode,
    industry: context.industryName,
    sourceUrl: null,
    sourceTitle,
    sourceSnippet: company.description?.slice(0, 300) ?? null,
    websiteVerification,
    duplicateCheck,
    scoring,
    ...(company.employees !== null ? { employee_count: company.employees } : {}),
    companyLinkedInUrl: company.linkedinUrl,
  };
}

/** La capa «primero HubSpot» de Producción. `null` ⇒ bandera apagada. */
export function resolveProductionHubSpotFreePoolDrawer(
  industryName: string,
  options: { reviewInline?: boolean } = {},
): HubSpotFreePoolDrawer | null {
  if (!isHubSpotFreePoolEnabled()) return null;
  return createHubSpotFreePoolDrawer({
    industryName,
    search: (input) => searchHubSpotFreeCompanies(input),
    listAlreadyOffered: listHubSpotFreePoolAlreadyOffered,
    buildCandidate: buildHubSpotFreePoolCandidate,
    resolveCap: () => resolveMaxDeliveredCandidates(),
    countAcceptedByDomain,
    reviewInline: options.reviewInline === false ? undefined : async ({ batchId, triggeredBy, windowMs }) => {
      if (!isAgent1ClaudeRescueEnabled()) return false;
      const [{ rescueBatchWithClaude }, { buildLiveRescueBatchDeps }] = await Promise.all([
        import('@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch'),
        import('@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.server'),
      ]);
      const summary = await rescueBatchWithClaude(
        { batchId, triggeredBy, deadlineMs: windowMs },
        buildLiveRescueBatchDeps(triggeredBy),
      );
      return summary.ok;
    },
    write: (writeInput) =>
      writeProspectingCandidates({
        pipelineOutput: buildBankPipelineOutput({
          industryName,
          countryCode: writeInput.countryCode,
          countryName: writeInput.countryName,
          requestedTarget: writeInput.requestedTarget,
          candidates: writeInput.candidates,
          provider: 'tavily',
        }),
        triggeredByUserId: writeInput.requestedByUserId,
        ownerId: writeInput.requestedByUserId,
        source: 'agent_1',
        dryRun: false,
        existingBatchId: writeInput.batchId,
        targetPersistibleCandidates: writeInput.requestedTarget,
        maxDeliveredCandidates: resolveMaxDeliveredCandidates(undefined, writeInput.requestedTarget),
        holdBatchStatus: true,
        candidateProvenance: null,
        extraBatchMetadata: writeInput.metadata,
      }),
  });
}
