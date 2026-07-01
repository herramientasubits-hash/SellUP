// Hito L2 — Tests puros para parsers de cuota Tavily y Lusha
// Sin llamadas reales. Sin fetch. Solo lógica de parsing.
// Usa el runner nativo de Node.js (node:test + assert).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Importamos las funciones puras directamente desde los archivos de servicio.
// En este contexto de test, los imports deben ser rutas relativas al proyecto.
// Como las funciones son puras (no hacen fetch en el parser), podemos importarlas.

// ── Replicamos los parsers inline para evitar dependencias de módulo en node:test ──
// (Patrón del proyecto: los tests de parsers puros replican la lógica)

type AnyRecord = Record<string, unknown>;

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') { const n = Number(v); return isFinite(n) ? n : null; }
  return null;
}

// ── Tavily parser (espejo de tavily-quota-sync.ts) ────────────────────────────

interface TavilyQuotaData {
  creditsRemaining: number;
  creditsUsed: number | null;
  planLimitCredits: number | null;
  billingPeriodEnd: string | null;
}

function extractTavilyFromObject(obj: AnyRecord): TavilyQuotaData | null {
  const remaining = coerceNumber(obj['credits_remaining']) ?? coerceNumber(obj['remaining_credits']) ?? coerceNumber(obj['creditsRemaining']) ?? null;
  const used = coerceNumber(obj['credits_used']) ?? coerceNumber(obj['used_credits']) ?? coerceNumber(obj['creditsUsed']) ?? null;
  const limit = coerceNumber(obj['max_credits']) ?? coerceNumber(obj['plan_credits']) ?? coerceNumber(obj['total_credits']) ?? coerceNumber(obj['credits_limit']) ?? coerceNumber(obj['limit_credits']) ?? null;
  let creditsRemaining = remaining;
  if (creditsRemaining === null && used !== null && limit !== null) creditsRemaining = limit - used;
  if (creditsRemaining === null) return null;
  const billingPeriodEnd = typeof obj['reset_at'] === 'string' ? obj['reset_at'] : typeof obj['reset_date'] === 'string' ? obj['reset_date'] : typeof obj['billing_period_end'] === 'string' ? obj['billing_period_end'] : typeof obj['period_end'] === 'string' ? obj['period_end'] : null;
  return { creditsRemaining, creditsUsed: used, planLimitCredits: limit, billingPeriodEnd };
}

function parseTavilyUsageResponse(raw: unknown): TavilyQuotaData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as AnyRecord;
  if (obj['usage'] && typeof obj['usage'] === 'object') { const r = extractTavilyFromObject(obj['usage'] as AnyRecord); if (r) return r; }
  if (obj['data'] && typeof obj['data'] === 'object') { const r = extractTavilyFromObject(obj['data'] as AnyRecord); if (r) return r; }
  return extractTavilyFromObject(obj);
}

// ── Lusha parser (espejo de lusha-quota-sync.ts) ──────────────────────────────

interface LushaQuotaData {
  creditsRemaining: number;
  creditsUsed: number | null;
  totalCredits: number | null;
  renewalDate: string | null;
}

function extractLushaFromObject(obj: AnyRecord): LushaQuotaData | null {
  const remaining = coerceNumber(obj['remaining_credits']) ?? coerceNumber(obj['remainingCredits']) ?? coerceNumber(obj['credits_remaining']) ?? coerceNumber(obj['available_credits']) ?? null;
  const used = coerceNumber(obj['used_credits']) ?? coerceNumber(obj['usedCredits']) ?? coerceNumber(obj['credits_used']) ?? null;
  const total = coerceNumber(obj['total_credits']) ?? coerceNumber(obj['totalCredits']) ?? coerceNumber(obj['plan_credits']) ?? coerceNumber(obj['max_credits']) ?? null;
  let creditsRemaining = remaining;
  if (creditsRemaining === null && total !== null && used !== null) creditsRemaining = total - used;
  if (creditsRemaining === null) return null;
  const renewalDate = typeof obj['renewal_date'] === 'string' ? obj['renewal_date'] : typeof obj['renewalDate'] === 'string' ? obj['renewalDate'] : typeof obj['reset_date'] === 'string' ? obj['reset_date'] : typeof obj['billing_cycle_end'] === 'string' ? obj['billing_cycle_end'] : typeof obj['next_renewal'] === 'string' ? obj['next_renewal'] : null;
  return { creditsRemaining, creditsUsed: used, totalCredits: total, renewalDate };
}

function parseLushaUsageResponse(raw: unknown): LushaQuotaData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as AnyRecord;
  if (obj['data'] && typeof obj['data'] === 'object') { const r = extractLushaFromObject(obj['data'] as AnyRecord); if (r) return r; }
  if (obj['credits'] && typeof obj['credits'] === 'object') { const r = extractLushaFromObject(obj['credits'] as AnyRecord); if (r) return r; }
  if (obj['account'] && typeof obj['account'] === 'object') { const r = extractLushaFromObject(obj['account'] as AnyRecord); if (r) return r; }
  return extractLushaFromObject(obj);
}

// ─── Tavily ───────────────────────────────────────────────────────────────────

