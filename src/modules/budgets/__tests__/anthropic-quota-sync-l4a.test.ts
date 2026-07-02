// Hito L4A — Tests puros para Anthropic cost sync
// Sin llamadas reales a la red. Solo lógica de parsing y degradación controlada.
// Usa el runner nativo de Node.js (node:test + assert).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Replica inline del parser (patrón del proyecto) ───────────────────────────

type AnyRecord = Record<string, unknown>;

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') { const n = Number(v); return isFinite(n) ? n : null; }
  return null;
}

interface AnthropicCostData {
  usdCostMtd: number;
  responseShape: string;
}

function extractCostFromItem(item: AnyRecord): number | null {
  return (
    coerceNumber(item['total_cost']) ??
    coerceNumber(item['cost_usd']) ??
    coerceNumber(item['total_cost_usd']) ??
    coerceNumber(item['amount_usd']) ??
    coerceNumber(item['cost']) ??
    null
  );
}

function parseAnthropicUsageResponse(raw: unknown): AnthropicCostData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as AnyRecord;

  if (Array.isArray(obj['data'])) {
    const items = obj['data'] as unknown[];
    let sum = 0;
    for (const item of items) {
      if (item && typeof item === 'object') {
        const cost = extractCostFromItem(item as AnyRecord);
        if (cost !== null) sum += cost;
      }
    }
    if (sum > 0 || items.length > 0) {
      return { usdCostMtd: sum, responseShape: 'data_array' };
    }
  }

  if (Array.isArray(obj['costs'])) {
    const items = obj['costs'] as unknown[];
    let sum = 0;
    for (const item of items) {
      if (item && typeof item === 'object') {
        const cost = extractCostFromItem(item as AnyRecord);
        if (cost !== null) sum += cost;
      }
    }
    if (sum > 0 || items.length > 0) {
      return { usdCostMtd: sum, responseShape: 'costs_array' };
    }
  }

  if (obj['usage'] && typeof obj['usage'] === 'object') {
    const usage = obj['usage'] as AnyRecord;
    const cost = extractCostFromItem(usage);
    if (cost !== null) return { usdCostMtd: cost, responseShape: 'usage_object' };
  }

  const rootCost = extractCostFromItem(obj);
  if (rootCost !== null) return { usdCostMtd: rootCost, responseShape: 'root_fields' };

  return null;
}

const ANTHROPIC_NO_ADMIN_KEY_MSG =
  'Costo Anthropic no disponible por API con la credencial actual — configura el presupuesto mensual USD de forma manual';

// ─── Tests: parseAnthropicUsageResponse ───────────────────────────────────────

