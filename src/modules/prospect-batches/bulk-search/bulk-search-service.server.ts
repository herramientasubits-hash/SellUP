import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isAgent1LushaFallbackEffective } from '@/lib/feature-flags.server';
import { getAccessSnapshot } from '@/modules/access/capabilities.server';
import { isBulkRole } from '@/modules/access/capabilities';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { executeProspectWizardGenerationAction } from '@/modules/prospect-batches/chat-wizard-execution';
import { estimateCreditsForProvider } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-estimate';
import {
  estimateLushaRunCredits,
  resolveLushaRequiredCreditsByMacroIndustry,
} from '@/server/prospect-batches/lusha-run-liability';
import { isGrowthBulkSearchEnabled } from './bulk-search-flag.server';
import {
  controlBulkSearch,
  createBulkSearch,
  listBulkSearches,
  resolveBulkSearchOptions,
  runBulkSearchRound,
  type BulkBudgetAvailability,
  type BulkSearchEngineDeps,
  type BulkSearchOption,
} from './bulk-search-engine';
import type { BulkSearchControlAction } from './bulk-search-schema';
import type { BulkRoundWorstCase } from './bulk-search-types';
import type { BulkSearchRoundRow, BulkSearchRow } from './bulk-search-view';

/**
 * Cableado del motor de la búsqueda masiva (GROWTH-BULK-SEARCH-1 · PR 2).
 *
 * Las tablas de la 159 sólo las toca el `service_role`, así que todo pasa por
 * el cliente admin y SIEMPRE filtra por `created_by` = quien está en sesión. La
 * ronda llama a la corrida normal del asistente con la sesión de la persona:
 * esa corrida vuelve a comprobar sesión, rol, presupuesto y cupos por su cuenta.
 */

const SEARCHES = 'prospect_bulk_searches';
const ROUNDS = 'prospect_bulk_search_rounds';
const PAID_PROVIDER_KEYS = ['apollo', 'lusha'];
/** El peor caso de Lusha cuando no se puede resolver: el de la macroindustria más cara. */
const LUSHA_FALLBACK_CREDITS = 6;
const IN_CHUNK = 100;

function chunks<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── Quién puede ───────────────────────────────────────────────────────────────

export type BulkSearchAccess = { ok: true; userId: string } | { ok: false; status: 403 | 404; message: string };

/**
 * Sólo Growth y admin, con la bandera encendida. NO depende de
 * ENABLE_ROLE_CAPABILITIES: la búsqueda masiva nunca se abre a un BD.
 */
export async function resolveBulkSearchAccess(): Promise<BulkSearchAccess> {
  if (!isGrowthBulkSearchEnabled()) return { ok: false, status: 404, message: 'La búsqueda masiva no está activa.' };
  const access = await getAccessSnapshot();
  if (!access.userId) return { ok: false, status: 403, message: 'Tu sesión no está activa. Vuelve a entrar.' };
  if (!access.isAdmin && !isBulkRole(access.roleKey)) {
    return { ok: false, status: 403, message: 'La búsqueda masiva es del equipo de Growth.' };
  }
  return { ok: true, userId: access.userId };
}

// ── Peor caso y presupuesto ───────────────────────────────────────────────────

function resolveLushaWorstCase(): number {
  if (!isAgent1LushaFallbackEffective()) return 0;
  try {
    const byMacro = Object.values(resolveLushaRequiredCreditsByMacroIndustry()).filter((value) => Number.isFinite(value));
    if (byMacro.length) return Math.max(...byMacro);
  } catch {
    // cae al techo de una rama
  }
  try {
    return estimateLushaRunCredits();
  } catch {
    return LUSHA_FALLBACK_CREDITS;
  }
}

/** El peor caso de UNA ronda: lo mismo que reserva una corrida normal. */
export async function resolvePerRoundWorstCase(): Promise<BulkRoundWorstCase> {
  return {
    apollo: estimateCreditsForProvider('apollo_organizations'),
    lusha: resolveLushaWorstCase(),
    tavily: estimateCreditsForProvider('tavily'),
  };
}

