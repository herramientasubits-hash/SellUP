/**
 * Tests — núcleo puro del refresco acotado del drawer
 * (Agente 2A · APOLLO-PHONE-REVEAL-LIVE-REFRESH-1)
 *
 * La política de arranque y de parada vive fuera de React para poder verificarla
 * sin render: qué estados justifican refrescar, y sobre todo CUÁNDO hay que dejar
 * de programar refetch. La garantía crítica es la terminación: la secuencia de
 * retardos es finita y su suma nunca supera el presupuesto.
 *
 * No toca red, ni DOM, ni proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isPhoneRevealLiveRefreshEligible,
  resolveNextLiveRefreshDelayMs,
  PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS,
  PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS,
  PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS,
  PHONE_REVEAL_LIVE_REFRESH_IN_FLIGHT_STATUSES,
} from '../phone-reveal-live-refresh-core';

// ═══════════════════════════════════════════════════════════════
// 1. Elegibilidad
// ═══════════════════════════════════════════════════════════════

describe('LIVE-REFRESH-1 — elegibilidad', () => {
  it('refresca mientras el reveal está en vuelo y no hay teléfono', () => {
    for (const status of PHONE_REVEAL_LIVE_REFRESH_IN_FLIGHT_STATUSES) {
      assert.equal(
        isPhoneRevealLiveRefreshEligible({
          phoneRevealStatus: status,
          hasPhone: false,
          busy: false,
        }),
        true,
        `status ${status}`,
      );
    }
  });

  it('NO refresca en ningún estado terminal', () => {
    for (const status of ['revealed', 'no_phone_found', 'error', 'not_requested']) {
      assert.equal(
        isPhoneRevealLiveRefreshEligible({
          phoneRevealStatus: status,
          hasPhone: false,
          busy: false,
        }),
        false,
        `status ${status}`,
      );
    }
  });

  it('NO refresca si el candidato ya tiene teléfono', () => {
    assert.equal(
      isPhoneRevealLiveRefreshEligible({
        phoneRevealStatus: 'requested',
        hasPhone: true,
        busy: false,
      }),
      false,
    );
  });

  it('NO refresca mientras hay una acción de aprobar/rechazar en curso', () => {
    assert.equal(
      isPhoneRevealLiveRefreshEligible({
        phoneRevealStatus: 'pending',
        hasPhone: false,
        busy: true,
      }),
      false,
    );
  });

  it('fail-closed ante estados ausentes o desconocidos', () => {
    for (const status of [null, undefined, '', 'requested ', 'REQUESTED', 'whatever']) {
      assert.equal(
        isPhoneRevealLiveRefreshEligible({
          phoneRevealStatus: status,
          hasPhone: false,
          busy: false,
        }),
        false,
        `status ${String(status)}`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Cadencia
// ═══════════════════════════════════════════════════════════════

describe('LIVE-REFRESH-1 — cadencia', () => {
  it('el primer refetch espera más que los siguientes', () => {
    assert.equal(
      resolveNextLiveRefreshDelayMs(0, 0),
      PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS,
    );
    assert.equal(
      resolveNextLiveRefreshDelayMs(1, PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS),
      PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS,
    );
  });

  it('la cadencia nunca es agresiva (≥ 5 s entre refetch)', () => {
    assert.ok(PHONE_REVEAL_LIVE_REFRESH_FIRST_DELAY_MS >= 5_000);
    assert.ok(PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS >= 5_000);
  });

  it('para cuando el siguiente refetch se saldría del presupuesto', () => {
    assert.equal(
      resolveNextLiveRefreshDelayMs(5, PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS),
      null,
    );
    assert.equal(
      resolveNextLiveRefreshDelayMs(
        5,
        PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS -
          PHONE_REVEAL_LIVE_REFRESH_INTERVAL_MS +
          1,
      ),
      null,
    );
  });

  it('fail-closed ante entradas inválidas', () => {
    assert.equal(resolveNextLiveRefreshDelayMs(-1, 0), null);
    assert.equal(resolveNextLiveRefreshDelayMs(0, -1), null);
    assert.equal(resolveNextLiveRefreshDelayMs(Number.NaN, 0), null);
    assert.equal(resolveNextLiveRefreshDelayMs(0, Number.POSITIVE_INFINITY), null);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Terminación (la garantía crítica)
// ═══════════════════════════════════════════════════════════════

describe('LIVE-REFRESH-1 — terminación', () => {
  it('la secuencia completa es finita y cabe en el presupuesto', () => {
    let attempt = 0;
    let elapsedMs = 0;
    const delays: number[] = [];
    // Cota MUY por encima de lo esperado: si el núcleo no terminara, este bucle
    // se dispararía en vez de colgar el test.
    while (attempt < 10_000) {
      const delay = resolveNextLiveRefreshDelayMs(attempt, elapsedMs);
      if (delay === null) break;
      delays.push(delay);
      elapsedMs += delay;
      attempt += 1;
    }
    assert.ok(delays.length > 0, 'debe programar al menos un refetch');
    assert.ok(delays.length < 10_000, 'la secuencia no puede ser infinita');
    assert.ok(
      elapsedMs <= PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS,
      `la duración total (${elapsedMs} ms) excede el presupuesto`,
    );
    assert.equal(
      resolveNextLiveRefreshDelayMs(delays.length, elapsedMs),
      null,
      'una vez agotado, no vuelve a programar',
    );
  });

  it('el presupuesto se mantiene dentro del rango acordado (60–90 s)', () => {
    assert.ok(PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS >= 60_000);
    assert.ok(PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS <= 90_000);
  });
});
