/**
 * Agente 2A — PARIDAD DE RESCATE, en la pantalla
 * (AGENT2A-POST-APPROVAL-RESCUE-PARITY).
 *
 * Render REAL de React (jsdom + @testing-library/react) del panel de rescate. Lo que se demuestra
 * aquí no se puede demostrar en el servidor: que las salidas APARECEN donde antes no había nada, y
 * que el primer clic de las dos que gastan Lusha NO gasta.
 *
 * Esa última propiedad es de dinero, no de estética: el panel pinta hasta tres botones en fila
 * sobre una ficha que el operador está usando a toda velocidad, y un clic accidental sobre
 * «Buscar en Lusha» reservaría créditos. Por eso el primer clic sólo descubre la confirmación —el
 * mismo reparto que el modal del candidato— y por eso se prueba contando llamadas.
 *
 * NO toca el servidor, NO llama proveedores, NO escribe en DB y NO revela teléfonos reales.
 * 0 créditos, 0 escrituras, 0 PII.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

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

for (const prop of Object.getOwnPropertyNames(dom.window)) {
  const target = globalThis as unknown as Record<string, unknown>;
  if (prop in target) continue;
  const d = Object.getOwnPropertyDescriptor(
    dom.window as unknown as Record<string, unknown>,
    prop,
  );
  if (d) Object.defineProperty(target, prop, d);
}

import * as React from 'react';
import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { OfficialContactRescueView } from '@/modules/contact-enrichment/post-approval-rescue-core';
import {
  RESCUE_CONFIRM_LABEL,
  RESCUE_LUSHA_LABEL,
  RESCUE_RECOVERY_LABEL,
  RESCUE_SEARCH_MORE_LABEL,
} from '../post-approval-rescue-copy';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];

const CONTACT_ID = '45959dfa-9607-406e-bcd0-bcb9e78b9d4c';

type Outcome = {
  ok: boolean;
  status: string;
  phoneProjected: boolean;
  projectionStatus: string | null;
  requiredMaxCredits: number | null;
  newDistinctPhoneCount: number;
};

const mockOptions = mock.fn<() => Promise<OfficialContactRescueView>>();
/** Las tres que EJECUTAN. Las dos de pago no pueden llamarse con un solo clic. */
const mockRecover = mock.fn<() => Promise<Outcome>>();
const mockLusha = mock.fn<() => Promise<Outcome>>();
const mockSearchMore = mock.fn<() => Promise<Outcome>>();

mock.module('@/modules/contact-enrichment/post-approval-reveal-actions', {
  namedExports: {
    getOfficialContactPhoneRescueOptionsAction: (...a: unknown[]) => mockOptions(...(a as [])),
    recoverOfficialContactPhoneRevealAction: (...a: unknown[]) => mockRecover(...(a as [])),
    continueOfficialContactPhoneRevealWithLushaAction: (...a: unknown[]) => mockLusha(...(a as [])),
    searchMoreOfficialContactPhonesAction: (...a: unknown[]) => mockSearchMore(...(a as [])),
  },
});

let OfficialContactRescuePanel: (typeof import('../post-approval-rescue-panel'))['OfficialContactRescuePanel'];

const viewOf = (over: Partial<OfficialContactRescueView> = {}): OfficialContactRescueView => ({
  recovery: { available: false },
  lushaContinuation: { available: false, maxCredits: null, requiresIdentitySearch: false },
  searchMore: { available: false, maxCredits: null },
  ...over,
});

const outcome = (over: Partial<Outcome> = {}): Outcome => ({
  ok: true,
  status: 'still_pending',
  phoneProjected: false,
  projectionStatus: null,
  requiredMaxCredits: null,
  newDistinctPhoneCount: 0,
  ...over,
});

let projectedCount = 0;

function mount(revealStateKey = 'reveal_in_flight') {
  return render(
    React.createElement(OfficialContactRescuePanel, {
      contactId: CONTACT_ID,
      revealStateKey,
      onPhoneProjected: () => {
        projectedCount += 1;
      },
    }),
  );
}

before(async () => {
  const rtl = await import('@testing-library/react');
  render = rtl.render;
  screen = rtl.screen;
  waitFor = rtl.waitFor;
  fireEvent = rtl.fireEvent;
  cleanup = rtl.cleanup;
  act = rtl.act;
  ({ OfficialContactRescuePanel } = await import('../post-approval-rescue-panel'));
});

beforeEach(() => {
  cleanup?.();
  mockOptions.mock.resetCalls();
  mockRecover.mock.resetCalls();
  mockLusha.mock.resetCalls();
  mockSearchMore.mock.resetCalls();
  projectedCount = 0;
  mockOptions.mock.mockImplementation(async () => viewOf());
  mockRecover.mock.mockImplementation(async () => outcome());
  mockLusha.mock.mockImplementation(async () => outcome({ status: 'completed' }));
  mockSearchMore.mock.mockImplementation(async () => outcome({ status: 'completed' }));
});