async function readBudgetAvailability(): Promise<BulkBudgetAvailability> {
  const quota = async (provider: string) =>
    (await checkProviderQuotaAvailable(provider).catch(() => null))?.providerCreditsAvailable ?? null;
  // Dueña 28-10: los créditos de cada proveedor en Configuración, también Lusha
  // (ya no hay bolsa del piloto). El límite por persona lo aplica cada ronda.
  const [apollo, tavily, lusha] = await Promise.all([quota('apollo'), quota('tavily'), quota('lusha')]);
  return { apollo, tavily, lusha };
}

// ── Dependencias del motor ────────────────────────────────────────────────────

function createDeps(admin: SupabaseClient): BulkSearchEngineDeps {
  return {
    now: () => Date.now(),
    newUuid: () => crypto.randomUUID(),
    resolvePerRoundWorstCase,
    readBudgetAvailability: () => readBudgetAvailability(),

    findLiveSearch: async (userId) => {
      const { data } = await admin
        .from(SEARCHES)
        .select('*')
        .eq('created_by', userId)
        .in('status', ['running', 'paused'])
        .maybeSingle();
      return (data as BulkSearchRow | null) ?? null;
    },
    insertSearch: async (row) => {
      const { data, error } = await admin
        .from(SEARCHES)
        .insert({
          created_by: row.createdBy,
          target_count: row.targetCount,
          request: row.request,
          credit_cap: row.creditCap,
          credit_cap_breakdown: row.creditCapBreakdown,
          max_rounds: row.maxRounds,
        })
        .select('*')
        .single();
      if (error || !data) throw new Error(`No se pudo crear la búsqueda masiva: ${error?.message ?? 'sin fila'}`);
      return data as BulkSearchRow;
    },
    loadSearch: async (bulkSearchId, userId) => {
      const { data } = await admin.from(SEARCHES).select('*').eq('id', bulkSearchId).eq('created_by', userId).maybeSingle();
      return (data as BulkSearchRow | null) ?? null;
    },
    claimSearch: async (bulkSearchId, userId, leaseSeconds) => {
      const { data, error } = await admin.rpc('claim_prospect_bulk_search', {
        p_bulk_search_id: bulkSearchId,
        p_user_id: userId,
        p_lease_seconds: leaseSeconds,
      });
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row?.lease_token) return null;
      return { leaseToken: row.lease_token as string };
    },
    listRounds: async (bulkSearchId) => {
      const { data } = await admin.from(ROUNDS).select('*').eq('bulk_search_id', bulkSearchId).order('round_index');
      return (data as BulkSearchRoundRow[] | null) ?? [];
    },
    insertRound: async ({ bulkSearchId, roundIndex, clientRequestId }) => {
      const { error } = await admin
        .from(ROUNDS)
        .insert({ bulk_search_id: bulkSearchId, round_index: roundIndex, client_request_id: clientRequestId });
      if (error) throw new Error(`No se pudo anotar la ronda: ${error.message}`);
    },
    finishRound: async (clientRequestId, patch) => {
      await admin
        .from(ROUNDS)
        .update({
          status: patch.status,
          batch_id: patch.batchId,
          delivered_new: patch.deliveredNew,
          credits_used: patch.creditsUsed,
          outcome_code: patch.outcomeCode,
          finished_at: new Date().toISOString(),
        })
        .eq('client_request_id', clientRequestId);
    },
    findBatchByClientRequestId: async (userId, clientRequestId) => {
      const { data } = await admin
        .from('prospect_batches')
        .select('id')
        .eq('created_by', userId)
        .eq('client_request_id', clientRequestId)
        .maybeSingle();
      return (data as { id: string } | null)?.id ?? null;
    },
    countDelivered: async (batchIds) => {
      let total = 0;
      for (const ids of chunks(batchIds)) {
        const { count } = await admin
          .from('prospect_candidates')
          .select('id', { count: 'exact', head: true })
          .in('batch_id', ids)
          .not('status', 'in', '(duplicate,discarded)');
        total += count ?? 0;
      }
      return total;
    },
    sumPaidCredits: async (batchIds) => {
      let total = 0;
      for (const ids of chunks(batchIds)) {
        for (let from = 0; ; from += 1000) {
          const { data } = await admin
            .from('provider_usage_logs')
            .select('credits_used')
            .in('batch_id', ids)
            .in('provider_key', PAID_PROVIDER_KEYS)
            .range(from, from + 999);
          const rows = (data as Array<{ credits_used: number | string | null }> | null) ?? [];
          for (const row of rows) total += Number(row.credits_used ?? 0) || 0;
          if (rows.length < 1000) break;
        }
      }
      return total;
    },
    hasPendingContinuation: async (batchId) => {
      const { data } = await admin
        .from('apollo_round_continuation_jobs')
        .select('id')
        .eq('batch_id', batchId)
        .in('status', ['pending', 'processing'])
        .limit(1);
      return Boolean(data && data.length);
    },
    runWizard: (request) => executeProspectWizardGenerationAction(request),

    writeProgress: async (bulkSearchId, leaseToken, patch) => {
      await admin
        .from(SEARCHES)
        .update({
          delivered_count: patch.deliveredCount,
          credits_used: patch.creditsUsed,
          rounds_done: patch.roundsDone,
          consecutive_empty_rounds: patch.consecutiveEmptyRounds,
          consecutive_failed_rounds: patch.consecutiveFailedRounds,
          ...(patch.lastRoundAt ? { last_round_at: patch.lastRoundAt } : {}),
        })
        .eq('id', bulkSearchId)
        .eq('lease_token', leaseToken);
      if (!patch.terminal) return;
      // Sólo si sigue en curso: una pausa o una cancelación de la persona gana.
      const terminalStatuses = ['completed', 'exhausted', 'budget_capped', 'cancelled', 'failed'];
      await admin
        .from(SEARCHES)
        .update({
          status: patch.terminal.status,
          stop_reason: patch.terminal.stopReason,
          ...(terminalStatuses.includes(patch.terminal.status) ? { completed_at: new Date().toISOString() } : {}),
        })
        .eq('id', bulkSearchId)
        .eq('lease_token', leaseToken)
        .eq('status', 'running');
    },
    releaseLease: async (bulkSearchId, leaseToken) => {
      await admin
        .from(SEARCHES)
        .update({ lease_token: null, lease_expires_at: null })
        .eq('id', bulkSearchId)
        .eq('lease_token', leaseToken);
    },
    applyControl: async (bulkSearchId, userId, from, to) => {
      const { data } = await admin
        .from(SEARCHES)
        .update({
          status: to.status,
          stop_reason: to.stopReason,
          ...(to.terminal ? { completed_at: new Date().toISOString() } : {}),
        })
        .eq('id', bulkSearchId)
        .eq('created_by', userId)
        .in('status', [...from])
        .select('*')
        .maybeSingle();
      return (data as BulkSearchRow | null) ?? null;
    },
    listSearches: async (userId) => {
      const { data } = await admin
        .from(SEARCHES)
        .select('*')
        .eq('created_by', userId)
        .order('created_at', { ascending: false })
        .limit(20);
      return (data as BulkSearchRow[] | null) ?? [];
    },
  };
}

