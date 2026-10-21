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
 *
 * Auditoría 16-10: una vez por corrida se carga lo que se sabe de la referencia
 * (NIT de su cuenta o del registro, su grupo en `agent1_company_relationships`)
 * para el filtro previo al juez; si esa lectura falla, sólo se apaga su regla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { CompetitorFreeSourcesOutcome } from '@/modules/prospect-batches/chat-wizard-execution/wizard-competitor-run';
import type { CompetitorReference } from '@/modules/prospect-batches/competitor-search/competitor-reference';
import { buildLiveCompetitorJudge } from '@/server/agents/prospecting-toolkit/claude-classifier/competitor-judge.server';
import { resolveProductionBankFirstDrawer } from '@/server/prospect-batches/company-bank/prepaid-bank-draw.server';
import { resolveProductionHubSpotFreePoolDrawer } from '@/server/prospect-batches/hubspot-free-pool/hubspot-free-pool-draw.server';
import { listCoCiiuCodesForMacro, normalizeCoCiiuCode } from '@/server/prospect-batches/country-source-discovery/co-siis-macro-table';
import { CO_SIIS_SNAPSHOT_SOURCE_KEY } from '@/server/prospect-batches/country-source-discovery/co-siis-snapshot-query';
import { runPrePaidNoveltyDiscovery } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import {
  buildReferenceNamePattern,
  COMPETITOR_BANK_DRAW_LIMIT,
  isExactReferenceRow,
  loadCompetitorReferenceExclusion,
  shouldResolveReferenceActivityCodes,
  pickReferenceActivityCodes,
  selectCompetitorBankCandidates,
  selectCompetitorCompanies,
  tallyCompetitorJudge,
  withRealCompetitorJudgedCount,
  type CompetitorJudgeContext,
  type CompetitorJudgeTally,
  type CompetitorPrefilterReason,
  type CompetitorReferenceExclusionReader,
  type CompetitorReferenceRelationshipRow,
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
  /**
   * Hasta cuándo se EMPIEZA a juzgar (ms epoch). Después, el juez no se llama y lo
   * de esa fuente no entra: el tiempo es de la ronda de Claude en la web, que rinde
   * más (auditoría 21-10). Ausente ⇒ sin plazo propio.
   */
  judgeStartDeadlineAtMs?: number;
};


/**
 * La referencia en el registro colombiano, sólo si una fila ES la referencia
 * (misma web o mismo nombre completo): sus CIIU de la industria elegida (vacío ⇒
 * se lee por toda la macro, como siempre) y su NIT (para no ofrecerla al juez con
 * otro nombre).
 */
export async function resolveCoReferenceRegistry(
  reference: Pick<CompetitorReference, 'name' | 'domain'>,
  macroIndustryKey: string | null,
): Promise<{ activityCodes: string[]; taxIds: string[] }> {
  const none = { activityCodes: [], taxIds: [] };
  const macroCodes = listCoCiiuCodesForMacro(macroIndustryKey);
  if (macroCodes.length === 0) return none;
  try {
    const client = createSupabaseAdminClient();
    const pattern = buildReferenceNamePattern(reference.name);
    const filters = [
      ...(reference.domain ? [`raw_data->>website_domain.eq."${reference.domain}"`] : []),
      ...(pattern ? [`normalized_legal_name.ilike."${pattern}"`] : []),
    ];
    if (filters.length === 0) return none;
    const { data, error } = await client
      .from('source_company_snapshots')
      .select('legal_name, tax_id, website_domain:raw_data->>website_domain, ciiu:raw_data->>CIIU')
      .eq('source_key', CO_SIIS_SNAPSHOT_SOURCE_KEY)
      .or(filters.join(','))
      .limit(REFERENCE_LOOKUP_LIMIT);
    if (error || !data) return none;
    const rows = (
      data as Array<{ legal_name: string | null; tax_id: string | null; website_domain: string | null; ciiu: string | null }>
    ).filter((row) => isExactReferenceRow(reference, { legalName: row.legal_name, websiteDomain: row.website_domain }));
    return {
      activityCodes: pickReferenceActivityCodes(rows, macroCodes, normalizeCoCiiuCode),
      taxIds: [...new Set(rows.map((row) => row.tax_id).filter((taxId): taxId is string => !!taxId))],
    };
  } catch {
    return none;
  }
}