describe('panel de rescate — las salidas aparecen donde antes no había nada', () => {
  it('sin salidas no pinta nada: no se añade ruido a cada contacto', async () => {
    mount();
    await waitFor(() => assert.equal(mockOptions.mock.callCount(), 1));
    assert.equal(document.body.textContent, '');
  });

  it('EN VUELO ofrece «Revisar resultado ahora» — la salida del «se queda cargando»', async () => {
    mockOptions.mock.mockImplementation(async () => viewOf({ recovery: { available: true } }));
    mount();
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: new RegExp(RESCUE_RECOVERY_LABEL) })),
    );
    assert.match(document.body.textContent ?? '', /No inicia una revelación nueva/);
  });

  it('cerrado sin número ofrece Lusha, con el tope LEÍDO en el copy', async () => {
    mockOptions.mock.mockImplementation(async () =>
      viewOf({
        lushaContinuation: { available: true, maxCredits: 5, requiresIdentitySearch: false },
      }),
    );
    mount('reveal_terminal_no_phone');
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: new RegExp(RESCUE_LUSHA_LABEL) })),
    );
    assert.match(document.body.textContent ?? '', /hasta 5 créditos de Lusha/);
    assert.match(document.body.textContent ?? '', /No usa créditos de Apollo/);
  });

  it('«Buscar más números» aparece con su propio tope', async () => {
    mockOptions.mock.mockImplementation(async () =>
      viewOf({ searchMore: { available: true, maxCredits: 5 } }),
    );
    mount('phone_already_present');
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: new RegExp(RESCUE_SEARCH_MORE_LABEL) })),
    );
    assert.match(document.body.textContent ?? '', /números adicionales/);
  });
});

describe('panel de rescate — el primer clic de las de PAGO no gasta', () => {
  it('un clic en «Buscar en Lusha» NO llama al servidor: sólo pide confirmación', async () => {
    mockOptions.mock.mockImplementation(async () =>
      viewOf({
        lushaContinuation: { available: true, maxCredits: 5, requiresIdentitySearch: false },
      }),
    );
    mount('reveal_terminal_no_phone');
    const button = await waitFor(() =>
      screen.getByRole('button', { name: new RegExp(RESCUE_LUSHA_LABEL) }),
    );
    await act(async () => {
      fireEvent.click(button);
    });
    assert.equal(mockLusha.mock.callCount(), 0, 'el primer clic es GRATIS');
    assert.ok(screen.getByRole('button', { name: new RegExp(RESCUE_CONFIRM_LABEL) }));
  });

  it('sólo la CONFIRMACIÓN gasta, y una sola vez', async () => {
    mockOptions.mock.mockImplementation(async () =>
      viewOf({
        lushaContinuation: { available: true, maxCredits: 5, requiresIdentitySearch: false },
      }),
    );
    mount('reveal_terminal_no_phone');
    const button = await waitFor(() =>
      screen.getByRole('button', { name: new RegExp(RESCUE_LUSHA_LABEL) }),
    );
    await act(async () => {
      fireEvent.click(button);
    });
    const confirm = screen.getByRole('button', { name: new RegExp(RESCUE_CONFIRM_LABEL) });
    await act(async () => {
      fireEvent.click(confirm);
    });
    assert.equal(mockLusha.mock.callCount(), 1);
    assert.equal(mockRecover.mock.callCount(), 0);
    assert.equal(mockSearchMore.mock.callCount(), 0);
  });

  it('«Cancelar» retira la confirmación sin gastar', async () => {
    mockOptions.mock.mockImplementation(async () =>
      viewOf({ searchMore: { available: true, maxCredits: 5 } }),
    );
    mount('phone_already_present');
    const button = await waitFor(() =>
      screen.getByRole('button', { name: new RegExp(RESCUE_SEARCH_MORE_LABEL) }),
    );
    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }));
    });
    assert.equal(mockSearchMore.mock.callCount(), 0);
    assert.ok(screen.getByRole('button', { name: new RegExp(RESCUE_SEARCH_MORE_LABEL) }));
  });

  it('«Revisar resultado ahora» SÍ ejecuta al primer clic: es gratis por contrato', async () => {
    mockOptions.mock.mockImplementation(async () => viewOf({ recovery: { available: true } }));
    mount();
    const button = await waitFor(() =>
      screen.getByRole('button', { name: new RegExp(RESCUE_RECOVERY_LABEL) }),
    );
    await act(async () => {
      fireEvent.click(button);
    });
    assert.equal(mockRecover.mock.callCount(), 1);
    assert.equal(mockLusha.mock.callCount(), 0);
  });
});

describe('panel de rescate — cuando llega el número', () => {
  it('se avisa a la ficha UNA vez y se releen las salidas', async () => {
    mockOptions.mock.mockImplementation(async () => viewOf({ recovery: { available: true } }));
    mockRecover.mock.mockImplementation(async () =>
      outcome({ status: 'revealed', phoneProjected: true }),
    );
    mount();
    const button = await waitFor(() =>
      screen.getByRole('button', { name: new RegExp(RESCUE_RECOVERY_LABEL) }),
    );
    const optionsBefore = mockOptions.mock.callCount();
    await act(async () => {
      fireEvent.click(button);
    });
    assert.equal(projectedCount, 1);
    await waitFor(() => assert.ok(mockOptions.mock.callCount() > optionsBefore));
    assert.match(document.body.textContent ?? '', /Teléfono guardado en el contacto/);
  });

  it('un fallo NO deja la ficha sin salidas: se relee igual', async () => {
    mockOptions.mock.mockImplementation(async () => viewOf({ recovery: { available: true } }));
    mockRecover.mock.mockImplementation(async () => {
      throw new Error('boom');
    });
    mount();
    const button = await waitFor(() =>
      screen.getByRole('button', { name: new RegExp(RESCUE_RECOVERY_LABEL) }),
    );
    const before = mockOptions.mock.callCount();
    await act(async () => {
      fireEvent.click(button);
    });
    assert.match(document.body.textContent ?? '', /No fue posible completar la operación/);
    await waitFor(() => assert.ok(mockOptions.mock.callCount() > before));
  });

  it('si la LECTURA de salidas falla, el panel desaparece en silencio (fail-closed)', async () => {
    mockOptions.mock.mockImplementation(async () => {
      throw new Error('read failed');
    });
    mount();
    await waitFor(() => assert.equal(mockOptions.mock.callCount(), 1));
    assert.equal(document.body.textContent, '');
    assert.equal(mockLusha.mock.callCount(), 0);
  });
});
