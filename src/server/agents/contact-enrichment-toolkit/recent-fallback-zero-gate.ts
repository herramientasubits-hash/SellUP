// Agente 2 — Compuerta «Lusha ya dio cero aquí» (AGENT2-AUDIT-FIXES-1, auditoría 21-10)
//
// Por qué existe: en Prod (07-07 → 21-10) Lusha corrió 137 veces como respaldo automático y
// 126 veces no dejó ningún candidato; 56 de esas corridas repetían una empresa donde Lusha YA
// había dado cero y se llevaron 36 créditos. Lusha busca por empresa, no por persona: si hace
// pocos días no devolvió a nadie nuevo para esta compañía, volver a llamarla casi siempre paga
// lo mismo para obtener lo mismo.
//
// Qué decide: SÍ omitir Lusha cuando la ÚLTIMA corrida terminada de Lusha para la misma
// empresa (misma ficha o mismo dominio), dentro de la ventana, no creó candidatos. Si la última
// sí encontró gente, Lusha corre como siempre.
//
// Sólo lectura, sin llamadas a proveedores. FALLA ABIERTO: sin claves de empresa, sin
// credenciales o con error de lectura, Lusha corre como hoy.
//
// Ventana: CONTACT_ENRICHMENT_LUSHA_RECENT_ZERO_SKIP_DAYS (por defecto 30; «0» la apaga).

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  buildDomainLookupSpellings,
  readContactEnrichmentRequestCompanyKeys,
} from './local-reviewable-candidate-reuse-gate';

export const RECENT_ZERO_DEFAULT_LOOKBACK_DAYS = 30;
export const RECENT_ZERO_MAX_LOOKBACK_DAYS = 180;
const RECENT_ZERO_ROW_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Días de la ventana. `0` = compuerta apagada. Valor inválido ⇒ el valor por defecto. */
export function resolveRecentZeroLookbackDays(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CONTACT_ENRICHMENT_LUSHA_RECENT_ZERO_SKIP_DAYS?.trim();
  if (raw === undefined || raw === '') return RECENT_ZERO_DEFAULT_LOOKBACK_DAYS;
  if (!/^\d+$/.test(raw)) return RECENT_ZERO_DEFAULT_LOOKBACK_DAYS;
  return Math.min(Number(raw), RECENT_ZERO_MAX_LOOKBACK_DAYS);
}

export interface PriorFallbackRunRow {
  id: string;
  request_id: string | null;
  created_at: string;
  status: string;
  summary: Record<string, unknown> | null;
}

export interface RecentFallbackZeroGateResult {
  hit: boolean;
  /** Fecha (ISO) de la corrida que dio cero; null sin acierto. */
  lastZeroAt: string | null;
  lookbackDays: number;
  /** Por qué no hubo acierto cuando no se pudo evaluar (falla abierto). */
  lookupError: string | null;
}

const TERMINAL_STATUSES = new Set(['completed', 'ready_for_review']);

