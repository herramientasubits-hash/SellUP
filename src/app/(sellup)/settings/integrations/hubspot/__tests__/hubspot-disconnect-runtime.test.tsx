/**
 * HubSpot — «Desconectar» — contrato RUNTIME.
 *
 * Lo que se protege:
 *   - 🔴 abrir el diálogo NO desconecta;
 *   - 🔴 cancelar NO desconecta;
 *   - 🔴 solo confirmar llama a la acción de servidor, una vez, y refresca;
 *   - si la acción falla, el motivo se ve dentro del diálogo y este sigue abierto.
 *
 * Sin red ni base de datos: la acción de servidor está sustituida por un espía.
 */

import '../../../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let HubSpotActionsPanel: (typeof import('../hubspot-actions-client'))['HubSpotActionsPanel'];
let HubSpotDisconnectDialog: (typeof import('../hubspot-actions-client'))['HubSpotDisconnectDialog'];

const h = React.createElement;

const calls: string[] = [];
let refreshCount = 0;

const spy = (name: string) => async () => {
  calls.push(name);
  return { success: true };
};

// Especificador RELATIVO: con los hooks ESM de CI, `mock.module('@/…')` falla.
mock.module('../../../../../../modules/integrations/actions', {
  namedExports: {
    connectHubSpot: spy('connectHubSpot'),
    updateHubSpotCredential: spy('updateHubSpotCredential'),
    testHubSpotConnectionAction: spy('testHubSpotConnectionAction'),
    disconnectHubSpot: spy('disconnectHubSpot'),
  },
});

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({
      push: () => {},
      replace: () => {},
      prefetch: () => {},
      refresh: () => {
        refreshCount += 1;
      },
    }),
    usePathname: () => '/settings/integrations/hubspot',
  },
});

function dialog(): HTMLElement | null {
  return screen.queryByRole('alertdialog', { hidden: true });
}

function buttonIn(container: HTMLElement, name: string): HTMLElement {
  const match = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === name,
  );
  assert.ok(match, `no hay botón «${name}» en el diálogo`);
  return match;
}

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ HubSpotActionsPanel, HubSpotDisconnectDialog } = await import('../hubspot-actions-client'));
});

beforeEach(() => {
  calls.length = 0;
  refreshCount = 0;
});

afterEach(() => {
  cleanup();
});

describe('HubSpot — Desconectar desde el panel de acciones', () => {
  it('sin credencial no ofrece desconectar', () => {
    render(h(HubSpotActionsPanel, { hasCredential: false }));

    assert.ok(screen.getByRole('button', { name: 'Conectar HubSpot' }));
    assert.equal(screen.queryByRole('button', { name: 'Desconectar' }), null);
  });

  it('abrir el diálogo no llama a la acción', async () => {
    render(h(HubSpotActionsPanel, { hasCredential: true }));
    assert.equal(dialog(), null);

    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));

    await waitFor(() => assert.ok(dialog()));
    assert.ok(screen.getByText('Desconectar HubSpot'));
    assert.deepEqual(calls, []);
    assert.equal(refreshCount, 0);
  });

  it('cancelar cierra el diálogo sin llamar a la acción', async () => {
    render(h(HubSpotActionsPanel, { hasCredential: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
    await waitFor(() => assert.ok(dialog()));

    fireEvent.click(buttonIn(dialog()!, 'Cancelar'));

    await waitFor(() => assert.equal(dialog(), null));
    assert.deepEqual(calls, []);
    assert.equal(refreshCount, 0);
  });

  it('confirmar llama a disconnectHubSpot una sola vez, cierra y refresca', async () => {
    render(h(HubSpotActionsPanel, { hasCredential: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
    await waitFor(() => assert.ok(dialog()));

    fireEvent.click(buttonIn(dialog()!, 'Desconectar'));

    await waitFor(() => assert.deepEqual(calls, ['disconnectHubSpot']));
    await waitFor(() => assert.equal(dialog(), null));
    assert.equal(refreshCount, 1);
  });
});

describe('HubSpot — Desconectar cuando la acción falla', () => {
  it('muestra el motivo dentro del diálogo, no refresca y deja reintentar', async () => {
    const attempts: number[] = [];
    const failing = async () => {
      attempts.push(attempts.length + 1);
      return { success: false, error: 'HubSpot no respondió.' };
    };
    const openChanges: boolean[] = [];

    render(
      h(HubSpotDisconnectDialog, {
        open: true,
        onOpenChange: (open: boolean) => openChanges.push(open),
        disconnectAction: failing,
      }),
    );
    await waitFor(() => assert.ok(dialog()));
    assert.deepEqual(attempts, []);

    fireEvent.click(buttonIn(dialog()!, 'Desconectar'));

    await waitFor(() => assert.ok(screen.getByText('HubSpot no respondió.')));
    assert.deepEqual(attempts, [1]);
    assert.deepEqual(openChanges, []);
    assert.equal(refreshCount, 0);
    // La acción de servidor real nunca se tocó: se usó la inyectada.
    assert.deepEqual(calls, []);

    fireEvent.click(buttonIn(dialog()!, 'Desconectar'));
    await waitFor(() => assert.deepEqual(attempts, [1, 2]));
  });
});