// ── Lo que usan las rutas y la pantalla ───────────────────────────────────────

export async function createBulkSearchForUser(userId: string, body: unknown) {
  return createBulkSearch(createDeps(createSupabaseAdminClient()), userId, body);
}

export async function runBulkSearchRoundForUser(userId: string, bulkSearchId: string) {
  return runBulkSearchRound(createDeps(createSupabaseAdminClient()), bulkSearchId, userId);
}

export async function controlBulkSearchForUser(userId: string, bulkSearchId: string, action: BulkSearchControlAction) {
  return controlBulkSearch(createDeps(createSupabaseAdminClient()), bulkSearchId, userId, action);
}

export async function listBulkSearchesForUser(userId: string) {
  return listBulkSearches(createDeps(createSupabaseAdminClient()), userId);
}

/**
 * Lo que la pantalla ofrece antes de arrancar: cada cantidad con su tope y si
 * cabe en el presupuesto del mes. `null` = la búsqueda masiva no aplica a
 * quien mira (bandera apagada o no es Growth/admin).
 */
export async function resolveBulkSearchSurfaceForCurrentUser(): Promise<{ options: BulkSearchOption[] } | null> {
  const access = await resolveBulkSearchAccess();
  if (!access.ok) return null;
  try {
    return { options: await resolveBulkSearchOptions({ resolvePerRoundWorstCase, readBudgetAvailability }) };
  } catch {
    return null;
  }
}
