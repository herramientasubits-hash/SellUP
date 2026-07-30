/**
 * Tests UI — /ai-usage: tarjeta de SUPRESIONES NO EVALUABLES
 * (Agente 2A · APOLLO-PHONE-CACHE-1b, FIX 5)
 *
 * La tarjeta es la única superficie donde Producto/Admin puede ver si aparecen
 * casos `not_evaluable_*`. Lo que se verifica aquí:
 *
 *   * el estado VACÍO se renderiza (ceros + "Sin eventos"), no una tarjeta muda;
 *   * los conteos agregados se muestran por ventana, fase y motivo;
 *   * `null` (sin permisos) NO se presenta como cero — son afirmaciones distintas;
 *   * el DOM no contiene PII: ni teléfono, ni email, ni nombre, ni LinkedIn, ni
 *     person id, ni candidato/cuenta.
 *
 * Render real de React (jsdom + @testing-library/react). No toca el servidor, no
 * llama proveedores, no lee DB: el módulo de consulta está mockeado para que
 * importar la tarjeta no arrastre el cliente de Supabase.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que los tests UI de CACHE-1b) ───────────────

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

defineGlobal('window', dom.window);
defineGlobal('document', dom.window.document);
defineGlobal('navigator', dom.window.navigator);
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function copyWindowPropsToGlobal(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  const source = dom.window as unknown as Record<string, unknown>;
  for (const prop of Object.getOwnPropertyNames(dom.window)) {
    if (prop in target) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, prop);
    if (descriptor) Object.defineProperty(target, prop, descriptor);
  }
}

copyWindowPropsToGlobal();

// ── Imports dependientes del entorno DOM ──────────────────────────────────────

import * as React from 'react';
import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { PhoneSuppressionNotEvaluableSummary } from '@/modules/contact-enrichment/phone-suppression-monitoring-core';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// El módulo de consulta es server-only (cliente service-role + gate de rol). La
// tarjeta de presentación no lo usa, pero vive en el mismo archivo que el panel
// asíncrono, así que se mockea el boundary para poder importarla en node.
mock.module('@/modules/contact-enrichment/phone-suppression-monitoring-queries', {
  namedExports: {
    getPhoneSuppressionNotEvaluableSummary: async () => null,
  },
});

let PhoneSuppressionNotEvaluableCard: (typeof import('../phone-suppression-monitoring-card'))['PhoneSuppressionNotEvaluableCard'];

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeSummary(
  overrides: Partial<PhoneSuppressionNotEvaluableSummary> = {},
): PhoneSuppressionNotEvaluableSummary {
  return {
    total_24h: 0,
    total_7d: 0,
    by_phase_7d: { start: 0, webhook: 0, recovery: 0 },
    by_state_7d: {
      not_evaluable_missing_provider_person_id: 0,
      not_evaluable_missing_account_id: 0,
    },
    unclassified_phase_7d: 0,
    last_seen_at: null,
    read_truncated: false,
    ...overrides,
  };
}

const CARD_TITLE = 'Supresiones no evaluables';

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ PhoneSuppressionNotEvaluableCard } = await import(
    '../phone-suppression-monitoring-card'
  ));
});

afterEach(() => {
  cleanup();
});

after(() => {
  cleanup();
});

// ── Estado vacío ─────────────────────────────────────────────────────────────

describe('FIX 5 UI — estado vacío', () => {
  it('renderiza el título y la nota de método', () => {
    render(<PhoneSuppressionNotEvaluableCard summary={makeSummary()} />);

    assert.ok(screen.getByText(CARD_TITLE));
    assert.ok(
      screen.getByText(
        /no pudo verificar tombstone porque faltaba Apollo person id o account id/i,
      ),
    );
    assert.ok(
      screen.getByText(/No se usa matching por nombre\/email\/teléfono/i),
      'la tarjeta debe declarar que no hay matching difuso',
    );
  });

  it('sin eventos muestra ceros y "Sin eventos" como último evento', () => {
    render(<PhoneSuppressionNotEvaluableCard summary={makeSummary()} />);

    assert.ok(screen.getByText('Últimas 24 h'));
    assert.ok(screen.getByText('Últimos 7 días'));
    assert.ok(screen.getByText('Sin eventos'));
    // Siete cifras en cero: 24 h, 7 d, tres fases y dos motivos. La octava
    // casilla es el último evento, que es una fecha, no un conteo.
    assert.equal(screen.getAllByText('0').length, 7);
  });

  it('no muestra el aviso de truncamiento ni el de fase desconocida', () => {
    render(<PhoneSuppressionNotEvaluableCard summary={makeSummary()} />);

    assert.equal(screen.queryByText(/alcanzó el tope de filas/i), null);
    assert.equal(screen.queryByText(/sin fase reconocible/i), null);
  });
});

// ── Conteos agregados ────────────────────────────────────────────────────────

describe('FIX 5 UI — conteos agregados', () => {
  it('muestra las ventanas, el desglose por fase y el motivo', () => {
    render(
      <PhoneSuppressionNotEvaluableCard
        summary={makeSummary({
          total_24h: 3,
          total_7d: 11,
          by_phase_7d: { start: 7, webhook: 2, recovery: 1 },
          by_state_7d: {
            not_evaluable_missing_provider_person_id: 9,
            not_evaluable_missing_account_id: 2,
          },
          unclassified_phase_7d: 1,
          last_seen_at: '2026-07-29T10:30:00.000Z',
        })}
      />,
    );

    assert.ok(screen.getByText('3'), 'total 24 h');
    assert.ok(screen.getByText('11'), 'total 7 d');
    assert.ok(screen.getByText('7'), 'fase start');
    assert.ok(screen.getByText('9'), 'sin person id');
    assert.ok(screen.getByText('Fase webhook (7 d)'));
    assert.ok(screen.getByText('Fase recovery (7 d)'));
    assert.ok(screen.getByText('Sin Apollo person id'));
    assert.ok(screen.getByText('Sin account id'));
    assert.ok(screen.getByText(/sin fase reconocible/i));
  });

  it('declara cuando la lectura quedó truncada', () => {
    render(
      <PhoneSuppressionNotEvaluableCard
        summary={makeSummary({ total_7d: 1000, read_truncated: true })}
      />,
    );

    assert.ok(screen.getByText(/alcanzó el tope de filas/i));
    assert.ok(screen.getByText(/un mínimo, no el total/i));
  });
});

// ── Sin permisos ≠ cero ──────────────────────────────────────────────────────

describe('FIX 5 UI — sin permisos', () => {
  it('null muestra "sin permisos", nunca un cero', () => {
    render(<PhoneSuppressionNotEvaluableCard summary={null} />);

    assert.ok(screen.getByText(/Sin permisos para ver el monitoreo de supresiones/i));
    assert.equal(screen.queryByText('Últimas 24 h'), null);
    assert.equal(screen.queryAllByText('0').length, 0);
  });
});

// ── PII ──────────────────────────────────────────────────────────────────────

describe('FIX 5 UI — el DOM no contiene PII', () => {
  it('ni teléfono, ni email, ni nombre, ni LinkedIn, ni ids de persona', () => {
    const { container } = render(
      <PhoneSuppressionNotEvaluableCard
        summary={makeSummary({
          total_24h: 2,
          total_7d: 5,
          by_phase_7d: { start: 3, webhook: 1, recovery: 1 },
          by_state_7d: {
            not_evaluable_missing_provider_person_id: 4,
            not_evaluable_missing_account_id: 1,
          },
          last_seen_at: '2026-07-29T10:30:00.000Z',
        })}
      />,
    );

    const text = container.textContent ?? '';
    for (const banned of [
      '+57',
      '@',
      'linkedin',
      '0123456789abcdef01234567',
      'cand-',
      'acct-',
    ]) {
      assert.equal(
        text.toLowerCase().includes(banned.toLowerCase()),
        false,
        `el DOM no debe contener ${banned}`,
      );
    }
    // Ninguna secuencia con forma de teléfono (un ISO nunca encadena 7 dígitos).
    assert.equal(/\d{7,}/.test(text), false);
  });
});
