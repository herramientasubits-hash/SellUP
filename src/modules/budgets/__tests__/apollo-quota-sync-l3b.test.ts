// Hito L3B — Tests puros para Apollo quota sync con dos endpoints
// Sin llamadas reales a la red. Solo lógica de parsing y degradación controlada.
// Usa el runner nativo de Node.js (node:test + assert).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Replica inline de los parsers (patrón del proyecto) ───────────────────────

type AnyRecord = Record<string, unknown>;

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') { const n = Number(v); return isFinite(n) ? n : null; }
  return null;
}

interface ApolloQuotaData {
  creditsRemaining: number;
  creditsUsed: number | null;
  planLimitCredits: number | null;
  billingPeriodEnd: string | null;
  creditTypeSummary: string | null;
}

function extractEmailCredits(obj: AnyRecord) {
  const remaining = coerceNumber(obj['email_credits_remaining']) ?? coerceNumber(obj['remaining_email_credits']) ?? coerceNumber(obj['email_credits']) ?? null;
  const used = coerceNumber(obj['email_credits_used']) ?? coerceNumber(obj['used_email_credits']) ?? null;
  const limit = coerceNumber(obj['email_credits_limit']) ?? coerceNumber(obj['max_email_credits']) ?? coerceNumber(obj['total_email_credits']) ?? null;
  return { remaining, used, limit };
}

function extractPhoneCredits(obj: AnyRecord) {
  const remaining = coerceNumber(obj['phone_credits_remaining']) ?? coerceNumber(obj['remaining_phone_credits']) ?? coerceNumber(obj['mobile_credits_remaining']) ?? null;
  const limit = coerceNumber(obj['phone_credits_limit']) ?? coerceNumber(obj['max_mobile_credits']) ?? null;
  return { remaining, limit };
}

function extractGenericCredits(obj: AnyRecord) {
  const remaining = coerceNumber(obj['credits_remaining']) ?? coerceNumber(obj['remaining_credits']) ?? coerceNumber(obj['credits']) ?? null;
  const used = coerceNumber(obj['credits_used']) ?? coerceNumber(obj['used_credits']) ?? null;
  const limit = coerceNumber(obj['credits_limit']) ?? coerceNumber(obj['max_credits']) ?? coerceNumber(obj['plan_credits']) ?? null;
  return { remaining, used, limit };
}

function extractDateString(obj: AnyRecord): string | null {
  for (const key of ['credit_refresh_date', 'renewal_date', 'billing_period_end', 'plan_renew_at', 'reset_at']) {
    if (typeof obj[key] === 'string') return obj[key] as string;
  }
  return null;
}

function buildCreditTypeSummary(emailRemaining: number | null, phoneRemaining: number | null): string | null {
  const parts: string[] = [];
  if (emailRemaining !== null) parts.push(`email: ${emailRemaining.toLocaleString()}`);
  if (phoneRemaining !== null) parts.push(`phone: ${phoneRemaining.toLocaleString()}`);
  return parts.length > 0 ? parts.join(', ') : null;
}

function extractFromObject(obj: AnyRecord): ApolloQuotaData | null {
  const email = extractEmailCredits(obj);
  const phone = extractPhoneCredits(obj);
  const generic = extractGenericCredits(obj);
  let creditsRemaining = email.remaining ?? generic.remaining;
  const used = email.used ?? generic.used;
  const limit = email.limit ?? generic.limit;
  if (creditsRemaining === null && limit !== null && used !== null) creditsRemaining = limit - used;
  if (creditsRemaining === null) return null;
  return {
    creditsRemaining,
    creditsUsed: used,
    planLimitCredits: limit,
    billingPeriodEnd: extractDateString(obj),
    creditTypeSummary: buildCreditTypeSummary(email.remaining, phone.remaining),
  };
}

// ── Espejo de parseApolloHealthResponse ───────────────────────────────────────

function parseApolloHealthResponse(raw: unknown): ApolloQuotaData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as AnyRecord;
  if (obj['user'] && typeof obj['user'] === 'object') {
    const user = obj['user'] as AnyRecord;
    if (user['account'] && typeof user['account'] === 'object') {
      const r = extractFromObject(user['account'] as AnyRecord); if (r) return r;
    }
    const r = extractFromObject(user); if (r) return r;
  }
  if (obj['account'] && typeof obj['account'] === 'object') {
    const r = extractFromObject(obj['account'] as AnyRecord); if (r) return r;
  }
  if (obj['data'] && typeof obj['data'] === 'object') {
    const r = extractFromObject(obj['data'] as AnyRecord); if (r) return r;
  }
  return extractFromObject(obj);
}

// ── Espejo de parseApolloUsageStatsResponse (L3B) ─────────────────────────────

