/**
 * Agente 1 · «Competidores de una empresa» — lo gratuito con sus dependencias
 * reales (sólo servidor): CIIU de la referencia en el registro colombiano, capa
 * gratuita del país y banco de empresas, las dos filtradas por el juez de Claude.
 *
 * Es la MISMA capa gratuita y el MISMO banco que la búsqueda por criterios
 * (`runPrePaidNoveltyDiscovery`): novedad, duplicados SellUp/HubSpot, número
 * fiscal, tope de entrega y escritor de siempre. Lo único propio son los ganchos
 * de Competidores (`activityCodes`, `selectFreeCompanies`, `selectCandidates`).
 *
 * Nunca lanza: un fallo deja la corrida sin aporte gratuito (Claude en la web
 * hace el resto).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { CompetitorFreeSourcesOutcome } from '@/modules/prospect-batches/chat-wizard-execution/wizard-competitor-run';
import type { CompetitorReference } from '@/modules/prospect-batches/competitor-search/competitor-reference';
import { buildLiveCompetitorJudge } from '@/server/agents/prospecting-toolkit/claude-classifier/competitor-judge.server';
import { resolveProductionBankFirstDrawer } from '@/server/prospect-batches/company-bank/prepaid-bank-draw.server';
import { listCoCiiuCodesForMacro, normalizeCoCiiuCode } from '@/server/prospect-batches/country-source-discovery/co-siis-macro-table';
import { CO_SIIS_SNAPSHOT_SOURCE_KEY } from '@/server/prospect-batches/country-source-discovery/co-siis-snapshot-query';
import { runPrePaidNoveltyDiscovery } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import {
  buildReferenceNamePattern,
  COMPETITOR_BANK_DRAW_LIMIT,
  pickReferenceActivityCodes,
  selectCompetitorBankCandidates,
  selectCompetitorCompanies,
  type CompetitorJudgeContext,
} from './competitor-free-sources';

/** Filas del registro que se miran para reconocer a la referencia. */
const REFERENCE_LOOKUP_LIMIT = 10;

export type CompetitorFreeSourcesInput = {
  batchId: string;
  reference: CompetitorReference;
  countryCode: string;
  countryName: string;
  macroIndustryKey: string | null;
  industryName: string;
  target: number;
  userId: string;
};


/**
 * CIIU de la referencia en el registro colombiano (por web o por nombre), sólo
 * los de la industria elegida. Vacío ⇒ se lee por toda la macro, como siempre.
 */
export async function resolveCoReferenceActivityCodes(
  reference: Pick<CompetitorReference, 'name' | 'domain'>,
  macroIndustryKey: string | null,
): Promise<string[]> {
  const macroCodes = listCoCiiuCodesForMacro(macroIndustryKey);
  if (macroCodes.length === 0) return [];
  try {
    const client = createSupabaseAdminClient();
    const pattern = buildReferenceNamePattern(reference.name);
    const filters = [
      ...(reference.domain ? [`raw_data->>website_domain.eq."${reference.domain}"`] : []),
      ...(pattern ? [`normalized_legal_name.ilike."${pattern}"`] : []),
    ];
    if (filters.length === 0) return [];
    const { data, error } = await client
      .from('source_company_snapshots')
      .select('ciiu:raw_data->>CIIU')
      .eq('source_key', CO_SIIS_SNAPSHOT_SOURCE_KEY)
      .or(filters.join(','))
      .limit(REFERENCE_LOOKUP_LIMIT);
    if (error || !data) return [];
    return pickReferenceActivityCodes(data as Array<{ ciiu: string | null }>, macroCodes, normalizeCoCiiuCode);
  } catch {
    return [];
  }
}

export async function runCompetitorFreeSourcesLive(
  client: SupabaseClient,
  input: CompetitorFreeSourcesInput,
): Promise<CompetitorFreeSourcesOutcome | null> {
  try {
    const activityCodes =
      input.countryCode === 'CO' ? await resolveCoReferenceActivityCodes(input.reference, input.macroIndustryKey) : [];
    const judgeLive = buildLiveCompetitorJudge(input.userId);
    const context: CompetitorJudgeContext = {
      reference: input.reference,
      countryName: input.countryName,
      industryName: input.industryName,
    };
    // Banco sin su propia revisión de Claude: el clasificador revisa el lote al final.
    const bank = resolveProductionBankFirstDrawer(input.industryName, { reviewInline: false });
    const outcome = await runPrePaidNoveltyDiscovery(client, {
      provider: 'apollo',
      countryCode: input.countryCode,
      countryName: input.countryName,
      macroIndustryKey: input.macroIndustryKey,
      requestedTarget: input.target,
      requestedByUserId: input.userId,
      partialGapSupported: true,
      resolveBatchId: async () => input.batchId,
      ...(activityCodes.length > 0 ? { activityCodes } : {}),
      selectFreeCompanies: (companies) =>
        selectCompetitorCompanies(companies, context, (judgeInput) =>
          judgeLive({ ...judgeInput, batchId: input.batchId, source: 'free_layer' }),
        ),
      ...(bank
        ? {
            drawCompanyBank: (drawInput) =>
              bank({
                ...drawInput,
                drawLimit: COMPETITOR_BANK_DRAW_LIMIT,
                selectCandidates: (candidates) =>
                  selectCompetitorBankCandidates(candidates, context, (judgeInput) =>
                    judgeLive({ ...judgeInput, batchId: input.batchId, source: 'company_bank' }),
                  ),
              }),
          }
        : {}),
    });
    return {
      persistedCount: outcome.persistedCount,
      acceptedCount: outcome.acceptedBeforeProvider,
      telemetry: { ...outcome.telemetry, reference_activity_codes: activityCodes },
    };
  } catch (err) {
    console.error('[competitor-free-sources] failed (non-critical):', err instanceof Error ? err.message : err);
    return null;
  }
}
