// Apollo credit quota sync — contrato REAL verificado contra la API de Apollo (2026-08-25).
//
// Estos tests importan el módulo real (no replican los parsers): el patrón de
// espejo que había antes permitió que el endpoint equivocado sobreviviera, porque
// el test verificaba una copia y no el código que corre en producción.
//
// Contrato verificado en vivo con la credencial de Vault (llamadas gratuitas):
//   GET  /api/v1/usage_stats/api_usage_stats           → 404  (era el que usábamos)
//   GET  /api/v1/usage_stats/credit_usage_stats        → 404  (GET no existe)
//   POST /api/v1/usage_stats/credit_usage_stats        → 200  saldos por tipo + ciclo
//   GET  /api/v1/users/api_profile?include_credit_usage=true → 200  saldo del usuario
//   Clave inválida en ambos endpoints                  → 401

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APOLLO_CREDIT_USAGE_STATS_ENDPOINT,
  APOLLO_CREDIT_USAGE_STATS_METHOD,
  APOLLO_API_PROFILE_ENDPOINT,
  APOLLO_QUOTA_UNREADABLE_MSG,
  parseApolloCreditUsageStats,
  parseApolloApiProfileCredits,
  buildApolloQuotaData,
} from '@/server/services/apollo-credit-usage-parsers';

// ── Payloads reales capturados (ids/email reemplazados por placeholders) ───────

const REAL_CREDIT_USAGE_STATS = {
  credit_usage_stats: {
    lead_credit: { limit: 484185, consumed: 120670, left_over: 363515 },
    direct_dial_credit: { limit: 480000, consumed: 480000, left_over: 0 },
    export_credit: { limit: 0, consumed: 0, left_over: 0 },
    conversation_credit: { limit: 480000, consumed: 0, left_over: 480000 },
    ai_credit: { limit: 96000000, consumed: 165, left_over: 95999835 },
    power_up_credit: { limit: 0, consumed: 0, left_over: 0 },
    inbound_website_visitor_credit: { limit: 1200, consumed: 0, left_over: 1200 },
    dialer: { limit: 42000, consumed: 0, left_over: 42000 },
    web_search_record_credit: { limit: 2000, consumed: 1, left_over: 1999 },
    contact_website_visitor_credit: { limit: 0, consumed: 0, left_over: 0 },
  },
  current_credit_cycle: {
    start_date: '2025-10-13T14:58:51.000+00:00',
    end_date: '2026-10-13T14:58:52.000+00:00',
  },
};

const REAL_API_PROFILE = {
  id: 'user-placeholder',
  team_id: 'team-placeholder',
  first_name: 'Ops',
  last_name: 'Placeholder',
  title: null,
  email: 'ops@example.com',
  num_credits_remaining: 6109,
  effective_num_lead_credits: 10510,
  num_lead_credits_used: 640,
  effective_num_direct_dial_credits: 480000,
  num_direct_dial_credits_used: 3760,
  effective_num_export_credits: 0,
  num_export_credits_used: 0,
  effective_num_ai_credits: 96000000,
  num_ai_credits_used: 0,
  effective_num_power_up_credits: 0,
  num_power_up_credits_used: 1,
  total_unified_credits_used: 4401,
};

// ── Contrato de endpoint: el defecto que rompía el sync ───────────────────────

describe('contrato de endpoint Apollo', () => {
  it('usa credit_usage_stats, NO el api_usage_stats que devuelve 404', () => {
    assert.ok(
      APOLLO_CREDIT_USAGE_STATS_ENDPOINT.endsWith('/usage_stats/credit_usage_stats'),
      `endpoint inesperado: ${APOLLO_CREDIT_USAGE_STATS_ENDPOINT}`,
    );
    assert.ok(!APOLLO_CREDIT_USAGE_STATS_ENDPOINT.includes('api_usage_stats'));
  });

  it('credit_usage_stats se llama por POST (con GET Apollo responde 404)', () => {
    assert.equal(APOLLO_CREDIT_USAGE_STATS_METHOD, 'POST');
  });

  it('api_profile pide explícitamente include_credit_usage=true', () => {
    // Sin ese query param la respuesta llega sin ningún campo de crédito.
    assert.ok(APOLLO_API_PROFILE_ENDPOINT.includes('include_credit_usage=true'));
  });
});

// ── parseApolloCreditUsageStats ───────────────────────────────────────────────

describe('parseApolloCreditUsageStats', () => {
  it('extrae el bolsón compartido del equipo desde la respuesta real', () => {
    const parsed = parseApolloCreditUsageStats(REAL_CREDIT_USAGE_STATS);
    assert.ok(parsed !== null);
    assert.equal(parsed.teamLimit, 484185);
    assert.equal(parsed.teamConsumed, 120670);
    assert.equal(parsed.teamRemaining, 363515);
  });

  it('toma el fin del ciclo de crédito vigente (puede ser anual)', () => {
    const parsed = parseApolloCreditUsageStats(REAL_CREDIT_USAGE_STATS);
    assert.ok(parsed !== null);
    assert.equal(parsed.cycleEnd, '2026-10-13T14:58:52.000+00:00');
  });

  it('deriva left_over de limit - consumed cuando Apollo no lo manda', () => {
    const raw = { credit_usage_stats: { lead_credit: { limit: 1000, consumed: 250 } } };
    const parsed = parseApolloCreditUsageStats(raw);
    assert.ok(parsed !== null);
    assert.equal(parsed.teamRemaining, 750);
  });

  it('retorna null para la forma de conteo de llamadas (no es saldo)', () => {
    const raw = { api_usage_stats: [{ api_name: 'people_search', count: 5 }] };
    assert.equal(parseApolloCreditUsageStats(raw), null);
  });

  it('retorna null para respuestas nulas, no-objeto o sin el wrapper', () => {
    assert.equal(parseApolloCreditUsageStats(null), null);
    assert.equal(parseApolloCreditUsageStats(undefined), null);
    assert.equal(parseApolloCreditUsageStats('texto'), null);
    assert.equal(parseApolloCreditUsageStats({ status: 404, error: 'Not Found' }), null);
  });
});