/** Candidatos que dejó una corrida de Lusha, según su propio resumen. null = no se sabe. */
function createdCount(summary: Record<string, unknown> | null): number | null {
  if (!summary) return null;
  for (const key of ['candidates_created', 'totalCandidates']) {
    const value = summary[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Núcleo puro: con las corridas previas de Lusha de la misma empresa (cualquier orden), ¿la
 * más reciente terminada dentro de la ventana dio cero? Una corrida sin conteo legible no
 * cuenta como cero (conservador: Lusha corre).
 */
export function evaluateRecentFallbackZero(
  rows: readonly PriorFallbackRunRow[],
  args: { nowMs: number; lookbackDays: number; currentRequestId: string },
): Pick<RecentFallbackZeroGateResult, 'hit' | 'lastZeroAt'> {
  if (args.lookbackDays <= 0) return { hit: false, lastZeroAt: null };
  const sinceMs = args.nowMs - args.lookbackDays * DAY_MS;
  const latest = rows
    .filter((row) => row.request_id !== args.currentRequestId)
    .filter((row) => TERMINAL_STATUSES.has(row.status))
    .filter((row) => {
      const at = Date.parse(row.created_at);
      return Number.isFinite(at) && at >= sinceMs && at <= args.nowMs;
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!latest) return { hit: false, lastZeroAt: null };
  return createdCount(latest.summary) === 0
    ? { hit: true, lastZeroAt: latest.created_at }
    : { hit: false, lastZeroAt: null };
}

function getAdminClientOrNull(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key);
}

/** Lee las corridas previas del proveedor para la misma ficha o dominio (dos lecturas acotadas). */
async function readPriorFallbackRuns(args: {
  provider: string;
  accountId: string | null;
  companyDomain: string | null;
  sinceIso: string;
}): Promise<{ rows: PriorFallbackRunRow[]; lookupError: string | null }> {
  const admin = getAdminClientOrNull();
  if (!admin) return { rows: [], lookupError: 'supabase_service_credentials_not_configured' };

  const columns = 'id, request_id, created_at, status, summary';
  const base = () =>
    admin
      .from('contact_enrichment_runs')
      .select(columns)
      .eq('intended_provider', args.provider)
      .gte('created_at', args.sinceIso)
      .order('created_at', { ascending: false })
      .limit(RECENT_ZERO_ROW_LIMIT);

  try {
    const legs: Array<PromiseLike<{ data: unknown; error: { message: string } | null }>> = [];
    const accountId = args.accountId?.trim();
    if (accountId) legs.push(base().eq('account_id', accountId));
    const spellings = buildDomainLookupSpellings(args.companyDomain);
    if (spellings.length > 0) legs.push(base().in('company_domain', spellings));
    if (legs.length === 0) return { rows: [], lookupError: 'no_company_key' };

    const results = await Promise.all(legs);
    const byId = new Map<string, PriorFallbackRunRow>();
    for (const { data, error } of results) {
      if (error) return { rows: [], lookupError: error.message };
      for (const row of (data ?? []) as PriorFallbackRunRow[]) byId.set(row.id, row);
    }
    return { rows: [...byId.values()], lookupError: null };
  } catch (err) {
    return { rows: [], lookupError: err instanceof Error ? err.message : 'unknown_lookup_error' };
  }
}

export interface RecentFallbackZeroGateDeps {
  nowMs?: () => number;
  lookbackDays?: () => number;
  readRequestCompanyKeys?: typeof readContactEnrichmentRequestCompanyKeys;
  readPriorRuns?: typeof readPriorFallbackRuns;
}

export async function evaluateRecentFallbackZeroGate(
  input: { requestId: string; provider: string },
  deps: RecentFallbackZeroGateDeps = {},
): Promise<RecentFallbackZeroGateResult> {
  const lookbackDays = (deps.lookbackDays ?? resolveRecentZeroLookbackDays)();
  const miss = (lookupError: string | null): RecentFallbackZeroGateResult => ({
    hit: false,
    lastZeroAt: null,
    lookbackDays,
    lookupError,
  });
  if (lookbackDays <= 0) return miss(null);

  const nowMs = (deps.nowMs ?? Date.now)();
  const keys = await (deps.readRequestCompanyKeys ?? readContactEnrichmentRequestCompanyKeys)(input.requestId);
  if (!keys.company) return miss(keys.lookupError ?? 'request_not_found');

  const prior = await (deps.readPriorRuns ?? readPriorFallbackRuns)({
    provider: input.provider,
    accountId: keys.company.accountId,
    companyDomain: keys.company.companyDomain,
    sinceIso: new Date(nowMs - lookbackDays * DAY_MS).toISOString(),
  });
  if (prior.lookupError) return miss(prior.lookupError);

  const decision = evaluateRecentFallbackZero(prior.rows, {
    nowMs,
    lookbackDays,
    currentRequestId: input.requestId,
  });
  return { ...decision, lookbackDays, lookupError: null };
}