/** CIIU de la referencia (ver `resolveCoReferenceRegistry`). */
export async function resolveCoReferenceActivityCodes(
  reference: Pick<CompetitorReference, 'name' | 'domain'>,
  macroIndustryKey: string | null,
): Promise<string[]> {
  return (await resolveCoReferenceRegistry(reference, macroIndustryKey)).activityCodes;
}

const RELATIONSHIP_COLUMNS = 'root_name, root_domain, root_account_id, related_name, related_domain';
/** Filas del árbol que se miran por referencia (y por sus matrices). */
const RELATIONSHIP_LOOKUP_LIMIT = 300;
/** Sólo dominios limpios entran a un filtro de PostgREST (sin comas ni paréntesis). */
const SAFE_DOMAIN_PATTERN = /^[a-z0-9.-]+$/;

/**
 * Lecturas reales de la exclusión (cliente de servicio): cuenta de la referencia y
 * `agent1_company_relationships` (migración 148). Cualquier error se lanza y
 * `loadCompetitorReferenceExclusion` lo convierte en «regla apagada».
 */
export function buildCompetitorReferenceExclusionReader(injected?: SupabaseClient): CompetitorReferenceExclusionReader {
  // Perezoso: si el cliente de servicio no se puede crear, la lectura lanza DENTRO
  // del cargador (que lo anota y apaga la regla), nunca al armar la corrida.
  let cached: SupabaseClient | null = injected ?? null;
  const db = (): SupabaseClient => (cached ??= createSupabaseAdminClient() as unknown as SupabaseClient);
  return {
    readAccountTaxId: async (accountId) => {
      const { data, error } = await db()
        .from('accounts')
        .select('tax_identifier, country_code')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw new Error(`competitor_reference_account_read_failed:${error.message}`);
      const row = data as { tax_identifier: string | null; country_code: string | null } | null;
      return row ? { taxId: row.tax_identifier, countryCode: row.country_code } : null;
    },
    readRelationships: async ({ domain, accountId }) => {
      const filters = [
        ...(domain && SAFE_DOMAIN_PATTERN.test(domain) ? [`root_domain.eq.${domain}`, `related_domain.eq.${domain}`] : []),
        ...(accountId ? [`root_account_id.eq.${accountId}`] : []),
      ];
      if (filters.length === 0) return [];
      const { data, error } = await db()
        .from('agent1_company_relationships')
        .select(RELATIONSHIP_COLUMNS)
        .or(filters.join(','))
        .limit(RELATIONSHIP_LOOKUP_LIMIT);
      if (error) throw new Error(`competitor_reference_relationships_read_failed:${error.message}`);
      return (data ?? []) as CompetitorReferenceRelationshipRow[];
    },
    readRelationshipsByRootDomains: async (rootDomains) => {
      const safe = rootDomains.filter((d) => SAFE_DOMAIN_PATTERN.test(d));
      if (safe.length === 0) return [];
      const { data, error } = await db()
        .from('agent1_company_relationships')
        .select(RELATIONSHIP_COLUMNS)
        .in('root_domain', safe)
        .limit(RELATIONSHIP_LOOKUP_LIMIT);
      if (error) throw new Error(`competitor_reference_relationships_read_failed:${error.message}`);
      return (data ?? []) as CompetitorReferenceRelationshipRow[];
    },
  };
}

/** Cuenta los descartes del filtro previo por motivo (telemetría). */
export function createCompetitorPrefilterCounter(): {
  onPrefiltered: (reason: CompetitorPrefilterReason) => void;
  counts: () => Partial<Record<CompetitorPrefilterReason, number>>;
} {
  const counts: Partial<Record<CompetitorPrefilterReason, number>> = {};
  return {
    onPrefiltered: (reason) => {
      counts[reason] = (counts[reason] ?? 0) + 1;
    },
    counts: () => ({ ...counts }),
  };
}

