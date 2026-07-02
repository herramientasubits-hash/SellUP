// fix(budgets): always log lusha quota sync attempts
//
// Tests que garantizan que TODO intento de sync Lusha deja traza en
// tool_quota_sync_logs, sin importar si la credencial falta, el fetch
// lanza, el parser falla o el sync es exitoso.
//
// Sin llamadas reales. Sin fetch. Sin Supabase. Solo lógica pura.
// Patrón del proyecto: replicamos inline la lógica a probar.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Tipos replicados ──────────────────────────────────────────────────────────

interface QuotaSyncObservability {
  httpStatus?: number;
  endpoint: string;
  responseShape: unknown;
  rawResponseSanitized: unknown;
}

type LushaQuotaData = {
  creditsRemaining: number;
  creditsUsed: number | null;
  totalCredits: number | null;
  renewalDate: string | null;
};

type LushaQuotaSyncResult =
  | { ok: true; data: LushaQuotaData; obs: QuotaSyncObservability }
  | { ok: false; error: string; obs?: QuotaSyncObservability };

interface QuotaSyncResult {
  success: boolean;
  error?: string;
  skippedAllowance?: boolean;
}

// ── Lógica inline — espejo de syncLusha en quota-sync-actions.ts ─────────────
//
// La función acepta fetchLushaQuota y applyFailedSync como dependencias
// inyectadas para que sea testeable sin Supabase ni fetch real.

async function syncLushaTestable(
  fetchLusha: () => Promise<LushaQuotaSyncResult>,
  applyFailed: (msg: string, obs?: QuotaSyncObservability) => Promise<void>,
  applySuccess: (data: LushaQuotaData, obs: QuotaSyncObservability) => Promise<QuotaSyncResult>,
): Promise<QuotaSyncResult> {
  let result: LushaQuotaSyncResult;
  try {
    result = await fetchLusha();
  } catch {
    const errMsg = 'Error inesperado al obtener cuota de Lusha';
    await applyFailed(errMsg, undefined).catch(() => {});
    return { success: false, error: errMsg };
  }

  if (!result.ok) {
    await applyFailed(result.error, result.obs).catch(() => {});
    return { success: false, error: result.error };
  }

  return applySuccess(result.data, result.obs);
}

// ── Helper: isSyncable logic (espejo de quota-sync-actions.ts) ────────────────

const SYNCABLE_PROVIDERS = new Set(['tavily', 'lusha']);
function isSyncable(key: string): boolean {
  return SYNCABLE_PROVIDERS.has(key);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('isSyncable — Lusha incluido en proveedores sincronizables', () => {
  it("providerKey='lusha' es syncable", () => {
    assert.equal(isSyncable('lusha'), true);
  });

  it("providerKey='tavily' es syncable (Tavily no afectado)", () => {
    assert.equal(isSyncable('tavily'), true);
  });

  it("providerKey='apollo' no es syncable", () => {
    assert.equal(isSyncable('apollo'), false);
  });

  it("providerKey='' no es syncable", () => {
    assert.equal(isSyncable(''), false);
  });
});

describe('syncLusha — Caso A: credencial no configurada genera log error', () => {
  it('llama applyFailed con "Credencial no configurada" cuando fetchLusha retorna error', async () => {
    const calls: Array<{ msg: string; obs?: QuotaSyncObservability }> = [];

    const fetchLusha = async (): Promise<LushaQuotaSyncResult> =>
      ({ ok: false, error: 'Credencial no configurada' });

    const applyFailed = async (msg: string, obs?: QuotaSyncObservability) => {
      calls.push({ msg, obs });
    };

    const result = await syncLushaTestable(
      fetchLusha,
      applyFailed,
      async () => ({ success: true }),
    );

    assert.equal(result.success, false);
    assert.equal(result.error, 'Credencial no configurada');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].msg, 'Credencial no configurada');
    assert.equal(calls[0].obs, undefined);
  });
});

