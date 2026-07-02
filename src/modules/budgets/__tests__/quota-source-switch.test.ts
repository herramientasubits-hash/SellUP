// Hito L2.4 — Tests puros para lógica de cambio de fuente de cuota
// Sin llamadas reales. Sin fetch. Sin DB. Solo lógica pura.
// Usa el runner nativo de Node.js (node:test + assert).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Tipos espejo ──────────────────────────────────────────────────────────────

type QuotaSource = 'manual' | 'api_synced' | 'sync_error';

interface ProviderState {
  providerKey: string;
  quotaSource: QuotaSource | null;
  quotaOverrideManual: boolean;
  monthlyCreditsAllowance: number | null;
  monthlyUsdAllowance: number | null;
  creditsRemainingExternal: number | null;
  usdCostMtd: number | null;
  quotaSyncedAt: string | null;
  quotaSyncError: string | null;
}

// ── Helpers de estado (espejo de la lógica de la acción) ──────────────────────

interface SyncApiResult {
  ok: boolean;
  planLimitCredits?: number;
  creditsRemaining?: number;
  usdCostMtd?: number;
  error?: string;
}

/**
 * Simula la transición de estado que ejecuta useApiQuotaAsPrimary.
 * Recibe el estado actual + resultado del sync y retorna el nuevo estado.
 */
function applyUseApiQuota(
  state: ProviderState,
  syncResult: SyncApiResult,
): { newState: ProviderState; success: boolean; error?: string } {
  if (!syncResult.ok) {
    // Sync failed — restore manual override
    return {
      newState: {
        ...state,
        quotaOverrideManual: true,
        quotaSource: 'manual',
        quotaSyncError: syncResult.error ?? 'sync failed',
      },
      success: false,
      error: syncResult.error,
    };
  }

  return {
    newState: {
      ...state,
      quotaOverrideManual: false,
      quotaSource: 'api_synced',
      quotaSyncError: null,
      monthlyCreditsAllowance: syncResult.planLimitCredits ?? state.monthlyCreditsAllowance,
      creditsRemainingExternal: syncResult.creditsRemaining ?? state.creditsRemainingExternal,
      usdCostMtd: syncResult.usdCostMtd ?? state.usdCostMtd,
    },
    success: true,
  };
}

/**
 * Simula guardar manual override desde el formulario (acción updateProviderAllowance).
 */
function applyManualSave(
  state: ProviderState,
  credits: number | null,
  usd: number | null,
): ProviderState {
  const isClearing = credits === null && usd === null;
  return {
    ...state,
    monthlyCreditsAllowance: credits,
    monthlyUsdAllowance: usd,
    quotaSource: isClearing ? null : 'manual',
    quotaOverrideManual: !isClearing,
    // External data is preserved as reference
  };
}

// ── Helper UI: determinar etiqueta de fuente para la tabla ────────────────────

function deriveQuotaSourceLabel(
  quotaSource: QuotaSource | null,
  quotaOverrideManual: boolean,
  creditsRemainingExternal: number | null,
  quotaSyncedAt: string | null,
): { primaryLabel: string; showExternalLine: boolean; canSwitchToApi: boolean } {
  const hasExternalData = creditsRemainingExternal != null && quotaSyncedAt != null;

  if (quotaSource === 'api_synced' && !quotaOverrideManual) {
    return { primaryLabel: 'API synced', showExternalLine: false, canSwitchToApi: false };
  }
  if (quotaSource === 'manual' && quotaOverrideManual) {
    return {
      primaryLabel: 'Manual',
      showExternalLine: hasExternalData,
      canSwitchToApi: hasExternalData,
    };
  }
  if (quotaSource === null) {
    return { primaryLabel: 'No configurado', showExternalLine: false, canSwitchToApi: true };
  }
  return { primaryLabel: quotaSource, showExternalLine: false, canSwitchToApi: false };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useApiQuotaAsPrimary — transición de estado', () => {
  const manualState: ProviderState = {
    providerKey: 'tavily',
    quotaSource: 'manual',
    quotaOverrideManual: true,
    monthlyCreditsAllowance: 500,
    monthlyUsdAllowance: null,
    creditsRemainingExternal: 945,
    usdCostMtd: 0.44,
    quotaSyncedAt: '2026-07-01T18:00:00Z',
    quotaSyncError: null,
  };

  it('1A — sync success: quota_override_manual queda false', () => {
    const { newState, success } = applyUseApiQuota(manualState, {
      ok: true,
      planLimitCredits: 1000,
      creditsRemaining: 945,
      usdCostMtd: 0.44,
    });
    assert.equal(success, true);
    assert.equal(newState.quotaOverrideManual, false);
  });

  it('1B — sync success: quota_source = api_synced', () => {
    const { newState } = applyUseApiQuota(manualState, {
      ok: true,
      planLimitCredits: 1000,
      creditsRemaining: 945,
    });
    assert.equal(newState.quotaSource, 'api_synced');
  });

  it('1C — sync success: monthly_credits_allowance actualizado desde API', () => {
    const { newState } = applyUseApiQuota(manualState, {
      ok: true,
      planLimitCredits: 1000,
      creditsRemaining: 945,
    });
    assert.equal(newState.monthlyCreditsAllowance, 1000);
  });

  it('1D — sync success: credits_remaining_external actualizado', () => {
    const { newState } = applyUseApiQuota(manualState, {
      ok: true,
      planLimitCredits: 1000,
      creditsRemaining: 945,
    });
    assert.equal(newState.creditsRemainingExternal, 945);
  });

  it('2A — sync falla: quota_override_manual permanece true', () => {
    const { newState, success } = applyUseApiQuota(manualState, {
      ok: false,
      error: 'API timeout',
    });
    assert.equal(success, false);
    assert.equal(newState.quotaOverrideManual, true);
  });

  it('2B — sync falla: quota_source sigue manual', () => {
    const { newState } = applyUseApiQuota(manualState, {
      ok: false,
      error: 'API timeout',
    });
    assert.equal(newState.quotaSource, 'manual');
  });

  it('2C — sync falla: monthly_credits_allowance manual no se pierde', () => {
    const { newState } = applyUseApiQuota(manualState, {
      ok: false,
      error: 'API timeout',
    });
    assert.equal(newState.monthlyCreditsAllowance, 500);
  });

  it('2D — sync falla: error message registrado', () => {
    const { newState } = applyUseApiQuota(manualState, {
      ok: false,
      error: 'API timeout',
    });
    assert.equal(newState.quotaSyncError, 'API timeout');
  });
});