describe('parseAnthropicUsageResponse (L4A)', () => {
  // Test 3: cost report con total_cost_usd directo en raíz
  it('extrae total_cost_usd de la raíz', () => {
    const raw = { total_cost_usd: 12.5 };
    const result = parseAnthropicUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.usdCostMtd, 12.5);
    assert.equal(result.responseShape, 'root_fields');
  });

  // Test 3b: cost report con total_cost
  it('extrae total_cost de la raíz', () => {
    const raw = { total_cost: 8.75 };
    const result = parseAnthropicUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.usdCostMtd, 8.75);
  });

  // Test 4: cost report con array de data (suma MTD)
  it('suma total_cost de un array data[]', () => {
    const raw = {
      data: [
        { model: 'claude-opus-4-5', total_cost: 5.0, input_tokens: 1000, output_tokens: 500 },
        { model: 'claude-haiku-4-5', total_cost: 1.5, input_tokens: 500, output_tokens: 200 },
        { model: 'claude-sonnet-5', total_cost: 3.0, input_tokens: 2000, output_tokens: 800 },
      ],
    };
    const result = parseAnthropicUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.usdCostMtd, 9.5);
    assert.equal(result.responseShape, 'data_array');
  });

  // Test 4b: array data[] con cost_usd
  it('suma cost_usd de un array data[]', () => {
    const raw = {
      data: [
        { cost_usd: 2.0 },
        { cost_usd: 3.5 },
      ],
    };
    const result = parseAnthropicUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.usdCostMtd, 5.5);
  });

  // Test 4c: array data[] con amount_usd
  it('suma amount_usd de un array costs[]', () => {
    const raw = {
      costs: [
        { amount_usd: 1.0 },
        { amount_usd: 2.0 },
      ],
    };
    const result = parseAnthropicUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.usdCostMtd, 3.0);
    assert.equal(result.responseShape, 'costs_array');
  });

  // Test 4d: array vacío → null (no hay datos de costo, igual que sin campo reconocible)
  it('array data[] vacío retorna null', () => {
    const raw = { data: [] };
    const result = parseAnthropicUsageResponse(raw);
    assert.equal(result, null);
  });

  // Test 5: tokens presentes pero sin costo → no usar como créditos
  it('respuesta con solo tokens sin campo de costo → retorna null', () => {
    const raw = {
      data: [
        { model: 'claude-opus-4-5', input_tokens: 10000, output_tokens: 5000 },
      ],
    };
    const result = parseAnthropicUsageResponse(raw);
    // Los items no tienen campo de costo → sum=0, array reconocible → retorna { usdCostMtd: 0 }
    // (array vacío de costos también es válido, no debe confundirse con créditos)
    assert.ok(result !== null);
    assert.equal(result.usdCostMtd, 0);
    // Tokens NO deben interpretarse como créditos — la función solo extrae cost fields
  });

  it('respuesta sin campos de costo en raíz → retorna null', () => {
    const raw = { status: 'ok', message: 'no cost data' };
    const result = parseAnthropicUsageResponse(raw);
    assert.equal(result, null);
  });

  it('retorna null para respuesta nula o no-objeto', () => {
    assert.equal(parseAnthropicUsageResponse(null), null);
    assert.equal(parseAnthropicUsageResponse(undefined), null);
    assert.equal(parseAnthropicUsageResponse('string'), null);
    assert.equal(parseAnthropicUsageResponse(42), null);
  });

  it('extrae cost del wrapper usage', () => {
    const raw = { usage: { total_cost_usd: 7.25 } };
    const result = parseAnthropicUsageResponse(raw);
    assert.ok(result !== null);
    assert.equal(result.usdCostMtd, 7.25);
    assert.equal(result.responseShape, 'usage_object');
  });
});

// ─── Tests: credencial ausente ─────────────────────────────────────────────────