// ── parseApolloApiProfileCredits ──────────────────────────────────────────────

describe('parseApolloApiProfileCredits', () => {
  it('extrae el saldo y el tope del usuario dueño de la API key', () => {
    const parsed = parseApolloApiProfileCredits(REAL_API_PROFILE);
    assert.ok(parsed !== null);
    assert.equal(parsed.remaining, 6109);
    assert.equal(parsed.cap, 10510);
    assert.equal(parsed.unifiedUsed, 4401);
  });

  it('documenta el modelo unificado: tope - consumo unificado = saldo', () => {
    // Apollo descuenta TODOS los tipos (lead + direct dial + power up) del mismo
    // tope de usuario: 640 + 3760 + 1 = 4401, y 10510 - 4401 = 6109.
    const parsed = parseApolloApiProfileCredits(REAL_API_PROFILE);
    assert.ok(parsed !== null);
    assert.ok(parsed.cap !== null && parsed.unifiedUsed !== null);
    assert.equal(parsed.cap - parsed.unifiedUsed, parsed.remaining);
  });

  it('retorna null cuando el perfil llega sin campos de crédito', () => {
    // Es la respuesta de api_profile SIN include_credit_usage=true.
    const raw = { id: 'u1', team_id: 't1', email: 'ops@example.com' };
    assert.equal(parseApolloApiProfileCredits(raw), null);
  });

  it('retorna null para respuestas nulas o no-objeto', () => {
    assert.equal(parseApolloApiProfileCredits(null), null);
    assert.equal(parseApolloApiProfileCredits(undefined), null);
    assert.equal(parseApolloApiProfileCredits(42), null);
  });
});

// ── buildApolloQuotaData ──────────────────────────────────────────────────────

describe('buildApolloQuotaData', () => {
  it('prefiere el saldo del usuario: es el techo que realmente limita el gasto', () => {
    const profile = parseApolloApiProfileCredits(REAL_API_PROFILE);
    const usage = parseApolloCreditUsageStats(REAL_CREDIT_USAGE_STATS);
    const data = buildApolloQuotaData(profile, usage);
    assert.ok(data !== null);
    assert.equal(data.remainingScope, 'user_cap');
    assert.equal(data.creditsRemaining, 6109);
    assert.equal(data.creditsUsed, 4401);
    assert.equal(data.planLimitCredits, 10510);
  });

  it('toma el fin de ciclo del endpoint de créditos aunque el saldo venga del perfil', () => {
    const data = buildApolloQuotaData(
      parseApolloApiProfileCredits(REAL_API_PROFILE),
      parseApolloCreditUsageStats(REAL_CREDIT_USAGE_STATS),
    );
    assert.ok(data !== null);
    assert.equal(data.billingPeriodEnd, '2026-10-13T14:58:52.000+00:00');
  });

  it('cae al bolsón del equipo cuando el perfil no trae saldo, y lo declara', () => {
    const data = buildApolloQuotaData(null, parseApolloCreditUsageStats(REAL_CREDIT_USAGE_STATS));
    assert.ok(data !== null);
    assert.equal(data.remainingScope, 'team_pool');
    assert.equal(data.creditsRemaining, 363515);
    assert.equal(data.planLimitCredits, 484185);
  });

  it('retorna null cuando ninguna fuente trae saldo', () => {
    assert.equal(buildApolloQuotaData(null, null), null);
    assert.equal(buildApolloQuotaData({ remaining: null, cap: null, unifiedUsed: null }, null), null);
  });
});

// ── Honestidad del mensaje de degradación ─────────────────────────────────────

describe('mensaje de degradación', () => {
  it('NO afirma que Apollo no expone cuota por API (sí la expone)', () => {
    assert.ok(!APOLLO_QUOTA_UNREADABLE_MSG.includes('no expone'));
    assert.ok(!APOLLO_QUOTA_UNREADABLE_MSG.toLowerCase().includes('no expone cuota'));
  });

  it('describe qué pasó sin lenguaje interno de parser', () => {
    assert.ok(APOLLO_QUOTA_UNREADABLE_MSG.length > 0);
    assert.ok(!APOLLO_QUOTA_UNREADABLE_MSG.includes('parser'));
    assert.ok(!APOLLO_QUOTA_UNREADABLE_MSG.includes('response_shape'));
  });
});

// ── Guarda estática: el sync de Apollo no toca la cuota mensual ───────────────

describe('syncApollo no sobrescribe monthly_credits_allowance', () => {
  it('pasa planLimitCredits: null porque el ciclo Apollo es anual', () => {
    // Decisión de la dueña (2026-08-25): el tope mensual sigue siendo el manual.
    // applySuccessfulSync escribe monthly_credits_allowance sólo si planLimitCredits
    // no es null, así que la única forma de respetarlo es pasar null explícito.
    const src = readFileSync('src/modules/budgets/quota-sync-actions.ts', 'utf8');
    // Quitar comentarios: una guarda estática debe exigir el código, no la mención.
    const code = src
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    const start = code.indexOf('async function syncApollo');
    assert.ok(start > -1, 'no se encontró syncApollo');
    const rest = code.slice(start);
    const end = rest.indexOf('\nasync function');
    const body = end > -1 ? rest.slice(0, end) : rest;
    assert.ok(
      /planLimitCredits:\s*null/.test(body),
      'syncApollo debe pasar planLimitCredits: null para no tocar la cuota mensual',
    );
  });
});
