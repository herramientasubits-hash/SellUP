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