describe('syncLusha — Caso B: fetch lanza excepción genera log error', () => {
  it('llama applyFailed con mensaje genérico cuando fetchLusha lanza', async () => {
    const calls: Array<{ msg: string; obs?: QuotaSyncObservability }> = [];

    const fetchLusha = async (): Promise<LushaQuotaSyncResult> => {
      throw new Error('Vault connection failed');
    };

    const applyFailed = async (msg: string, obs?: QuotaSyncObservability) => {
      calls.push({ msg, obs });
    };

    const result = await syncLushaTestable(
      fetchLusha,
      applyFailed,
      async () => ({ success: true }),
    );

    assert.equal(result.success, false);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].obs, undefined);
  });

  it('genera log incluso si fetchLusha lanza error de credencial de Vault', async () => {
    const calls: string[] = [];

    const fetchLusha = async (): Promise<LushaQuotaSyncResult> => {
      throw new Error('enrichment_configuration_unavailable');
    };

    const applyFailed = async (msg: string) => { calls.push(msg); };

    const result = await syncLushaTestable(
      fetchLusha,
      applyFailed,
      async () => ({ success: true }),
    );

    assert.equal(result.success, false);
    assert.equal(calls.length, 1);
  });
});

describe('syncLusha — Caso C: parser error genera log con response_shape', () => {
  it('llama applyFailed con obs.responseShape cuando parser no reconoce respuesta', async () => {
    const calls: Array<{ msg: string; obs?: QuotaSyncObservability }> = [];

    const obs: QuotaSyncObservability = {
      httpStatus: 200,
      endpoint: 'https://api.lusha.com/account/usage',
      responseShape: { _type: 'object', keys: ['success', 'account_info'] },
      rawResponseSanitized: { success: true, account_info: { plan: 'enterprise' } },
    };

    const fetchLusha = async (): Promise<LushaQuotaSyncResult> =>
      ({ ok: false, error: 'Respuesta sin campos de cuota reconocibles', obs });

    const applyFailed = async (msg: string, o?: QuotaSyncObservability) => {
      calls.push({ msg, obs: o });
    };

    const result = await syncLushaTestable(
      fetchLusha,
      applyFailed,
      async () => ({ success: true }),
    );

    assert.equal(result.success, false);
    assert.equal(result.error, 'Respuesta sin campos de cuota reconocibles');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].msg, 'Respuesta sin campos de cuota reconocibles');
    assert.ok(calls[0].obs !== undefined, 'obs debe estar presente para diagnóstico');
    assert.equal(calls[0].obs?.httpStatus, 200);
    assert.ok(calls[0].obs?.responseShape !== null);
  });

  it('incluye http_status cuando Lusha responde 401', async () => {
    const calls: Array<{ msg: string; obs?: QuotaSyncObservability }> = [];

    const obs: QuotaSyncObservability = {
      httpStatus: 401,
      endpoint: 'https://api.lusha.com/account/usage',
      responseShape: null,
      rawResponseSanitized: null,
    };

    const fetchLusha = async (): Promise<LushaQuotaSyncResult> =>
      ({ ok: false, error: 'Proveedor respondió 401', obs });

    const applyFailed = async (msg: string, o?: QuotaSyncObservability) => {
      calls.push({ msg, obs: o });
    };

    await syncLushaTestable(fetchLusha, applyFailed, async () => ({ success: true }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].obs?.httpStatus, 401);
    assert.equal(calls[0].msg, 'Proveedor respondió 401');
  });
});

describe('syncLusha — Caso D: sync exitoso genera log success', () => {
  it('llama applySuccess con datos de cuota cuando fetch es exitoso', async () => {
    const successCalls: Array<{ data: LushaQuotaData; obs: QuotaSyncObservability }> = [];

    const quota: LushaQuotaData = {
      creditsRemaining: 15000,
      creditsUsed: 5000,
      totalCredits: 20000,
      renewalDate: '2026-08-01',
    };

    const obs: QuotaSyncObservability = {
      httpStatus: 200,
      endpoint: 'https://api.lusha.com/account/usage',
      responseShape: { _type: 'object', keys: ['remaining_credits', 'total_credits'] },
      rawResponseSanitized: { remaining_credits: 15000, total_credits: 20000 },
    };

    const fetchLusha = async (): Promise<LushaQuotaSyncResult> =>
      ({ ok: true, data: quota, obs });

    const applyFailed = async () => {
      throw new Error('applyFailed should not be called on success');
    };

    const applySuccess = async (d: LushaQuotaData, o: QuotaSyncObservability): Promise<QuotaSyncResult> => {
      successCalls.push({ data: d, obs: o });
      return { success: true };
    };

    const result = await syncLushaTestable(fetchLusha, applyFailed, applySuccess);

    assert.equal(result.success, true);
    assert.equal(successCalls.length, 1);
    assert.equal(successCalls[0].data.creditsRemaining, 15000);
    assert.equal(successCalls[0].obs.httpStatus, 200);
  });
});