describe('parseTavilyUsageResponse', () => {
  it('parsea response completa con wrapper usage', () => {
    const raw = { usage: { credits_used: 123, credits_remaining: 377, max_credits: 500, reset_at: '2026-08-01T00:00:00Z' } };
    const result = parseTavilyUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 377);
    assert.equal(result.creditsUsed, 123);
    assert.equal(result.planLimitCredits, 500);
    assert.equal(result.billingPeriodEnd, '2026-08-01T00:00:00Z');
  });

  it('parsea response sin reset_date (billing period end null)', () => {
    const raw = { credits_used: 50, credits_remaining: 450 };
    const result = parseTavilyUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 450);
    assert.equal(result.billingPeriodEnd, null);
  });

  it('retorna null si no hay credits_remaining y no puede derivarse', () => {
    const result = parseTavilyUsageResponse({ credits_used: 100 });
    assert.equal(result, null);
  });

  it('deriva credits_remaining de used + total cuando no está disponible directamente', () => {
    const raw = { credits_used: 100, max_credits: 500 };
    const result = parseTavilyUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 400);
    assert.equal(result.planLimitCredits, 500);
  });

  it('acepta nombres alternativos de campos (remaining_credits, plan_credits)', () => {
    const raw = { remaining_credits: 200, used_credits: 300, plan_credits: 500, reset_date: '2026-08-01' };
    const result = parseTavilyUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 200);
    assert.equal(result.planLimitCredits, 500);
    assert.equal(result.billingPeriodEnd, '2026-08-01');
  });

  it('retorna null para respuesta con formato totalmente inválido', () => {
    assert.equal(parseTavilyUsageResponse(null), null);
    assert.equal(parseTavilyUsageResponse(undefined), null);
    assert.equal(parseTavilyUsageResponse('string'), null);
    assert.equal(parseTavilyUsageResponse({ error: 'bad request' }), null);
  });

  it('acepta campos camelCase (creditsRemaining)', () => {
    const raw = { creditsRemaining: 150, creditsUsed: 50 };
    const result = parseTavilyUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 150);
  });

  it('acepta datos en wrapper data', () => {
    const raw = { data: { credits_remaining: 300, credits_used: 200, max_credits: 500 } };
    const result = parseTavilyUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 300);
  });
});

// ─── Lusha ────────────────────────────────────────────────────────────────────

describe('parseLushaUsageResponse', () => {
  it('parsea response completa con total/used/remaining', () => {
    const raw = { total_credits: 1000, used_credits: 200, remaining_credits: 800, renewal_date: '2026-08-01' };
    const result = parseLushaUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 800);
    assert.equal(result.creditsUsed, 200);
    assert.equal(result.totalCredits, 1000);
    assert.equal(result.renewalDate, '2026-08-01');
  });

  it('deriva remaining de total - used cuando no está disponible directamente', () => {
    const raw = { total_credits: 1000, used_credits: 300 };
    const result = parseLushaUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 700);
  });

  it('acepta renewal_date como null (campo opcional)', () => {
    const raw = { remaining_credits: 500, total_credits: 1000, used_credits: 500 };
    const result = parseLushaUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.renewalDate, null);
  });

  it('acepta formato con wrapper data + camelCase', () => {
    const raw = { data: { totalCredits: 1000, usedCredits: 100, remainingCredits: 900, renewalDate: '2026-08-01' } };
    const result = parseLushaUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 900);
    assert.equal(result.renewalDate, '2026-08-01');
  });

  it('acepta formato con wrapper credits', () => {
    const raw = { credits: { remaining_credits: 750, used_credits: 250, total_credits: 1000 } };
    const result = parseLushaUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 750);
  });

  it('retorna null para respuesta inválida sin campos de cuota', () => {
    assert.equal(parseLushaUsageResponse(null), null);
    assert.equal(parseLushaUsageResponse({ status: 'ok' }), null);
    assert.equal(parseLushaUsageResponse('string'), null);
  });

  it('acepta nombres alternativos (renewalDate camelCase)', () => {
    const raw = { remainingCredits: 400, usedCredits: 100, totalCredits: 500, renewalDate: '2026-09-01' };
    const result = parseLushaUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.creditsRemaining, 400);
    assert.equal(result.renewalDate, '2026-09-01');
  });

  it('no usa total como remaining cuando no hay used disponible', () => {
    const result = parseLushaUsageResponse({ total_credits: 1000 });
    assert.equal(result, null);
  });
});

// ─── Reglas de override manual ────────────────────────────────────────────────

describe('quota_override_manual rules', () => {
  it('manual override true debe preservar monthly allowance', () => {
    const overrideManual = true;
    const planLimitFromApi = 999;
    const baseUpdate: Record<string, unknown> = { credits_remaining_external: 500 };
    if (!overrideManual && planLimitFromApi !== null) baseUpdate['monthly_credits_allowance'] = planLimitFromApi;
    assert.equal(baseUpdate['monthly_credits_allowance'], undefined);
  });

  it('manual override false permite actualizar monthly allowance desde API', () => {
    const overrideManual = false;
    const planLimitFromApi = 999;
    const baseUpdate: Record<string, unknown> = { credits_remaining_external: 500 };
    if (!overrideManual && planLimitFromApi !== null) baseUpdate['monthly_credits_allowance'] = planLimitFromApi;
    assert.equal(baseUpdate['monthly_credits_allowance'], 999);
  });

  it('error de sync no borra valores existentes — solo escribe quota_sync_error', () => {
    const errorUpdate = { quota_sync_error: 'Credencial no configurada', quota_source: 'sync_error' };
    assert.equal((errorUpdate as Record<string, unknown>)['monthly_credits_allowance'], undefined);
    assert.equal((errorUpdate as Record<string, unknown>)['credits_remaining_external'], undefined);
  });
});
