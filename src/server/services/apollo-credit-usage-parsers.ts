/**
 * Apollo credit usage — contrato de endpoints y parsers puros.
 *
 * Módulo sin dependencias de red ni de Supabase, para que los tests verifiquen
 * el código que corre en producción en vez de una copia espejo.
 *
 * Contrato verificado en vivo contra la API de Apollo (2026-08-25):
 *
 *   POST /api/v1/usage_stats/credit_usage_stats            → 200
 *        Saldos del EQUIPO por tipo de crédito + ciclo vigente.
 *        No necesita body ni rango de fechas: devuelve el ciclo actual.
 *        Con GET responde 404. Ese fue el defecto que rompía el sync.
 *
 *   GET  /api/v1/users/api_profile?include_credit_usage=true → 200
 *        Saldo y tope del USUARIO dueño de la API key. Sin el query param
 *        la respuesta llega sin ningún campo de crédito.
 *
 *   Clave inválida en cualquiera de los dos                 → 401
 *
 * Modelo de créditos de Apollo: es UNIFICADO. Todos los tipos (lead, direct
 * dial, power up…) descuentan del mismo tope de usuario, y ese tope lo fija el
 * admin de la cuenta. Por eso el saldo que realmente limita el gasto de SellUp
 * es el del usuario, no el bolsón del equipo.
 */

/** Endpoint de saldos del equipo. Se llama por POST (ver APOLLO_CREDIT_USAGE_STATS_METHOD). */
export const APOLLO_CREDIT_USAGE_STATS_ENDPOINT =
  'https://api.apollo.io/api/v1/usage_stats/credit_usage_stats';

/** Apollo responde 404 a GET en este endpoint. El método es parte del contrato. */
export const APOLLO_CREDIT_USAGE_STATS_METHOD = 'POST' as const;

/** Endpoint de saldo del usuario dueño de la key. El query param es obligatorio. */
export const APOLLO_API_PROFILE_ENDPOINT =
  'https://api.apollo.io/api/v1/users/api_profile?include_credit_usage=true';

/**
 * Degradación controlada: Apollo autenticó pero no devolvió saldo legible.
 * NO afirma que Apollo no exponga cuota por API — sí la expone.
 */
export const APOLLO_QUOTA_UNREADABLE_MSG =
  'Apollo respondió sin saldo de créditos legible — revisa el detalle del último log de sync';

// ── Tipos ──────────────────────────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

/** De dónde salió el saldo reportado. */
export type ApolloRemainingScope = 'user_cap' | 'team_pool';

/** Saldos del equipo tal como los devuelve credit_usage_stats. */
export interface ApolloCreditUsageStats {
  /** left_over del bolsón compartido (lead_credit). */
  teamRemaining: number | null;
  teamLimit: number | null;
  teamConsumed: number | null;
  /** Fin del ciclo de crédito vigente. Puede ser ANUAL, no mensual. */
  cycleEnd: string | null;
}

/** Saldo del usuario dueño de la API key. */
export interface ApolloApiProfileCredits {
  /** num_credits_remaining — el techo real del gasto con esta credencial. */
  remaining: number | null;
  /** effective_num_lead_credits — tope que fija el admin de la cuenta. */
  cap: number | null;
  /** total_unified_credits_used — consumo de TODOS los tipos contra el tope. */
  unifiedUsed: number | null;
}

/** Datos normalizados que consume el sync de cuota. */
export interface ApolloQuotaData {
  creditsRemaining: number;
  creditsUsed: number | null;
  planLimitCredits: number | null;
  billingPeriodEnd: string | null;
  remainingScope: ApolloRemainingScope;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  return null;
}

function asRecord(v: unknown): AnyRecord | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRecord) : null;
}

// ── credit_usage_stats ─────────────────────────────────────────────────────────

/** Bolsón que alimenta el descubrimiento y enriquecimiento que usa SellUp. */
const APOLLO_PRIMARY_CREDIT_TYPE = 'lead_credit';

interface CreditBucket {
  limit: number | null;
  consumed: number | null;
  leftOver: number | null;
}

function readBucket(raw: unknown): CreditBucket | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const limit = coerceNumber(obj['limit']);
  const consumed = coerceNumber(obj['consumed']);
  let leftOver = coerceNumber(obj['left_over']);

  if (leftOver === null && limit !== null && consumed !== null) {
    leftOver = limit - consumed;
  }

  if (limit === null && consumed === null && leftOver === null) return null;
  return { limit, consumed, leftOver };
}

/**
 * Parsea la respuesta de POST credit_usage_stats.
 * Retorna null cuando la respuesta no trae el wrapper de saldos — incluida la
 * forma de conteo de llamadas (`api_usage_stats`), que no es saldo.
 */
export function parseApolloCreditUsageStats(raw: unknown): ApolloCreditUsageStats | null {
  const root = asRecord(raw);
  if (!root) return null;

  const buckets = asRecord(root['credit_usage_stats']);
  if (!buckets) return null;

  const primary = readBucket(buckets[APOLLO_PRIMARY_CREDIT_TYPE]);
  const cycle = asRecord(root['current_credit_cycle']);
  const cycleEnd = typeof cycle?.['end_date'] === 'string' ? (cycle['end_date'] as string) : null;

  return {
    teamRemaining: primary?.leftOver ?? null,
    teamLimit: primary?.limit ?? null,
    teamConsumed: primary?.consumed ?? null,
    cycleEnd,
  };
}

// ── api_profile ────────────────────────────────────────────────────────────────

/**
 * Parsea la respuesta de GET api_profile?include_credit_usage=true.
 * Retorna null cuando no llega ningún campo de crédito — que es exactamente lo
 * que pasa si se omite el query param.
 */
export function parseApolloApiProfileCredits(raw: unknown): ApolloApiProfileCredits | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const remaining = coerceNumber(obj['num_credits_remaining']);
  const cap = coerceNumber(obj['effective_num_lead_credits']);
  const unifiedUsed = coerceNumber(obj['total_unified_credits_used']);

  if (remaining === null && cap === null && unifiedUsed === null) return null;
  return { remaining, cap, unifiedUsed };
}

// ── Combinación ────────────────────────────────────────────────────────────────

/**
 * Combina las dos fuentes en los datos que consume el sync.
 *
 * Prefiere el saldo del USUARIO: con el modelo unificado de Apollo, el tope que
 * fija el admin sobre la credencial es el que realmente limita lo que SellUp
 * puede gastar. El bolsón del equipo queda como respaldo y se declara en
 * remainingScope para que nadie confunda un número con el otro.
 */
export function buildApolloQuotaData(
  profile: ApolloApiProfileCredits | null,
  usage: ApolloCreditUsageStats | null,
): ApolloQuotaData | null {
  const cycleEnd = usage?.cycleEnd ?? null;

  if (profile?.remaining !== null && profile?.remaining !== undefined) {
    return {
      creditsRemaining: profile.remaining,
      creditsUsed: profile.unifiedUsed,
      planLimitCredits: profile.cap,
      billingPeriodEnd: cycleEnd,
      remainingScope: 'user_cap',
    };
  }

  if (usage?.teamRemaining !== null && usage?.teamRemaining !== undefined) {
    return {
      creditsRemaining: usage.teamRemaining,
      creditsUsed: usage.teamConsumed,
      planLimitCredits: usage.teamLimit,
      billingPeriodEnd: cycleEnd,
      remainingScope: 'team_pool',
    };
  }

  return null;
}