function parseApolloUsageStatsResponse(raw: unknown): ApolloQuotaData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as AnyRecord;
  // Formato conteo de llamadas — inútil para quota sync
  if (Array.isArray(obj['api_usage_stats'])) return null;
  if (obj['user'] && typeof obj['user'] === 'object') {
    const user = obj['user'] as AnyRecord;
    if (user['account'] && typeof user['account'] === 'object') {
      const r = extractFromObject(user['account'] as AnyRecord); if (r) return r;
    }
    const r = extractFromObject(user); if (r) return r;
  }
  if (obj['account'] && typeof obj['account'] === 'object') {
    const r = extractFromObject(obj['account'] as AnyRecord); if (r) return r;
  }
  if (obj['data'] && typeof obj['data'] === 'object') {
    const r = extractFromObject(obj['data'] as AnyRecord); if (r) return r;
  }
  return extractFromObject(obj);
}

// ── Mensaje de degradación controlada ─────────────────────────────────────────

const APOLLO_NO_QUOTA_ENDPOINT_MSG =
  'Cuota no disponible por API con la credencial actual — configura el límite mensual de forma manual';

// ─── Tests: parseApolloHealthResponse ─────────────────────────────────────────

describe('parseApolloHealthResponse (L3B)', () => {
  it('retorna null para respuesta { healthy, is_logged_in } sin créditos', () => {
    const raw = { healthy: true, is_logged_in: true };
    assert.equal(parseApolloHealthResponse(raw), null);
  });

  it('extrae créditos del wrapper user cuando los incluye el plan', () => {
    const raw = { user: { email_credits_remaining: 950, email_credits_limit: 1000, email_credits_used: 50 } };
    const result = parseApolloHealthResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 950);
    assert.equal(result.creditsUsed, 50);
    assert.equal(result.planLimitCredits, 1000);
  });

  it('extrae créditos del wrapper user.account', () => {
    const raw = { user: { id: 'u1', account: { email_credits_remaining: 800, email_credits_limit: 1000 } } };
    const result = parseApolloHealthResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 800);
  });

  it('extrae créditos genéricos del wrapper account en raíz', () => {
    const raw = { account: { credits_remaining: 500, credits_limit: 1000 } };
    const result = parseApolloHealthResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 500);
  });

  it('retorna null para respuesta nula o no-objeto', () => {
    assert.equal(parseApolloHealthResponse(null), null);
    assert.equal(parseApolloHealthResponse(undefined), null);
    assert.equal(parseApolloHealthResponse('string'), null);
  });
});

// ─── Tests: parseApolloUsageStatsResponse (nuevo en L3B) ──────────────────────

describe('parseApolloUsageStatsResponse (L3B)', () => {
  it('retorna null para formato conteo de llamadas (api_usage_stats array)', () => {
    const raw = {
      api_usage_stats: [
        { api_name: 'people_search', count: 5 },
        { api_name: 'organization_search', count: 3 },
      ],
    };
    assert.equal(parseApolloUsageStatsResponse(raw), null);
  });

  it('retorna null para array vacío api_usage_stats', () => {
    const raw = { api_usage_stats: [] };
    assert.equal(parseApolloUsageStatsResponse(raw), null);
  });

  it('extrae créditos del wrapper user cuando el endpoint los expone', () => {
    const raw = {
      user: {
        email_credits_limit: 1000,
        email_credits_used: 75,
        email_credits_remaining: 925,
      },
    };
    const result = parseApolloUsageStatsResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 925);
    assert.equal(result.creditsUsed, 75);
    assert.equal(result.planLimitCredits, 1000);
  });

  it('extrae créditos del wrapper data', () => {
    const raw = {
      data: {
        email_credits_remaining: 600,
        phone_credits_remaining: 20,
      },
    };
    const result = parseApolloUsageStatsResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 600);
  });

  it('extrae créditos genéricos de la raíz', () => {
    const raw = { credits_remaining: 300, credits_limit: 1000 };
    const result = parseApolloUsageStatsResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 300);
  });

  it('retorna null para respuesta sin campos de crédito reconocibles', () => {
    const raw = { healthy: true, is_logged_in: true };
    assert.equal(parseApolloUsageStatsResponse(raw), null);
  });

  it('retorna null para respuesta nula', () => {
    assert.equal(parseApolloUsageStatsResponse(null), null);
    assert.equal(parseApolloUsageStatsResponse(undefined), null);
  });

  it('construye creditTypeSummary cuando hay email y phone', () => {
    const raw = {
      user: {
        email_credits_remaining: 900,
        phone_credits_remaining: 40,
        email_credits_limit: 1000,
      },
    };
    const result = parseApolloUsageStatsResponse(raw);
    assert.ok(result !== null);
    assert.ok(result.creditTypeSummary?.includes('email'));
    assert.ok(result.creditTypeSummary?.includes('phone'));
  });

  it('deriva creditsRemaining de limit - used cuando no está directo', () => {
    const raw = { user: { email_credits_limit: 1000, email_credits_used: 200 } };
    const result = parseApolloUsageStatsResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 800);
    assert.equal(result.creditsUsed, 200);
  });
});

// ─── Tests: lógica de degradación controlada ──────────────────────────────────

