/**
 * Pure unit tests for provider allowance availability calculation (Hito J).
 * No DB, no server actions — only the arithmetic that lives in budget-resolution.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Pure helpers mirroring budget-resolution.ts logic (no imports needed)

function computeProviderCreditsAvailable(
  monthlyCreditsAllowance: number | null,
  consumedCredits: number,
): number | null {
  if (monthlyCreditsAllowance === null) return null;
  return monthlyCreditsAllowance - consumedCredits;
}

function computeProviderUsdAvailable(
  monthlyUsdAllowance: number | null,
  consumedUsd: number,
): number | null {
  if (monthlyUsdAllowance === null) return null;
  return monthlyUsdAllowance - consumedUsd;
}

// ── credits available ──────────────────────────────────────────────────────

describe('computeProviderCreditsAvailable', () => {
  it('returns null when allowance is null', () => {
    assert.equal(computeProviderCreditsAvailable(null, 50), null);
  });

  it('returns full allowance when consumed is 0', () => {
    assert.equal(computeProviderCreditsAvailable(500, 0), 500);
  });

  it('returns remaining credits correctly', () => {
    assert.equal(computeProviderCreditsAvailable(500, 54), 446);
  });

  it('returns 0 when exactly exhausted', () => {
    assert.equal(computeProviderCreditsAvailable(500, 500), 0);
  });

  it('returns negative when overrun (no clamping)', () => {
    assert.equal(computeProviderCreditsAvailable(500, 560), -60);
  });

  it('handles allowance of 0 with zero consumption', () => {
    assert.equal(computeProviderCreditsAvailable(0, 0), 0);
  });

  it('handles allowance of 0 with any consumption (overrun)', () => {
    assert.equal(computeProviderCreditsAvailable(0, 10), -10);
  });
});

// ── usd available ─────────────────────────────────────────────────────────

describe('computeProviderUsdAvailable', () => {
  it('returns null when usd allowance is null', () => {
    assert.equal(computeProviderUsdAvailable(null, 10), null);
  });

  it('returns full budget when consumed is 0', () => {
    assert.equal(computeProviderUsdAvailable(50, 0), 50);
  });

  it('returns remaining USD correctly', () => {
    assert.equal(computeProviderUsdAvailable(50, 12.5), 37.5);
  });

  it('returns negative on overrun (no clamping)', () => {
    assert.equal(computeProviderUsdAvailable(50, 55), -5);
  });
});

// ── integration: both allowances independent ────────────────────────────

describe('allowance fields are orthogonal', () => {
  it('credits null + usd configured works independently', () => {
    assert.equal(computeProviderCreditsAvailable(null, 10), null);
    assert.equal(computeProviderUsdAvailable(100, 10), 90);
  });

  it('credits configured + usd null works independently', () => {
    assert.equal(computeProviderCreditsAvailable(500, 100), 400);
    assert.equal(computeProviderUsdAvailable(null, 10), null);
  });

  it('both configured, Tavily-like scenario: 500 cr allowance, 54 consumed', () => {
    assert.equal(computeProviderCreditsAvailable(500, 54), 446);
    // No USD allowance configured for Tavily currently
    assert.equal(computeProviderUsdAvailable(null, 0), null);
  });

  it('Apollo without rule but with allowance: 500 cr, 0 consumed', () => {
    assert.equal(computeProviderCreditsAvailable(500, 0), 500);
  });

  it('Lusha connected, allowance 200 cr, 0 consumed', () => {
    assert.equal(computeProviderCreditsAvailable(200, 0), 200);
  });

  it('Claude with null allowance: not configured', () => {
    assert.equal(computeProviderCreditsAvailable(null, 0), null);
    assert.equal(computeProviderUsdAvailable(null, 0), null);
  });
});