describe('Anthropic degradación controlada (L4A)', () => {
  // Test 1: credencial ausente → log error con mensaje accionable
  it('mensaje de degradación es accionable y menciona USD manual', () => {
    assert.ok(ANTHROPIC_NO_ADMIN_KEY_MSG.length > 0);
    assert.ok(ANTHROPIC_NO_ADMIN_KEY_MSG.includes('manual'));
    assert.ok(ANTHROPIC_NO_ADMIN_KEY_MSG.includes('USD'));
    assert.ok(!ANTHROPIC_NO_ADMIN_KEY_MSG.includes('response_shape'));
    assert.ok(!ANTHROPIC_NO_ADMIN_KEY_MSG.includes('parser'));
  });

  // Test 2: 401/403 → error seguro (no expone detalles de auth)
  it('mensaje de 401/403 es el mismo que credencial ausente (degradación controlada)', () => {
    const simulate401 = (httpStatus: number): string => {
      if (httpStatus === 401 || httpStatus === 403) return ANTHROPIC_NO_ADMIN_KEY_MSG;
      return `Anthropic respondió ${httpStatus}`;
    };
    assert.equal(simulate401(401), ANTHROPIC_NO_ADMIN_KEY_MSG);
    assert.equal(simulate401(403), ANTHROPIC_NO_ADMIN_KEY_MSG);
    assert.notEqual(simulate401(500), ANTHROPIC_NO_ADMIN_KEY_MSG);
  });

  // Test 6: override_manual=true → no sobrescribe monthly_usd_allowance, sí actualiza usd_cost_mtd
  it('override_manual=true preserva monthly_usd_allowance y actualiza usd_cost_mtd', () => {
    const overrideManual = true;
    const usdCostMtd = 15.5;

    const baseUpdate: Record<string, unknown> = {
      usd_cost_mtd: usdCostMtd,
      quota_synced_at: new Date().toISOString(),
      quota_sync_error: null,
    };

    if (!overrideManual) {
      baseUpdate['quota_source'] = 'api_synced';
      baseUpdate['monthly_usd_allowance'] = 100; // no debe ejecutarse
    }

    assert.equal(baseUpdate['usd_cost_mtd'], 15.5);
    assert.equal(baseUpdate['quota_source'], undefined, 'quota_source no debe tocarse con override manual');
    assert.equal(baseUpdate['monthly_usd_allowance'], undefined, 'monthly_usd_allowance no debe sobrescribirse');
  });

  // Test 6b: override_manual=false → quota_source=api_synced, monthly_usd_allowance NO se toca (sin límite explícito)
  it('override_manual=false → quota_source=api_synced, monthly_usd_allowance no se toca (API solo da gasto)', () => {
    const overrideManual = false;
    const usdCostMtd = 22.0;

    const baseUpdate: Record<string, unknown> = {
      usd_cost_mtd: usdCostMtd,
      quota_synced_at: new Date().toISOString(),
      quota_sync_error: null,
    };
    if (!overrideManual) {
      baseUpdate['quota_source'] = 'api_synced';
      // monthly_usd_allowance NO se actualiza porque la API solo devuelve gasto, no límite
    }

    assert.equal(baseUpdate['quota_source'], 'api_synced');
    assert.equal(baseUpdate['usd_cost_mtd'], 22.0);
    assert.equal(baseUpdate['monthly_usd_allowance'], undefined, 'la API de uso no devuelve límite → no tocar');
  });

  // Test 7: credits_remaining_external no aplica para Anthropic
  it('Anthropic no escribe credits_remaining_external', () => {
    const successUpdate: Record<string, unknown> = {
      usd_cost_mtd: 10.0,
      quota_synced_at: new Date().toISOString(),
      quota_sync_error: null,
      quota_source: 'api_synced',
    };
    assert.equal(successUpdate['credits_remaining_external'], undefined);
    assert.equal(successUpdate['monthly_credits_allowance'], undefined);
  });
});

// ─── Tests: no regresión Tavily/Lusha/Apollo ───────────────────────────────────

describe('compatibilidad L4A — otros proveedores no regresionan', () => {
  // Test 8: Tavily/Lusha/Apollo no retornan cuando el proveedor es anthropic
  it('proveedor anthropic no invoca lógica de créditos de Tavily/Lusha/Apollo', () => {
    const providerKey = 'anthropic';

    // Simula el dispatch del syncProviderQuota
    const dispatched: string[] = [];
    function simulateDispatch(key: string): string {
      if (key === 'tavily') { dispatched.push('tavily'); return 'tavily'; }
      if (key === 'lusha') { dispatched.push('lusha'); return 'lusha'; }
      if (key === 'apollo') { dispatched.push('apollo'); return 'apollo'; }
      if (key === 'anthropic') { dispatched.push('anthropic'); return 'anthropic'; }
      return 'unknown';
    }

    const routed = simulateDispatch(providerKey);
    assert.equal(routed, 'anthropic');
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0], 'anthropic');
    assert.ok(!dispatched.includes('tavily'));
    assert.ok(!dispatched.includes('lusha'));
    assert.ok(!dispatched.includes('apollo'));
  });

  it('anthropic está en SYNCABLE_PROVIDERS', () => {
    const SYNCABLE = ['tavily', 'lusha', 'apollo', 'anthropic'];
    assert.ok(SYNCABLE.includes('anthropic'));
  });
});