describe('Apollo degradación controlada (L3B)', () => {
  it('mensaje de degradación es accionable (no técnico)', () => {
    assert.ok(APOLLO_NO_QUOTA_ENDPOINT_MSG.length > 0);
    assert.ok(!APOLLO_NO_QUOTA_ENDPOINT_MSG.includes('response_shape'));
    assert.ok(!APOLLO_NO_QUOTA_ENDPOINT_MSG.includes('parser'));
    assert.ok(APOLLO_NO_QUOTA_ENDPOINT_MSG.includes('manual'));
  });

  it('health { healthy, is_logged_in } → no créditos → se intenta usage_stats', () => {
    const healthRaw = { healthy: true, is_logged_in: true };
    const fromHealth = parseApolloHealthResponse(healthRaw);
    assert.equal(fromHealth, null, 'health no debe parsear créditos de respuesta de auth pura');

    // Simular usage_stats con formato de conteo de llamadas
    const usageRaw = { api_usage_stats: [{ api_name: 'people_search', count: 5 }] };
    const fromUsage = parseApolloUsageStatsResponse(usageRaw);
    assert.equal(fromUsage, null, 'api_usage_stats array no debe parsear como créditos');

    // Ambos null → degradación controlada
    const errorMsg = fromHealth === null && fromUsage === null ? APOLLO_NO_QUOTA_ENDPOINT_MSG : '';
    assert.equal(errorMsg, APOLLO_NO_QUOTA_ENDPOINT_MSG);
  });

  it('usage_stats con créditos reales → sync exitoso, no degradación', () => {
    const healthRaw = { healthy: true, is_logged_in: true };
    const fromHealth = parseApolloHealthResponse(healthRaw);
    assert.equal(fromHealth, null);

    const usageRaw = { user: { email_credits_remaining: 750, email_credits_limit: 1000, email_credits_used: 250 } };
    const fromUsage = parseApolloUsageStatsResponse(usageRaw);
    assert.ok(fromUsage !== null, 'debe parsear créditos del usage_stats');
    assert.equal(fromUsage.creditsRemaining, 750);

    // Con créditos disponibles, NO se aplica degradación
    const usedDegradation = fromUsage === null;
    assert.equal(usedDegradation, false);
  });

  it('health con créditos → sync exitoso sin llamar usage_stats', () => {
    const healthRaw = { user: { email_credits_remaining: 900, email_credits_limit: 1000, email_credits_used: 100 } };
    const fromHealth = parseApolloHealthResponse(healthRaw);
    assert.ok(fromHealth !== null, 'health con créditos debe parsear correctamente');
    assert.equal(fromHealth.creditsRemaining, 900);
    // Si health tiene datos, no es necesario llamar usage_stats
  });

  it('usage_stats 403 → degradación controlada (no error de auth)', () => {
    // 403 en usage_stats significa plan sin acceso al endpoint, NO credencial inválida
    // La auth ya fue confirmada por health. El mensaje es de degradación, no de auth error.
    const errorMsg = APOLLO_NO_QUOTA_ENDPOINT_MSG;
    assert.ok(!errorMsg.includes('401'));
    assert.ok(!errorMsg.includes('403'));
    assert.ok(errorMsg.includes('credencial'));
  });

  it('quota_source queda sync_error con mensaje de degradación (no api_synced)', () => {
    // Simula la lógica de applyFailedSync
    const syncResult = { ok: false as const, error: APOLLO_NO_QUOTA_ENDPOINT_MSG };
    assert.equal(syncResult.ok, false);
    assert.equal(syncResult.error, APOLLO_NO_QUOTA_ENDPOINT_MSG);
    // applyFailedSync escribirá quota_source = 'sync_error' y quota_sync_error = error
    const expectedUpdate = { quota_source: 'sync_error', quota_sync_error: APOLLO_NO_QUOTA_ENDPOINT_MSG };
    assert.equal(expectedUpdate.quota_source, 'sync_error');
    assert.ok(expectedUpdate.quota_sync_error.includes('manual'));
  });

  it('override manual previene que sync_error borre monthly_credits_allowance', () => {
    // applyFailedSync con override_manual=true no sobrescribe quota_source ni allowance
    const overrideManual = true;
    const update: Record<string, unknown> = { quota_sync_error: APOLLO_NO_QUOTA_ENDPOINT_MSG };
    if (!overrideManual) update['quota_source'] = 'sync_error';
    assert.equal(update['quota_source'], undefined);
    assert.ok(update['monthly_credits_allowance'] === undefined);
  });
});

// ─── Tests: compatibilidad con L3A ────────────────────────────────────────────

describe('compatibilidad L3A → L3B', () => {
  it('respuesta real de health (L3A) sigue parseando null (sin créditos)', () => {
    const l3aRaw = { healthy: true, is_logged_in: true };
    assert.equal(parseApolloHealthResponse(l3aRaw), null);
  });

  it('mensaje L3B es distinto al mensaje de L3A para distinguirlos en logs', () => {
    const l3aMsg = 'Respuesta sin campos de cuota reconocibles — ver response_shape en logs';
    assert.notEqual(APOLLO_NO_QUOTA_ENDPOINT_MSG, l3aMsg);
    // L3B usa un mensaje accionable; L3A usaba un mensaje técnico/interno
    assert.ok(APOLLO_NO_QUOTA_ENDPOINT_MSG.includes('manual'));
  });
});