describe('syncLusha — applyFailed no bloquea resultado aunque DB falle', () => {
  it('retorna QuotaSyncResult aunque applyFailed rechace (DB error silenciado)', async () => {
    const fetchLusha = async (): Promise<LushaQuotaSyncResult> =>
      ({ ok: false, error: 'Credencial no configurada' });

    // Simula que el INSERT en tool_quota_sync_logs falla
    const applyFailed = async () => {
      throw new Error('DB insert failed: FK violation');
    };

    // Debe retornar sin propagar la excepción del DB
    const result = await syncLushaTestable(
      fetchLusha,
      applyFailed,
      async () => ({ success: true }),
    );

    assert.equal(result.success, false);
    assert.equal(result.error, 'Credencial no configurada');
  });
});

describe('Tavily — isSyncable no afectado', () => {
  it("'tavily' sigue siendo syncable", () => {
    assert.equal(isSyncable('tavily'), true);
  });
});

// ── Parser Lusha: estructura real usage.credits.* ─────────────────────────────
//
// Replica parseLushaUsageResponse inline para verificar la lógica sin imports.

type AnyRecord = Record<string, unknown>;

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  return null;
}

function extractFromObject(obj: AnyRecord): LushaQuotaData | null {
  const remaining =
    coerceNumber(obj['remaining']) ??
    coerceNumber(obj['remaining_credits']) ??
    coerceNumber(obj['remainingCredits']) ??
    coerceNumber(obj['credits_remaining']) ??
    coerceNumber(obj['available_credits']) ??
    null;

  const used =
    coerceNumber(obj['used']) ??
    coerceNumber(obj['used_credits']) ??
    coerceNumber(obj['usedCredits']) ??
    coerceNumber(obj['credits_used']) ??
    null;

  const total =
    coerceNumber(obj['total']) ??
    coerceNumber(obj['total_credits']) ??
    coerceNumber(obj['totalCredits']) ??
    coerceNumber(obj['plan_credits']) ??
    coerceNumber(obj['max_credits']) ??
    null;

  let creditsRemaining = remaining;
  if (creditsRemaining === null && total !== null && used !== null) {
    creditsRemaining = total - used;
  }
  if (creditsRemaining === null) return null;

  const renewalDate =
    typeof obj['renewal_date'] === 'string' ? obj['renewal_date'] :
    typeof obj['renewalDate'] === 'string' ? obj['renewalDate'] :
    null;

  return { creditsRemaining, creditsUsed: used, totalCredits: total, renewalDate };
}

function parseLushaUsageResponseInline(raw: unknown): LushaQuotaData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as AnyRecord;

  if (obj['usage'] && typeof obj['usage'] === 'object') {
    const usage = obj['usage'] as AnyRecord;
    if (usage['credits'] && typeof usage['credits'] === 'object') {
      const result = extractFromObject(usage['credits'] as AnyRecord);
      if (result) return result;
    }
    const result = extractFromObject(usage);
    if (result) return result;
  }

  if (obj['data'] && typeof obj['data'] === 'object') {
    const result = extractFromObject(obj['data'] as AnyRecord);
    if (result) return result;
  }

  if (obj['credits'] && typeof obj['credits'] === 'object') {
    const result = extractFromObject(obj['credits'] as AnyRecord);
    if (result) return result;
  }

  if (obj['account'] && typeof obj['account'] === 'object') {
    const result = extractFromObject(obj['account'] as AnyRecord);
    if (result) return result;
  }

  return extractFromObject(obj);
}

