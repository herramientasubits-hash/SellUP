/**
 * Tests — núcleo puro de la sincronización del drawer con el estado persistido
 * (Agente 2A · AGENT2A-PHONE-REVEAL-UI-STATE-1)
 *
 * Verifica las dos reglas que gobiernan el arreglo, aisladas de React:
 *   1. cuándo hay que DESCARTAR el estado local temporal del reveal (§ 4.2), que
 *      es lo que impedía que «Apollo aún está procesando el resultado»
 *      sobreviviera a un resultado ya terminal en base;
 *   2. cuándo una señal de ventana (foco / visibilidad) puede disparar UNA
 *      lectura, sin degenerar en polling (§ 7).
 *
 * Sin I/O, sin proveedores, sin DOM: son funciones puras.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPhoneRevealInFlightStatus,
  shouldClearLocalPhoneRevealState,
  shouldRefreshOnWindowSignal,
  PHONE_REVEAL_IN_FLIGHT_STATUSES,
  PHONE_REVEAL_WINDOW_REFRESH_MIN_INTERVAL_MS,
  PHONE_REVEAL_LIVE_REFRESH_EXHAUSTED_COPY,
} from '../phone-reveal-drawer-sync-core';
import {
  PHONE_REVEAL_LIVE_REFRESH_IN_FLIGHT_STATUSES,
  PHONE_REVEAL_LIVE_REFRESH_COPY,
} from '../phone-reveal-live-refresh-core';

const TERMINAL_STATUSES = ['revealed', 'no_phone_found', 'error'] as const;

describe('UI-STATE-1 core — estados en vuelo', () => {
  it('reconoce exactamente requested y pending', () => {
    assert.equal(isPhoneRevealInFlightStatus('requested'), true);
    assert.equal(isPhoneRevealInFlightStatus('pending'), true);
  });

  it('ningún estado terminal cuenta como en vuelo', () => {
    for (const status of TERMINAL_STATUSES) {
      assert.equal(isPhoneRevealInFlightStatus(status), false, status);
    }
  });

  it('fail-closed ante ausencia o basura', () => {
    for (const value of [
      null,
      undefined,
      '',
      '  ',
      'REQUESTED',
      'not_requested',
      'desconocido',
      42,
      {},
    ]) {
      assert.equal(
        isPhoneRevealInFlightStatus(value as string | null | undefined),
        false,
        String(value),
      );
    }
  });

  it('la lista es la MISMA que la del refresco acotado', () => {
    // Las dos listas describen el mismo concepto en dos módulos que no se
    // importan entre sí (para conservar la pureza). Si alguien añade un estado en
    // vuelo a una y no a la otra, el drawer limpiaría un aviso que el refresco
    // sigue considerando vigente — este assert es el candado contra esa deriva.
    assert.deepEqual(
      [...PHONE_REVEAL_IN_FLIGHT_STATUSES],
      [...PHONE_REVEAL_LIVE_REFRESH_IN_FLIGHT_STATUSES],
    );
  });
});

describe('UI-STATE-1 core — limpieza del estado local', () => {
  it('NO limpia mientras el reveal sigue en vuelo', () => {
    assert.equal(shouldClearLocalPhoneRevealState('requested'), false);
    assert.equal(shouldClearLocalPhoneRevealState('pending'), false);
  });

  it('limpia en cualquier estado terminal', () => {
    for (const status of TERMINAL_STATUSES) {
      assert.equal(shouldClearLocalPhoneRevealState(status), true, status);
    }
  });

  it('limpia también sin estado y ante estados desconocidos', () => {
    // Se expresa como negación de "en vuelo": un estado nuevo limpia por defecto,
    // en vez de conservar un aviso de espera indefinidamente.
    for (const value of [null, undefined, 'not_requested', 'estado_futuro']) {
      assert.equal(
        shouldClearLocalPhoneRevealState(value as string | null | undefined),
        true,
        String(value),
      );
    }
  });
});

describe('UI-STATE-1 core — señal de ventana (§ 7)', () => {
  const base = { open: true, candidateId: 'cand-1', lastRefreshAtMs: null, nowMs: 1_000 };

  it('la primera señal siempre refresca', () => {
    assert.equal(shouldRefreshOnWindowSignal(base), true);
  });

  it('no refresca con el drawer cerrado', () => {
    assert.equal(shouldRefreshOnWindowSignal({ ...base, open: false }), false);
  });

  it('no refresca sin candidato', () => {
    assert.equal(shouldRefreshOnWindowSignal({ ...base, candidateId: null }), false);
  });

  it('debounce: dentro de la ventana mínima no refresca', () => {
    const last = 10_000;
    assert.equal(
      shouldRefreshOnWindowSignal({
        ...base,
        lastRefreshAtMs: last,
        nowMs: last + PHONE_REVEAL_WINDOW_REFRESH_MIN_INTERVAL_MS - 1,
      }),
      false,
    );
  });

  it('pasada la ventana mínima vuelve a refrescar', () => {
    const last = 10_000;
    assert.equal(
      shouldRefreshOnWindowSignal({
        ...base,
        lastRefreshAtMs: last,
        nowMs: last + PHONE_REVEAL_WINDOW_REFRESH_MIN_INTERVAL_MS,
      }),
      true,
    );
  });

  it('un reloj que retrocede no abre la puerta a una ráfaga', () => {
    assert.equal(
      shouldRefreshOnWindowSignal({ ...base, lastRefreshAtMs: 10_000, nowMs: 9_000 }),
      false,
    );
  });

  it('marcas de tiempo no finitas paran (fail-closed)', () => {
    assert.equal(shouldRefreshOnWindowSignal({ ...base, nowMs: Number.NaN }), false);
    assert.equal(
      shouldRefreshOnWindowSignal({ ...base, nowMs: Number.POSITIVE_INFINITY }),
      false,
    );
    assert.equal(
      shouldRefreshOnWindowSignal({ ...base, lastRefreshAtMs: Number.NaN }),
      false,
    );
  });

  it('la ventana mínima es positiva: nunca es polling libre', () => {
    assert.ok(PHONE_REVEAL_WINDOW_REFRESH_MIN_INTERVAL_MS > 0);
  });
});

describe('UI-STATE-1 core — copy de agotamiento (§ 5)', () => {
  it('es distinto del copy de refresco activo', () => {
    assert.notEqual(
      PHONE_REVEAL_LIVE_REFRESH_EXHAUSTED_COPY,
      PHONE_REVEAL_LIVE_REFRESH_COPY,
    );
  });

  it('dice que la actualización automática TERMINÓ', () => {
    assert.match(PHONE_REVEAL_LIVE_REFRESH_EXHAUSTED_COPY, /actualización automática terminó/i);
  });

  it('NO afirma que SellUp siga revisando', () => {
    // El copy honesto es el punto del § 5: prometer vigilancia que ya no existe
    // era el defecto original.
    assert.doesNotMatch(PHONE_REVEAL_LIVE_REFRESH_EXHAUSTED_COPY, /seguimos revisando/i);
    assert.doesNotMatch(PHONE_REVEAL_LIVE_REFRESH_EXHAUSTED_COPY, /Actualizando el estado/i);
  });

  it('ofrece las salidas reales al operador', () => {
    assert.match(PHONE_REVEAL_LIVE_REFRESH_EXHAUSTED_COPY, /Actualiza el estado/i);
    assert.match(PHONE_REVEAL_LIVE_REFRESH_EXHAUSTED_COPY, /vuelve a abrir/i);
  });
});
