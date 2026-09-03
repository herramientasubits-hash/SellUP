/**
 * net-new-page-cursor.test.ts — el cursor de página por PLAN DE BÚSQUEDA.
 *
 * A1-APOLLO-NET-NEW-PAGINATION-V2.
 *
 * Suite PURA: sin red, sin Supabase, sin reloj.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS,
  isApolloPageConsumed,
  resolveApolloNextNetNewPage,
  summarizeApolloSearchPlanPageConsumption,
  withApolloSearchPlanPageConsumption,
  type ApolloPageConsumptionOutcome,
} from '../net-new-page-cursor';

const ABC = 'plan-abc';
const XYZ = 'plan-xyz';

/** Página entregada y cobrada: el desenlace normal de una página no vacía. */
function charged(page: number): ApolloPageConsumptionOutcome {
  return { page, status: 'success', billingState: 'charged' };
}

/** Página entregada VACÍA: bajo #380 son 0 créditos, pero está igual de recorrida. */
function emptyPage(page: number): ApolloPageConsumptionOutcome {
  return { page, status: 'success', billingState: 'not_charged' };
}

function indeterminate(page: number): ApolloPageConsumptionOutcome {
  return { page, status: 'indeterminate', billingState: 'unknown' };
}

/** Fallo ANTES del envío: Apollo nunca la vio y nunca la cobró. */
function neverSent(page: number): ApolloPageConsumptionOutcome {
  return { page, status: 'error', billingState: 'not_charged' };
}

function cursorsWith(entries: ReadonlyArray<[string, number]>) {
  return entries.reduce(
    (cursors, [fingerprint, page]) =>
      withApolloSearchPlanPageConsumption(cursors, {
        searchPlanFingerprint: fingerprint,
        lastConsumedPage: page,
      }),
    EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS,
  );
}

// ─── TEST A · mismo fingerprint, ronda 1 completa ─────────────────────────────

describe('A · mismo plan de búsqueda: la ronda siguiente arranca donde terminó la anterior', () => {
  test('páginas 1,2,3,4 consumidas ⇒ la siguiente es la 5', () => {
    const consumption = summarizeApolloSearchPlanPageConsumption(ABC, [
      charged(1),
      charged(2),
      charged(3),
      charged(4),
    ]);

    assert.deepEqual(consumption.consumedPages, [1, 2, 3, 4]);
    assert.equal(consumption.lastConsumedPage, 4);

    const cursors = withApolloSearchPlanPageConsumption(
      EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS,
      consumption,
    );
    assert.equal(resolveApolloNextNetNewPage(cursors, ABC), 5);
  });

  test('el cursor no retrocede aunque llegue un consumo más viejo', () => {
    const cursors = cursorsWith([
      [ABC, 4],
      [ABC, 2],
    ]);
    assert.equal(resolveApolloNextNetNewPage(cursors, ABC), 5);
  });

  test('incorporar consumo devuelve un mapa NUEVO; el anterior no se muta', () => {
    const before = cursorsWith([[ABC, 4]]);
    const after = withApolloSearchPlanPageConsumption(before, {
      searchPlanFingerprint: ABC,
      lastConsumedPage: 8,
    });
    assert.equal(resolveApolloNextNetNewPage(before, ABC), 5);
    assert.equal(resolveApolloNextNetNewPage(after, ABC), 9);
  });
});

// ─── TEST B · ronda 1 parcialmente ejecutada ──────────────────────────────────

describe('B · ronda 1 parcial: el cursor sigue exactamente donde se quedó', () => {
  test('páginas 1,2 consumidas ⇒ la siguiente es la 3', () => {
    const cursors = withApolloSearchPlanPageConsumption(
      EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS,
      summarizeApolloSearchPlanPageConsumption(ABC, [charged(1), charged(2)]),
    );
    assert.equal(resolveApolloNextNetNewPage(cursors, ABC), 3);
  });

  test('una sola página consumida ⇒ la siguiente es la 2 (el comportamiento previo)', () => {
    const cursors = withApolloSearchPlanPageConsumption(
      EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS,
      summarizeApolloSearchPlanPageConsumption(ABC, [charged(1)]),
    );
    assert.equal(resolveApolloNextNetNewPage(cursors, ABC), 2);
  });
});

// ─── TEST C · fingerprint distinto ────────────────────────────────────────────

describe('C · plan distinto: universo de paginación INDEPENDIENTE', () => {
  test('XYZ no hereda el cursor de ABC', () => {
    const cursors = cursorsWith([[ABC, 4]]);
    assert.equal(resolveApolloNextNetNewPage(cursors, ABC), 5);
    assert.equal(resolveApolloNextNetNewPage(cursors, XYZ), 1);
  });

  test('cada plan avanza por su cuenta', () => {
    const cursors = cursorsWith([
      [ABC, 4],
      [XYZ, 1],
    ]);
    assert.equal(resolveApolloNextNetNewPage(cursors, ABC), 5);
    assert.equal(resolveApolloNextNetNewPage(cursors, XYZ), 2);
  });

  test('sin plan conocido el cursor no adivina: devuelve 1', () => {
    const cursors = cursorsWith([[ABC, 4]]);
    assert.equal(resolveApolloNextNetNewPage(cursors, null), 1);
    assert.equal(resolveApolloNextNetNewPage(cursors, ''), 1);
  });
});