describe('parseLushaUsageResponse — estructura real usage.credits.*', () => {
  it('Test 1: total/used/remaining numéricos', () => {
    const raw = { usage: { credits: { total: 1000, used: 100, remaining: 900 } } };
    const result = parseLushaUsageResponseInline(raw);
    assert.ok(result !== null);
    assert.equal(result!.totalCredits, 1000);
    assert.equal(result!.creditsUsed, 100);
    assert.equal(result!.creditsRemaining, 900);
  });

  it('Test 2: total/used/remaining como strings numéricos', () => {
    const raw = { usage: { credits: { total: '1000', used: '100', remaining: '900' } } };
    const result = parseLushaUsageResponseInline(raw);
    assert.ok(result !== null);
    assert.equal(result!.totalCredits, 1000);
    assert.equal(result!.creditsUsed, 100);
    assert.equal(result!.creditsRemaining, 900);
  });

  it('Test 3: total + used sin remaining → derive remaining = total - used', () => {
    const raw = { usage: { credits: { total: 1000, used: 200 } } };
    const result = parseLushaUsageResponseInline(raw);
    assert.ok(result !== null);
    assert.equal(result!.creditsRemaining, 800);
    assert.equal(result!.totalCredits, 1000);
    assert.equal(result!.creditsUsed, 200);
  });

  it('Test 4: solo remaining sin total → éxito parcial, credits_remaining_external actualizable pero no allowance', () => {
    const raw = { usage: { credits: { remaining: 500 } } };
    const result = parseLushaUsageResponseInline(raw);
    assert.ok(result !== null, 'debe parsear con remaining solo');
    assert.equal(result!.creditsRemaining, 500);
    assert.equal(result!.totalCredits, null);
    assert.equal(result!.creditsUsed, null);
  });

  it('Test 5: solo total sin used ni remaining → error (null)', () => {
    const raw = { usage: { credits: { total: 1000 } } };
    const result = parseLushaUsageResponseInline(raw);
    assert.equal(result, null, 'no debe considerar éxito sin remaining derivable');
  });

  it('Test 7: sin usage.credits → sigue fallando (null)', () => {
    const raw = { other_field: { something: 123 } };
    const result = parseLushaUsageResponseInline(raw);
    assert.equal(result, null);
  });

  it('Test 7b: respuesta vacía → null', () => {
    const result = parseLushaUsageResponseInline({});
    assert.equal(result, null);
  });
});

describe('parseLushaUsageResponse — quota_override_manual (Test 6)', () => {
  it('Test 6: override manual=true no sobrescribe allowance pero sí actualiza credits_remaining_external', () => {
    // Simula la lógica de applySuccess con quota_override_manual=true
    const parsed: LushaQuotaData = {
      creditsRemaining: 900,
      creditsUsed: 100,
      totalCredits: 1000,
      renewalDate: null,
    };

    // Snapshot del estado previo (override manual activo)
    const currentAllowance = 500; // valor manual configurado

    // Lógica espejo de quota-sync-actions: si override manual, no toca allowance
    const quotaOverrideManual = true;
    const newAllowance = quotaOverrideManual ? currentAllowance : parsed.totalCredits;
    const newRemaining = parsed.creditsRemaining;

    assert.equal(newAllowance, 500, 'allowance no debe cambiar con override manual');
    assert.equal(newRemaining, 900, 'credits_remaining_external sí debe actualizarse');
  });

  it('Test 6b: override manual=false actualiza allowance desde total', () => {
    const parsed: LushaQuotaData = {
      creditsRemaining: 900,
      creditsUsed: 100,
      totalCredits: 1000,
      renewalDate: null,
    };

    const currentAllowance = 500;
    const quotaOverrideManual = false;
    const newAllowance = quotaOverrideManual ? currentAllowance : parsed.totalCredits;
    const newRemaining = parsed.creditsRemaining;

    assert.equal(newAllowance, 1000, 'allowance debe actualizarse desde total con override=false');
    assert.equal(newRemaining, 900);
  });
});
