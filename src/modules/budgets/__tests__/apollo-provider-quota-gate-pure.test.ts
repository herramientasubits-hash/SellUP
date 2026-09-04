/**
 * AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — pure unit tests for the
 * decision logic of `checkProviderQuotaAvailable` (budget-resolution.ts).
 *
 * Mirrors the pattern already used by provider-allowance-calc.test.ts: no DB,
 * no server actions — only the arithmetic/decision that the real function
 * wraps around `getActiveCatalogEntries` (tool_catalog) and
 * `resolveEffectiveConsumption` (provider_usage_logs + reservation snapshot).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── In-process re-implementation, mirrors checkProviderQuotaAvailable ────────

type CatalogEntry = {
  providerKey: string;
  monthlyCreditsAllowance: number | null;
  quotaSource: string | null;
  quotaOverrideManual: boolean;
  creditsRemainingExternal: number | null;
};

type Consumed = { credits: number; reservedCredits: number };

type QuotaAvailability = {
  allowed: boolean;
  providerCreditsAvailable: number | null;
};

function resolveProviderQuotaAvailability(
  entry: CatalogEntry | null,
  consumed: Consumed,
): QuotaAvailability {
  const isApiSyncedLive =
    entry?.quotaSource === 'api_synced' &&
    !entry.quotaOverrideManual &&
    entry.creditsRemainingExternal !== null;

  // No catalog entry, or no configured quota and no live external balance ⇒
  // nothing to enforce — same discipline as checkBudget's "no rule ⇒ allowed".
  if (!entry || (!isApiSyncedLive && entry.monthlyCreditsAllowance === null)) {
    return { allowed: true, providerCreditsAvailable: null };
  }

  const providerCreditsAvailable = isApiSyncedLive
    ? entry.creditsRemainingExternal!
    : entry.monthlyCreditsAllowance! - consumed.credits - consumed.reservedCredits;

  return { allowed: providerCreditsAvailable > 0, providerCreditsAvailable };
}

const NO_CONSUMPTION: Consumed = { credits: 0, reservedCredits: 0 };

function manualEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    providerKey: 'apollo',
    monthlyCreditsAllowance: 500,
    quotaSource: 'manual',
    quotaOverrideManual: false,
    creditsRemainingExternal: null,
    ...overrides,
  };
}

// ─── C — sin cuota configurada ⇒ NUNCA se inventa un límite ──────────────────

describe('checkProviderQuotaAvailable — sin budget_rule ni cuota configurada', () => {
  it('sin fila en tool_catalog ⇒ ilimitado, allowed = true', () => {
    const r = resolveProviderQuotaAvailability(null, NO_CONSUMPTION);
    assert.equal(r.allowed, true);
    assert.equal(r.providerCreditsAvailable, null, 'null = ilimitado, nunca un número inventado');
  });

  it('fila en tool_catalog pero monthly_credits_allowance = null (manual, sin configurar) ⇒ ilimitado', () => {
    const r = resolveProviderQuotaAvailability(
      manualEntry({ monthlyCreditsAllowance: null }),
      { credits: 999_999, reservedCredits: 0 },
    );
    assert.equal(r.allowed, true, 'un consumo enorme no bloquea cuando no hay cuota configurada');
    assert.equal(r.providerCreditsAvailable, null);
  });
});

// ─── A/B — cuota configurada (manual) ────────────────────────────────────────

describe('checkProviderQuotaAvailable — cuota manual configurada (tool_catalog.monthly_credits_allowance)', () => {
  it('A — con margen (500 asignados, 458 consumidos) ⇒ allowed = true, 42 disponibles', () => {
    const r = resolveProviderQuotaAvailability(manualEntry({ monthlyCreditsAllowance: 500 }), {
      credits: 458,
      reservedCredits: 0,
    });
    assert.equal(r.allowed, true);
    assert.equal(r.providerCreditsAvailable, 42);
  });

  it('B — exactamente agotada (500 asignados, 500 consumidos) ⇒ allowed = false, 0 disponibles', () => {
    const r = resolveProviderQuotaAvailability(manualEntry({ monthlyCreditsAllowance: 500 }), {
      credits: 500,
      reservedCredits: 0,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.providerCreditsAvailable, 0);
  });

  it('B — sobregastada (500 asignados, 560 consumidos) ⇒ allowed = false, negativo sin clamping', () => {
    const r = resolveProviderQuotaAvailability(manualEntry({ monthlyCreditsAllowance: 500 }), {
      credits: 560,
      reservedCredits: 0,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.providerCreditsAvailable, -60);
  });

  it('el crédito RESERVADO (en vuelo) también reduce lo disponible', () => {
    const r = resolveProviderQuotaAvailability(manualEntry({ monthlyCreditsAllowance: 500 }), {
      credits: 400,
      reservedCredits: 100,
    });
    assert.equal(r.allowed, false, '400 + 100 == 500: ya no queda margen');
    assert.equal(r.providerCreditsAvailable, 0);
  });
});

// ─── A/B — cuota sincronizada en vivo (api_synced) ────────────────────────────

describe('checkProviderQuotaAvailable — cuota sincronizada en vivo (quota_source = api_synced)', () => {
  it('A — el balance externo en vivo manda, no el cómputo por consumo local', () => {
    const r = resolveProviderQuotaAvailability(
      manualEntry({
        quotaSource: 'api_synced',
        quotaOverrideManual: false,
        creditsRemainingExternal: 6109,
        monthlyCreditsAllowance: 500, // discrepante a propósito: no debe usarse
      }),
      { credits: 10_000, reservedCredits: 0 }, // discrepante a propósito: no debe usarse
    );
    assert.equal(r.allowed, true);
    assert.equal(r.providerCreditsAvailable, 6109);
  });

  it('B — balance externo en 0 ⇒ bloqueado', () => {
    const r = resolveProviderQuotaAvailability(
      manualEntry({
        quotaSource: 'api_synced',
        quotaOverrideManual: false,
        creditsRemainingExternal: 0,
      }),
      NO_CONSUMPTION,
    );
    assert.equal(r.allowed, false);
    assert.equal(r.providerCreditsAvailable, 0);
  });

  it('override manual activo ⇒ ignora el balance externo y usa la cuota manual (mismo camino que "manual")', () => {
    const r = resolveProviderQuotaAvailability(
      manualEntry({
        quotaSource: 'api_synced',
        quotaOverrideManual: true,
        creditsRemainingExternal: 9999,
        monthlyCreditsAllowance: 10,
      }),
      { credits: 10, reservedCredits: 0 },
    );
    assert.equal(r.allowed, false, 'el override manual, no el balance externo, decide');
    assert.equal(r.providerCreditsAvailable, 0);
  });
});