export async function runCompetitorFreeSourcesLive(
  client: SupabaseClient,
  input: CompetitorFreeSourcesInput,
): Promise<CompetitorFreeSourcesOutcome | null> {
  try {
    const registry = shouldResolveReferenceActivityCodes(input.countryCode, input.reference)
      ? await resolveCoReferenceRegistry(input.reference, input.macroIndustryKey)
      : { activityCodes: [], taxIds: [] };
    const activityCodes = registry.activityCodes;
    // Una sola vez por corrida: NIT (cuenta o registro) y grupo de la referencia.
    const referenceExclusion = await loadCompetitorReferenceExclusion(
      input.reference,
      buildCompetitorReferenceExclusionReader(),
      { withAccountTaxId: true, taxIds: registry.taxIds.map((taxId) => ({ taxId, countryCode: 'CO' })) },
    );
    const prefilter = createCompetitorPrefilterCounter();
    const prefilterOptions = { exclusion: referenceExclusion.exclusion, onPrefiltered: prefilter.onPrefiltered };
    const judgeTally: CompetitorJudgeTally = {};
    const liveJudge = buildLiveCompetitorJudge(input.userId);
    let judgeSkippedByDeadline = 0;
    // El juez de cada fuente anota lo que juzgó de verdad (telemetría `competitor_selection`).
    const judgeFor = (source: 'free_layer' | 'company_bank' | 'hubspot_free_pool') =>
      tallyCompetitorJudge(judgeTally, source, async (judgeInput) => {
        if (input.judgeStartDeadlineAtMs !== undefined && Date.now() >= input.judgeStartDeadlineAtMs) {
          judgeSkippedByDeadline += 1;
          return null;
        }
        return liveJudge({ ...judgeInput, batchId: input.batchId, source });
      });
    const context: CompetitorJudgeContext = {
      reference: input.reference,
      countryName: input.countryName,
      industryName: input.industryName,
    };
    // Banco sin su propia revisión de Claude: el clasificador revisa el lote al final.
    const bank = resolveProductionBankFirstDrawer(input.industryName, { reviewInline: false });
    // HUBSPOT-FREE-POOL-SOURCE-1 — las libres de HubSpot primero, filtradas por el mismo juez.
    const hubspotFreePool = resolveProductionHubSpotFreePoolDrawer(input.industryName, { reviewInline: false });
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
        selectCompetitorCompanies(companies, context, judgeFor('free_layer'), prefilterOptions),
      ...(bank
        ? {
            drawCompanyBank: (drawInput) =>
              bank({
                ...drawInput,
                drawLimit: COMPETITOR_BANK_DRAW_LIMIT,
                selectCandidates: (candidates) =>
                  selectCompetitorBankCandidates(candidates, context, judgeFor('company_bank'), prefilterOptions),
              }),
          }
        : {}),
      ...(hubspotFreePool
        ? {
            drawHubSpotFreePool: (drawInput) =>
              hubspotFreePool({
                ...drawInput,
                drawLimit: COMPETITOR_BANK_DRAW_LIMIT,
                selectCandidates: (candidates) =>
                  selectCompetitorBankCandidates(candidates, context, judgeFor('hubspot_free_pool'), prefilterOptions),
              }),
          }
        : {}),
    });
    return {
      persistedCount: outcome.persistedCount,
      acceptedCount: outcome.acceptedBeforeProvider,
      telemetry: {
        ...withRealCompetitorJudgedCount(outcome.telemetry, judgeTally),
        reference_activity_codes: activityCodes,
        competitor_judge_by_source: judgeTally,
        ...(judgeSkippedByDeadline > 0 ? { competitor_judge_skipped_deadline: judgeSkippedByDeadline } : {}),
        competitor_prefiltered: prefilter.counts(),
        reference_exclusion: referenceExclusion.telemetry,
      },
    };
  } catch (err) {
    console.error('[competitor-free-sources] failed (non-critical):', err instanceof Error ? err.message : err);
    return null;
  }
}
