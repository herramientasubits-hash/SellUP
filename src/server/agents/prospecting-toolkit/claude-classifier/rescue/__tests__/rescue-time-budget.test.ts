/**
 * Tests — el rescate en segundo plano no se pasa del límite de Vercel.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeBackgroundRescueDeadlineMs,
  RESCUE_IN_FLIGHT_MARGIN_MS,
  RESCUE_MAX_WINDOW_MS,
  VERCEL_FUNCTION_LIMIT_MS,
} from '../rescue-time-budget';

describe('computeBackgroundRescueDeadlineMs', () => {
  it('búsqueda rápida → usa el tope propio del rescate', () => {
    assert.equal(computeBackgroundRescueDeadlineMs(0, 5_000), RESCUE_MAX_WINDOW_MS);
  });

  it('búsqueda de 150 s → deja margen para que terminen las empresas en curso', () => {
    assert.equal(
      computeBackgroundRescueDeadlineMs(0, 150_000),
      VERCEL_FUNCTION_LIMIT_MS - RESCUE_IN_FLIGHT_MARGIN_MS - 150_000,
    );
  });

  it('búsqueda que casi agotó los 300 s → no empieza nada', () => {
    assert.equal(computeBackgroundRescueDeadlineMs(0, 200_000), null);
    assert.equal(computeBackgroundRescueDeadlineMs(0, 290_000), null);
  });

  it('nunca pasa del límite de la función', () => {
    for (const elapsed of [0, 30_000, 60_000, 100_000, 180_000]) {
      const window = computeBackgroundRescueDeadlineMs(0, elapsed);
      if (window !== null) assert.ok(elapsed + window + RESCUE_IN_FLIGHT_MARGIN_MS <= VERCEL_FUNCTION_LIMIT_MS);
    }
  });
});