describe('updateProviderAllowance — volver a manual desde api_synced', () => {
  const apiSyncedState: ProviderState = {
    providerKey: 'tavily',
    quotaSource: 'api_synced',
    quotaOverrideManual: false,
    monthlyCreditsAllowance: 1000,
    monthlyUsdAllowance: null,
    creditsRemainingExternal: 945,
    usdCostMtd: 0.44,
    quotaSyncedAt: '2026-07-01T18:00:00Z',
    quotaSyncError: null,
  };

  it('3A — guardar manual: quota_source = manual', () => {
    const newState = applyManualSave(apiSyncedState, 800, null);
    assert.equal(newState.quotaSource, 'manual');
  });

  it('3B — guardar manual: quota_override_manual = true', () => {
    const newState = applyManualSave(apiSyncedState, 800, null);
    assert.equal(newState.quotaOverrideManual, true);
  });

  it('3C — guardar manual: credits_remaining_external conservado como referencia', () => {
    const newState = applyManualSave(apiSyncedState, 800, null);
    assert.equal(newState.creditsRemainingExternal, 945);
  });

  it('3D — guardar manual: usd_cost_mtd conservado como referencia', () => {
    const newState = applyManualSave(apiSyncedState, 800, null);
    assert.equal(newState.usdCostMtd, 0.44);
  });

  it('3E — guardar manual: quota_synced_at conservado como referencia', () => {
    const newState = applyManualSave(apiSyncedState, 800, null);
    assert.equal(newState.quotaSyncedAt, '2026-07-01T18:00:00Z');
  });

  it('3F — limpiar (null/null): quota_source = null, override = false', () => {
    const newState = applyManualSave(apiSyncedState, null, null);
    assert.equal(newState.quotaSource, null);
    assert.equal(newState.quotaOverrideManual, false);
  });
});

describe('deriveQuotaSourceLabel — UI display helpers', () => {
  it('4A — api_synced se muestra como fuente principal sin línea externa', () => {
    const result = deriveQuotaSourceLabel('api_synced', false, 945, '2026-07-01T18:00:00Z');
    assert.equal(result.primaryLabel, 'API synced');
    assert.equal(result.showExternalLine, false);
    assert.equal(result.canSwitchToApi, false);
  });

  it('4B — manual + external: se muestra como manual principal con API referencia', () => {
    const result = deriveQuotaSourceLabel('manual', true, 945, '2026-07-01T18:00:00Z');
    assert.equal(result.primaryLabel, 'Manual');
    assert.equal(result.showExternalLine, true);
    assert.equal(result.canSwitchToApi, true);
  });

  it('4C — manual sin dato externo: no se muestra línea API', () => {
    const result = deriveQuotaSourceLabel('manual', true, null, null);
    assert.equal(result.primaryLabel, 'Manual');
    assert.equal(result.showExternalLine, false);
    assert.equal(result.canSwitchToApi, false);
  });

  it('4D — no configurado + syncable: puede usar API', () => {
    const result = deriveQuotaSourceLabel(null, false, null, null);
    assert.equal(result.primaryLabel, 'No configurado');
    assert.equal(result.canSwitchToApi, true);
  });

  it('4E — api_synced sin override: no puede cambiar a API (ya está en API)', () => {
    const result = deriveQuotaSourceLabel('api_synced', false, 945, '2026-07-01T18:00:00Z');
    assert.equal(result.canSwitchToApi, false);
  });
});
