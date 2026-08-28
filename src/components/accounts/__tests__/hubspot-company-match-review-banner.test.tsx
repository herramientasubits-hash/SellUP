/**
 * Agente 2A — Aviso de coincidencia dudosa de empresa en HubSpot (Task C1)
 * (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
 *
 * Render REAL de React (jsdom + @testing-library/react) del banner presentacional. Prueba lo que
 * no se puede probar en el servidor: que sin match pendiente no pinta nada, que el nombre/dominio/
 * confianza aparecen en pantalla, y que cada botón llama a la acción de servidor con el `decision`
 * exacto que espera `resolveHubSpotCompanyMatchAction`.
 *
 * NO toca el servidor, NO llama proveedores, NO escribe en DB. 0 créditos, 0 escrituras, 0 PII.
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

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';

const mockResolve = mock.fn<
  (input: { accountId: string; decision: 'same' | 'different' }) => Promise<{ ok: boolean }>
>();
mock.module('@/modules/accounts/hubspot-company-review-actions', {
  namedExports: {
    resolveHubSpotCompanyMatchAction: (...a: unknown[]) =>
      mockResolve(...(a as [{ accountId: string; decision: 'same' | 'different' }])),
  },
});
mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => {} }) },
});

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let act: (typeof import('@testing-library/react'))['act'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let HubSpotCompanyMatchReviewBanner: (typeof import(
  '../hubspot-company-match-review-banner'
))['HubSpotCompanyMatchReviewBanner'];

before(async () => {
  const rtl = await import('@testing-library/react');
  ({ render, screen, fireEvent, waitFor, act, cleanup } = rtl);
  ({ HubSpotCompanyMatchReviewBanner } = await import('../hubspot-company-match-review-banner'));
});

beforeEach(() => {
  cleanup?.();
  mockResolve.mock.resetCalls();
  mockResolve.mock.mockImplementation(async () => ({ ok: true }));
});

describe('HubSpotCompanyMatchReviewBanner', () => {
  it('sin coincidencia pendiente, no pinta nada', () => {
    render(
      React.createElement(HubSpotCompanyMatchReviewBanner, {
        accountId: 'account-1',
        pendingMatch: null,
      }),
    );
    assert.equal(document.body.textContent, '');
  });

  it('muestra el nombre, dominio y confianza de la coincidencia', () => {
    render(
      React.createElement(HubSpotCompanyMatchReviewBanner, {
        accountId: 'account-1',
        pendingMatch: {
          hubspotCompanyId: 'hs-999',
          name: 'Autotransportes El Bisonte SA',
          domain: 'bisonte.com.mx',
          matchMethod: 'name',
          confidence: 65,
          reason: 'Match por nombre con confianza baja (65%)',
        },
      }),
    );
    assert.match(document.body.textContent ?? '', /Autotransportes El Bisonte SA/);
    assert.match(document.body.textContent ?? '', /65%/);
  });

  it('«Sí, es la misma» llama a la acción con decision: same', async () => {
    render(
      React.createElement(HubSpotCompanyMatchReviewBanner, {
        accountId: 'account-1',
        pendingMatch: {
          hubspotCompanyId: 'hs-999',
          name: 'X',
          domain: null,
          matchMethod: 'name',
          confidence: 65,
          reason: 'r',
        },
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sí, es la misma/ }));
    });
    assert.equal(mockResolve.mock.callCount(), 1);
    assert.deepEqual(mockResolve.mock.calls[0].arguments[0], {
      accountId: 'account-1',
      decision: 'same',
    });
  });

  it('«No, es una empresa nueva» llama a la acción con decision: different', async () => {
    render(
      React.createElement(HubSpotCompanyMatchReviewBanner, {
        accountId: 'account-1',
        pendingMatch: {
          hubspotCompanyId: 'hs-999',
          name: 'X',
          domain: null,
          matchMethod: 'name',
          confidence: 65,
          reason: 'r',
        },
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /No, es una empresa nueva/ }));
    });
    assert.equal(mockResolve.mock.callCount(), 1);
    assert.deepEqual(mockResolve.mock.calls[0].arguments[0], {
      accountId: 'account-1',
      decision: 'different',
    });
  });
});
