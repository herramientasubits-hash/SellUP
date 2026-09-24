// AGENT1-PROVIDER-RUN-SCORECARD-1 — lectura de la ficha por corrida.
//
// Server-only y de SÓLO lectura: sin escrituras, sin RPC, sin llamadas a
// proveedores. Mismo patrón de cliente que `queries.ts`.
//
// 🔴 Del metadata de cada lote se piden SÓLO las claves que la ficha usa. Un
// lote de Apollo con su checkpoint puede pesar ~190 KB; traerlo entero para
// leer seis claves haría la consulta lenta sin aportar nada.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type {
  ProviderRunScorecardInput,
  ScorecardBatchInput,
  ScorecardOutcomeCount,
  ScorecardPrice,
  ScorecardUsageLogInput,
} from './provider-run-scorecard';
import type { ProviderRunScorecardRequest } from './provider-run-scorecard-request';

/**
 * Tamaño de página de lectura. Supabase corta cada respuesta en su `max_rows`
 * (1.000 por defecto) aunque se pida más: sin paginar, una ventana con muchos
 * descartes se TRUNCARÍA en silencio. Se lee por páginas hasta agotar.
 */
const PAGE_SIZE = 1000;
/** Tope de seguridad: una ventana que lo supere falla en voz alta. */
const MAX_PAGES = 200;
/** Ids por petición `in (...)`: mantiene la URL de PostgREST acotada. */
const ID_CHUNK = 150;
/**
 * Los logs de una corrida se escriben después de crear su lote —la pierna Lusha
 * y las continuaciones, minutos u horas después—. La ventana de logs se alarga
 * para no perder los de corridas que empezaron dentro de la ventana.
 */
const USAGE_LOG_TRAILING_MS = 6 * 60 * 60 * 1000;

/** Operación de `provider_pricing_config` cuyo precio aplica a cada proveedor. */
const PRICING_OPERATION = {
  apollo: 'credit',
  lusha: 'company_prospecting_v3',
} as const;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

type Admin = ReturnType<typeof getAdminClient>;

type PageResult<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

