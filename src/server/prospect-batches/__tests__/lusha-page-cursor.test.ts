/**
 * AGENT1-LUSHA-PAGE-CURSOR-1 — por qué página empieza cada rama.
 *
 * Lo que estas pruebas fijan, dicho como defecto: cada corrida de Lusha arranca
 * en la página 0, que para la misma búsqueda devuelve SIEMPRE las mismas
 * empresas. El 2026-09-24 la página 0 venía ya vista en un 92-100%, y en 4
 * créditos de páginas 0 salió 1 útil frente a 10 útiles en 4 créditos de páginas
 * 1. Peor: la firma `ba24968a63` (CO × Tecnología) pagó las páginas 0 y 1 el
 * 22-09, y la pierna de la cascada del 23-09 volvió a pagar la página 0.
 *
 * El cursor NO pide más páginas ni gasta más: elige QUÉ páginas, con el mismo
 * número por corrida.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX,
  resolveLushaBranchStartPages,
  type LushaPageHistoryRow,
} from '../lusha-page-cursor';

const PAGE_SIZE = 25;
const PAGES_PER_RUN = 2;

function row(
  branchIndex: number,
  pageIndex: number,
  state = 'succeeded',
  resultsReturned: number | null = 25,
): LushaPageHistoryRow {
  return { branchIndex, pageIndex, state, resultsReturned };
}

function resolve(history: LushaPageHistoryRow[], branchCount = 1) {
  return resolveLushaBranchStartPages({
    branchCount,
    history,
    pageSize: PAGE_SIZE,
    pagesPerRun: PAGES_PER_RUN,
  });
}

describe('§ 1 — la página siguiente a la última pagada', () => {
  it('sin historial ⇒ página 0', () => {
    assert.deepEqual(resolve([])[0], {
      branchIndex: 0,
      startPage: 0,
      reason: 'no_history',
      lastConsumedPage: null,
      consumedPages: 0,
    });
  });

  it('🔴 el caso del 22/23-09: pagadas 0 y 1 ⇒ la siguiente corrida empieza en la 2', () => {
    const [d] = resolve([row(0, 0), row(0, 1)]);
    assert.equal(d!.startPage, 2);
    assert.equal(d!.reason, 'next_unconsumed_page');
    assert.equal(d!.lastConsumedPage, 1);
  });

  it('la misma página pagada varias veces cuenta una vez', () => {
    const [d] = resolve([row(0, 0), row(0, 1), row(0, 0)]);
    assert.equal(d!.startPage, 2);
    assert.equal(d!.consumedPages, 2);
  });

  it('cada rama tiene su propio cursor', () => {
    const decisions = resolve([row(0, 0), row(0, 1), row(1, 0)], 2);
    assert.deepEqual(
      decisions.map((d) => [d.branchIndex, d.startPage]),
      [
        [0, 2],
        [1, 1],
      ],
    );
  });

  it('una rama sin historial empieza en 0 aunque otra tenga', () => {
    const decisions = resolve([row(0, 0), row(0, 1)], 3);
    assert.deepEqual(
      decisions.map((d) => d.startPage),
      [2, 0, 0],
    );
  });
});

describe('§ 2 — lo que cuenta como «ya pagada»', () => {
  it('🔴 una página que PUDO cobrarse cuenta como pagada: ante la duda, no se vuelve a pedir', () => {
    for (const state of ['indeterminate', 'unknown', 'dispatch_unsafe']) {
      const [d] = resolve([row(0, 0), row(0, 1, state, null)]);
      assert.equal(d!.startPage, 2, state);
    }
  });

  it('una página que seguro NO se cobró o nunca salió no cuenta', () => {
    for (const state of ['definitely_not_charged', 'prepared']) {
      const [d] = resolve([row(0, 0), row(0, 1, state, null)]);
      assert.equal(d!.startPage, 1, state);
    }
  });

  it('un estado desconocido para el cursor se trata como pagada (dirección que protege el dinero)', () => {
    const [d] = resolve([row(0, 0, 'estado_nuevo', null)]);
    assert.equal(d!.startPage, 1);
  });
});

describe('§ 3 — fin del universo y tope', () => {
  it('🔴 la última página vino INCOMPLETA ⇒ se acabó el universo ⇒ vuelta a la 0', () => {
    const [d] = resolve([row(0, 0), row(0, 1, 'succeeded', 12)]);
    assert.equal(d!.startPage, 0);
    assert.equal(d!.reason, 'universe_exhausted_restart');
  });

  it('la última página VACÍA también cierra el universo', () => {
    const [d] = resolve([row(0, 0), row(0, 1), row(0, 2, 'succeeded', 0)]);
    assert.equal(d!.startPage, 0);
    assert.equal(d!.reason, 'universe_exhausted_restart');
  });

  it('una página intermedia incompleta no cierra nada si después hubo más llenas', () => {
    const [d] = resolve([row(0, 0, 'succeeded', 10), row(0, 1), row(0, 2)]);
    assert.equal(d!.startPage, 3);
  });

  it('un resultado incierto (`null`) en la última no se lee como fin', () => {
    const [d] = resolve([row(0, 0), row(0, 1, 'indeterminate', null)]);
    assert.equal(d!.reason, 'next_unconsumed_page');
  });

  it(`🔴 no se pasa del tope de página ${LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX}: vuelta a la 0`, () => {
    const history = Array.from({ length: LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX }, (_, p) => row(0, p));
    const [d] = resolve(history);
    assert.equal(d!.startPage, 0);
    assert.equal(d!.reason, 'cap_restart');
  });

  it('justo en el tope la corrida cabe entera', () => {
    const lastAllowedStart = LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX - PAGES_PER_RUN + 1;
    const history = Array.from({ length: lastAllowedStart }, (_, p) => row(0, p));
    const [d] = resolve(history);
    assert.equal(d!.startPage, lastAllowedStart);
    assert.equal(d!.reason, 'next_unconsumed_page');
  });
});

describe('§ 4 — datos de la base no confiables', () => {
  it('filas con rama o página inválidas se ignoran', () => {
    const [d] = resolve([
      row(0, 0),
      { branchIndex: -1, pageIndex: 5, state: 'succeeded', resultsReturned: 25 },
      { branchIndex: 0, pageIndex: Number.NaN, state: 'succeeded', resultsReturned: 25 },
      { branchIndex: 0, pageIndex: 2.5, state: 'succeeded', resultsReturned: 25 },
    ]);
    assert.equal(d!.startPage, 1);
  });

  it('filas de ramas que el plan ya no tiene no afectan a las que sí', () => {
    const decisions = resolve([row(5, 3)], 1);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]!.startPage, 0);
  });

  it('sin ramas no hay decisiones', () => {
    assert.deepEqual(resolve([row(0, 0)], 0), []);
  });
});

describe('§ 5 — el historial más reciente manda', () => {
  it('si la misma página volvió incompleta en una corrida posterior, el universo se encogió', () => {
    const [d] = resolve([row(0, 0), row(0, 1), row(0, 1, 'succeeded', 8)]);
    assert.equal(d!.reason, 'universe_exhausted_restart');
  });

  it('un conteo incierto posterior no borra uno conocido', () => {
    const [d] = resolve([row(0, 0), row(0, 1, 'succeeded', 25), row(0, 1, 'indeterminate', null)]);
    assert.equal(d!.startPage, 2);
  });
});