// ─── TEST D · fail-closed sobre páginas sin desenlace confirmado ──────────────

describe('D · una página indeterminada NO vuelve a estar disponible', () => {
  test('page 4 indeterminada cuenta como consumida', () => {
    assert.equal(isApolloPageConsumed(indeterminate(4)), true);
    const consumption = summarizeApolloSearchPlanPageConsumption(ABC, [
      charged(1),
      charged(2),
      charged(3),
      indeterminate(4),
    ]);
    assert.deepEqual(consumption.consumedPages, [1, 2, 3, 4]);
    assert.equal(consumption.lastConsumedPage, 4);
  });

  test('«todavía no aparece como charged» NO autoriza volver a pedirla', () => {
    // Exactamente el estado que deja un proceso muerto tras `beforeRequest`:
    // exposición de cobro sin desenlace. Se trata como consumida.
    assert.equal(
      isApolloPageConsumed({ page: 4, status: 'error', billingState: 'unknown' }),
      true,
    );
  });

  test('una página vacía está recorrida aunque no se haya cobrado', () => {
    assert.equal(isApolloPageConsumed(emptyPage(3)), true);
  });

  test('lo ÚNICO que queda disponible es la página que nunca salió ni se cobró', () => {
    assert.equal(isApolloPageConsumed(neverSent(4)), false);
    const consumption = summarizeApolloSearchPlanPageConsumption(ABC, [
      charged(1),
      charged(2),
      neverSent(3),
    ]);
    assert.deepEqual(consumption.consumedPages, [1, 2]);
    assert.equal(consumption.lastConsumedPage, 2);
  });

  test('una página `rate_limited` con cobro desconocido tampoco se libera', () => {
    assert.equal(
      isApolloPageConsumed({ page: 5, status: 'rate_limited', billingState: 'unknown' }),
      true,
    );
  });
});

// ─── TEST E · múltiples páginas por ronda, sin parche para «la 5» ─────────────

describe('E · la regla es general, no un caso especial de la página 5', () => {
  for (const [consumed, expected] of [
    [1, 2],
    [2, 3],
    [4, 5],
    [8, 9],
    [37, 38],
  ] as const) {
    test(`última consumida ${consumed} ⇒ siguiente ${expected}`, () => {
      assert.equal(resolveApolloNextNetNewPage(cursorsWith([[ABC, consumed]]), ABC), expected);
    });
  }

  test('dos rondas encadenadas: 1-4 y luego 5-8 ⇒ la tercera arrancaría en 9', () => {
    let cursors = withApolloSearchPlanPageConsumption(
      EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS,
      summarizeApolloSearchPlanPageConsumption(ABC, [1, 2, 3, 4].map(charged)),
    );
    assert.equal(resolveApolloNextNetNewPage(cursors, ABC), 5);

    cursors = withApolloSearchPlanPageConsumption(
      cursors,
      summarizeApolloSearchPlanPageConsumption(ABC, [5, 6, 7, 8].map(charged)),
    );
    assert.equal(resolveApolloNextNetNewPage(cursors, ABC), 9);
  });
});

// ─── TEST F · ninguna página consumida vuelve al planificador ─────────────────

describe('F · una página ya consumida no puede volver a entrar al plan de peticiones', () => {
  test('el rango que la ronda siguiente puede pedir no intersecta con el consumido', () => {
    const consumedByRound1 = [1, 2, 3, 4];
    const cursors = withApolloSearchPlanPageConsumption(
      EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS,
      summarizeApolloSearchPlanPageConsumption(ABC, consumedByRound1.map(charged)),
    );

    const start = resolveApolloNextNetNewPage(cursors, ABC);
    // El motor de paginación pide `start, start+1, …` dentro de su techo de páginas.
    const round2Pages = [start, start + 1, start + 2, start + 3];

    assert.deepEqual(round2Pages, [5, 6, 7, 8]);
    for (const page of round2Pages) {
      assert.ok(
        !consumedByRound1.includes(page),
        `la página ${page} ya se había consumido y no puede volver a pedirse`,
      );
    }
  });

  test('un consumo sin páginas no mueve el cursor', () => {
    const consumption = summarizeApolloSearchPlanPageConsumption(ABC, []);
    assert.equal(consumption.lastConsumedPage, null);
    const cursors = withApolloSearchPlanPageConsumption(
      EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS,
      consumption,
    );
    assert.equal(resolveApolloNextNetNewPage(cursors, ABC), 1);
  });

  test('los reintentos de la misma página colapsan: se cuentan páginas, no intentos', () => {
    const consumption = summarizeApolloSearchPlanPageConsumption(ABC, [
      charged(1),
      charged(1),
      charged(2),
    ]);
    assert.deepEqual(consumption.consumedPages, [1, 2]);
  });
});