/** Lee todas las páginas de una consulta ordenada. Falla si supera el tope. */
export async function fetchAllPages<T>(
  label: string,
  page: (from: number, to: number) => PageResult<T>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`provider-run-scorecard: ${label}: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
  throw new Error(
    `provider-run-scorecard: ${label}: la ventana supera ${MAX_PAGES * PAGE_SIZE} filas; acótala`,
  );
}

type RawBatch = {
  id: string;
  created_at: string;
  country_code: string | null;
  industry: string | null;
  provider_attempts: unknown;
  accepted_for_target: unknown;
  apollo_run_budget: unknown;
  lusha_waterfall_leg: unknown;
  billing: unknown;
  run_metrics: unknown;
};

async function fetchBatches(
  admin: Admin,
  request: ProviderRunScorecardRequest,
): Promise<ScorecardBatchInput[]> {
  const build = () => {
    let query = admin
      .from('prospect_batches')
      .select(
        [
          'id',
          'created_at',
          'country_code',
          'industry',
          'provider_attempts:metadata->provider_attempts',
          'accepted_for_target:metadata->accepted_for_target',
          'apollo_run_budget:metadata->apollo_run_budget',
          'lusha_waterfall_leg:metadata->lusha_waterfall_leg',
          'billing:metadata->billing',
          'run_metrics:metadata->apollo_two_round_discovery->run_metrics',
        ].join(', '),
      )
      .gte('created_at', request.dateFrom)
      .lt('created_at', request.dateTo)
      .is('archived_at', null);
    if (request.countryCode) query = query.eq('country_code', request.countryCode);
    if (request.industry) query = query.eq('industry', request.industry);
    return query.order('id', { ascending: true });
  };
  const data = await fetchAllPages<RawBatch>(
    'prospect_batches',
    (from, to) => build().range(from, to) as unknown as PageResult<RawBatch>,
  );
  return data.map((b) => ({
    id: b.id,
    createdAt: b.created_at,
    countryCode: b.country_code,
    industry: b.industry,
    metadata: {
      provider_attempts: b.provider_attempts,
      accepted_for_target: b.accepted_for_target,
      apollo_run_budget: b.apollo_run_budget,
      lusha_waterfall_leg: b.lusha_waterfall_leg,
      billing: b.billing,
      apollo_two_round_discovery: { run_metrics: b.run_metrics },
    },
  }));
}

type RawUsageLog = {
  id: string;
  created_at: string;
  provider_key: string;
  operation_key: string | null;
  batch_id: string | null;
  credits_used: number | string | null;
  lusha_run_observability: unknown;
  run_correlation: unknown;
};

async function fetchUsageLogs(
  admin: Admin,
  request: ProviderRunScorecardRequest,
): Promise<ScorecardUsageLogInput[]> {
  const until = new Date(new Date(request.dateTo).getTime() + USAGE_LOG_TRAILING_MS).toISOString();
  const data = await fetchAllPages<RawUsageLog>(
    'provider_usage_logs',
    (from, to) =>
      admin
        .from('provider_usage_logs')
        .select(
          'id, created_at, provider_key, operation_key, batch_id, credits_used, ' +
            'lusha_run_observability:metadata->lusha_run_observability, run_correlation:metadata->run_correlation',
        )
        .in('provider_key', ['apollo', 'lusha'])
        .gte('created_at', request.dateFrom)
        .lt('created_at', until)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PageResult<RawUsageLog>,
  );
  return data.map((l) => ({
    id: l.id,
    createdAt: l.created_at,
    providerKey: l.provider_key,
    operationKey: l.operation_key,
    batchId: l.batch_id,
    creditsUsed: l.credits_used,
    metadata: {
      lusha_run_observability: l.lusha_run_observability,
      run_correlation: l.run_correlation,
    },
  }));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchOutcomeCounts(
  admin: Admin,
  batchIds: readonly string[],
): Promise<ScorecardOutcomeCount[]> {
  const counts = new Map<string, ScorecardOutcomeCount>();
  const bump = (row: Omit<ScorecardOutcomeCount, 'count'>) => {
    const key = `${row.kind}|${row.batchId}|${row.sourcePrimary ?? ''}|${row.disposition ?? ''}`;
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { ...row, count: 1 });
  };

  for (const ids of chunk(batchIds, ID_CHUNK)) {
    const [candidates, discards] = await Promise.all([
      fetchAllPages<{ batch_id: string; source_primary: string | null }>(
        'prospect_candidates',
        (from, to) =>
          admin
            .from('prospect_candidates')
            .select('id, batch_id, source_primary')
            .in('batch_id', ids)
            .order('id', { ascending: true })
            .range(from, to) as unknown as PageResult<{
            batch_id: string;
            source_primary: string | null;
          }>,
      ),
      fetchAllPages<{
        batch_id: string;
        source_primary: string | null;
        disposition: string | null;
      }>(
        'prospect_discarded_dispositions',
        (from, to) =>
          admin
            .from('prospect_discarded_dispositions')
            .select('id, batch_id, source_primary, disposition')
            .in('batch_id', ids)
            .order('id', { ascending: true })
            .range(from, to) as unknown as PageResult<{
            batch_id: string;
            source_primary: string | null;
            disposition: string | null;
          }>,
      ),
    ]);
    for (const c of candidates) {
      bump({
        batchId: c.batch_id,
        sourcePrimary: c.source_primary,
        kind: 'candidate',
        disposition: null,
      });
    }
    for (const d of discards) {
      bump({
        batchId: d.batch_id,
        sourcePrimary: d.source_primary,
        kind: 'discard',
        disposition: d.disposition,
      });
    }
  }
  return [...counts.values()];
}

async function fetchPrices(
  admin: Admin,
  request: ProviderRunScorecardRequest,
): Promise<ScorecardPrice[]> {
  const { data, error } = await admin
    .from('provider_pricing_config')
    .select('provider_key, operation_key, unit_cost_usd, effective_from, is_active')
    .in('provider_key', ['apollo', 'lusha'])
    .eq('is_active', true);
  if (error) throw new Error(`provider-run-scorecard: provider_pricing_config: ${error.message}`);

  const prices: ScorecardPrice[] = [];
  for (const provider of ['apollo', 'lusha'] as const) {
    const override = request.usdPerCreditOverride[provider];
    if (override !== null) {
      prices.push({
        providerKey: provider,
        unitCostUsd: override,
        source: 'override',
      });
      continue;
    }
    const row = (
      (data ?? []) as {
        provider_key: string;
        operation_key: string;
        unit_cost_usd: number | string;
        effective_from: string | null;
      }[]
    ).find((p) => p.provider_key === provider && p.operation_key === PRICING_OPERATION[provider]);
    const unitCostUsd = row ? Number(row.unit_cost_usd) : NaN;
    if (row && Number.isFinite(unitCostUsd) && unitCostUsd > 0) {
      prices.push({
        providerKey: provider,
        unitCostUsd,
        source: `provider_pricing_config:${provider}/${row.operation_key}@${row.effective_from ?? 'sin_fecha'}`,
      });
    }
  }
  return prices;
}

/** Todo lo que la ficha necesita para una ventana, en cuatro lecturas acotadas. */
export async function loadProviderRunScorecardInput(
  request: ProviderRunScorecardRequest,
): Promise<ProviderRunScorecardInput> {
  const admin = getAdminClient();
  const [batches, usageLogs, prices] = await Promise.all([
    fetchBatches(admin, request),
    fetchUsageLogs(admin, request),
    fetchPrices(admin, request),
  ]);
  const outcomeCounts = await fetchOutcomeCounts(
    admin,
    batches.map((b) => b.id),
  );
  return { batches, usageLogs, outcomeCounts, prices };
}
