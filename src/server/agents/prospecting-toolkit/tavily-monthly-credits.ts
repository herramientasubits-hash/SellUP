/**
 * AGENT1-TAVILY-FREE-CREDITS-1 — tope mensual de créditos de Tavily.
 *
 * Decisión de la dueña (01-10): Tavily vive de los 1.000 créditos gratis del
 * mes; no se compran más. Antes de empezar una corrida se compara lo gastado en
 * el mes (nuestro propio registro, `provider_usage_logs`) con el tope: si no
 * alcanza para el peor caso de la corrida, Tavily no se usa.
 *
 * No se consulta a Tavily: el registro propio ya tiene cada crédito. Lo que se
 * gaste fuera de SellUp con la misma clave no se ve aquí; por eso el tope es
 * configurable (`AGENT1_TAVILY_MONTHLY_CREDIT_CAP`) y conviene dejar margen.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const TAVILY_DEFAULT_MONTHLY_CREDIT_CAP = 1000;
export const TAVILY_MONTHLY_CREDIT_CAP_ENV = 'AGENT1_TAVILY_MONTHLY_CREDIT_CAP';

export function resolveTavilyMonthlyCreditCap(raw: string | null | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : TAVILY_DEFAULT_MONTHLY_CREDIT_CAP;
}

export type TavilyMonthlyCreditsVerdict = {
  status: 'available' | 'exhausted';
  usedCredits: number;
  cap: number;
  remaining: number;
};

export function evaluateTavilyMonthlyCredits(input: {
  usedCredits: number;
  cap: number;
  runMaxCredits: number;
}): TavilyMonthlyCreditsVerdict {
  const remaining = Math.max(0, input.cap - input.usedCredits);
  return {
    status: remaining >= input.runMaxCredits ? 'available' : 'exhausted',
    usedCredits: input.usedCredits,
    cap: input.cap,
    remaining,
  };
}

/** Los créditos gratis de Tavily se cuentan por mes calendario (UTC). */
export function startOfUtcMonthIso(nowMs: number): string {
  const now = new Date(nowMs);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

const USAGE_PAGE_SIZE = 1000;

/** Créditos de Tavily registrados en el mes en curso (descubrimiento + LinkedIn). */
export async function readTavilyCreditsUsedThisMonth(supabase: SupabaseClient, nowMs: number): Promise<number> {
  const since = startOfUtcMonthIso(nowMs);
  let total = 0;
  // PostgREST corta en 1.000 filas: se pagina hasta la última.
  for (let from = 0; ; from += USAGE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('provider_usage_logs')
      .select('credits_used')
      .eq('provider_key', 'tavily')
      .gte('created_at', since)
      .order('id', { ascending: true })
      .range(from, from + USAGE_PAGE_SIZE - 1);
    if (error || !data) throw new Error(error?.message ?? 'tavily_monthly_credits_unavailable');
    const rows = data as Array<{ credits_used: number | string | null }>;
    total += rows.reduce((sum, row) => sum + (Number(row.credits_used) || 0), 0);
    if (rows.length < USAGE_PAGE_SIZE) return total;
  }
}
