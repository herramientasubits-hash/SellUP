/**
 * Piezas comunes de las pantallas de integración — contrato RUNTIME.
 *
 *   - SecretInput: nace oculto y el ojo lo muestra/oculta;
 *   - IntegrationDisconnectDialog: 🔴 solo confirmar ejecuta la acción;
 *   - IntegrationCredentialModal: 🔴 no envía sin lo mínimo, envía una sola vez,
 *     enseña el error sin cerrar y vacía los campos al cerrar.
 */

import './jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let SecretInput: (typeof import('../secret-input'))['SecretInput'];
let Field: (typeof import('../../forms/field'))['Field'];
let IntegrationDisconnectDialog: (typeof import('../integration-disconnect-dialog'))['IntegrationDisconnectDialog'];
let IntegrationCredentialModal: (typeof import('../integration-credential-modal'))['IntegrationCredentialModal'];

const h = React.createElement;

let refreshCount = 0;

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
    usePathname: () => '/settings/integrations',
  },
});

function buttonByText(name: string): HTMLButtonElement {
  const match = Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === name,
  );
  assert.ok(match, `no hay botón «${name}»`);
  return match;
}

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ SecretInput } = await import('../secret-input'));
  ({ Field } = await import('../../forms/field'));
  ({ IntegrationDisconnectDialog } = await import('../integration-disconnect-dialog'));
  ({ IntegrationCredentialModal } = await import('../integration-credential-modal'));
});

beforeEach(() => {
  refreshCount = 0;
});

afterEach(() => {
  cleanup();
});

describe('SecretInput', () => {
  function Harness() {
    const [value, setValue] = React.useState('');
    return h(
      Field,
      { label: 'Access token', description: 'Lo generas en HubSpot.', children: null as never },
      h(SecretInput, { value, onValueChange: setValue, secretName: 'token' }),
    );
  }

  it('nace oculto y la etiqueta del campo apunta al control', () => {
    render(h(Harness));

    const input = screen.getByLabelText('Access token') as HTMLInputElement;
    assert.equal(input.type, 'password');
    assert.equal(input.getAttribute('autocomplete'), 'off');
    assert.ok(input.getAttribute('aria-describedby'));
  });

  it('el ojo muestra y vuelve a ocultar lo escrito', () => {
    render(h(Harness));
    const input = screen.getByLabelText('Access token') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'pat-123' } });
    assert.equal(input.value, 'pat-123');

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar token' }));
    assert.equal(input.type, 'text');

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar token' }));
    assert.equal(input.type, 'password');
  });
});

describe('IntegrationDisconnectDialog', () => {
  function setup(result: { success: boolean; error?: string }) {
    const calls: number[] = [];
    const openChanges: boolean[] = [];
    render(
      h(IntegrationDisconnectDialog, {
        open: true,
        onOpenChange: (open: boolean) => openChanges.push(open),
        title: 'Desconectar Tavily',
        description: 'SellUp eliminará la API Key guardada.',
        onDisconnect: async () => {
          calls.push(calls.length + 1);
          return result;
        },
      }),
    );
    return { calls, openChanges };
  }

  it('abierto, todavía no ha ejecutado nada', async () => {
    const { calls } = setup({ success: true });

    await waitFor(() => assert.ok(screen.getByRole('alertdialog', { hidden: true })));
    assert.ok(screen.getByText('Desconectar Tavily'));
    assert.ok(screen.getByText('SellUp eliminará la API Key guardada.'));
    assert.deepEqual(calls, []);
  });

  it('cancelar pide cerrar y no ejecuta la acción', async () => {
    const { calls, openChanges } = setup({ success: true });
    await waitFor(() => assert.ok(screen.getByRole('alertdialog', { hidden: true })));

    fireEvent.click(buttonByText('Cancelar'));

    await waitFor(() => assert.deepEqual(openChanges, [false]));
    assert.deepEqual(calls, []);
    assert.equal(refreshCount, 0);
  });

  it('confirmar ejecuta la acción una vez, cierra y refresca', async () => {
    const { calls, openChanges } = setup({ success: true });
    await waitFor(() => assert.ok(screen.getByRole('alertdialog', { hidden: true })));

    fireEvent.click(buttonByText('Desconectar'));

    await waitFor(() => assert.deepEqual(openChanges, [false]));
    assert.deepEqual(calls, [1]);
    assert.equal(refreshCount, 1);
  });

  it('si falla, enseña el motivo y no cierra ni refresca', async () => {
    const { calls, openChanges } = setup({ success: false, error: 'Sin permisos.' });
    await waitFor(() => assert.ok(screen.getByRole('alertdialog', { hidden: true })));

    fireEvent.click(buttonByText('Desconectar'));

    await waitFor(() => assert.ok(screen.getByText('Sin permisos.')));
    assert.deepEqual(calls, [1]);
    assert.deepEqual(openChanges, []);
    assert.equal(refreshCount, 0);
  });
});

describe('IntegrationCredentialModal', () => {
  const MIN_LENGTH = 10;

  function setup(result: { success: boolean; message?: string; error?: string }) {
    const submitted: string[] = [];
    const openChanges: boolean[] = [];
    let resets = 0;

    function Harness() {
      const [token, setToken] = React.useState('');
      return h(IntegrationCredentialModal, {
        open: true,
        onOpenChange: (open: boolean) => openChanges.push(open),
        title: 'Conectar HubSpot',
        description: 'Pega el access token.',
        submitLabel: 'Guardar y probar conexión',
        canSubmit: token.trim().length >= MIN_LENGTH,
        onSubmit: async () => {
          submitted.push(token);
          return result;
        },
        onReset: () => {
          resets += 1;
          setToken('');
        },
        successFallback: 'Conectado correctamente.',
        errorFallback: 'No se pudo guardar la credencial.',
        closeDelayMs: 10,
        children: ({ isPending }: { isPending: boolean }) =>
          h(
            Field,
            { label: 'Access token', disabled: isPending, children: null as never },
            h(SecretInput, { value: token, onValueChange: setToken, secretName: 'token' }),
          ),
      });
    }

    render(h(Harness));
    return { submitted, openChanges, resets: () => resets };
  }

  it('el botón de guardar está apagado hasta que hay lo mínimo', async () => {
    const { submitted } = setup({ success: true });
    await waitFor(() => assert.ok(screen.getByText('Conectar HubSpot')));

    const submit = buttonByText('Guardar y probar conexión');
    assert.equal(submit.disabled, true);

    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'corto' } });
    assert.equal(buttonByText('Guardar y probar conexión').disabled, true);
    fireEvent.click(buttonByText('Guardar y probar conexión'));
    assert.deepEqual(submitted, []);

    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'pat-1234567890' } });
    assert.equal(buttonByText('Guardar y probar conexión').disabled, false);
  });

  it('guardar envía una vez lo escrito, confirma, cierra, vacía y refresca', async () => {
    const { submitted, openChanges, resets } = setup({ success: true });
    await waitFor(() => assert.ok(screen.getByText('Conectar HubSpot')));
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'pat-1234567890' } });

    fireEvent.click(buttonByText('Guardar y probar conexión'));

    await waitFor(() => assert.ok(screen.getByText('Conectado correctamente.')));
    // Ya guardado: no se puede reenviar mientras se cierra.
    assert.equal(buttonByText('Guardar y probar conexión').disabled, true);
    await waitFor(() => assert.deepEqual(openChanges, [false]));
    assert.deepEqual(submitted, ['pat-1234567890']);
    assert.equal(resets(), 1);
    assert.equal(refreshCount, 1);
  });

  it('si falla, enseña el motivo y deja el diálogo abierto con lo escrito', async () => {
    const { submitted, openChanges, resets } = setup({ success: false, error: 'Token inválido.' });
    await waitFor(() => assert.ok(screen.getByText('Conectar HubSpot')));
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'pat-1234567890' } });

    fireEvent.click(buttonByText('Guardar y probar conexión'));

    await waitFor(() => assert.ok(screen.getByText('Token inválido.')));
    assert.deepEqual(submitted, ['pat-1234567890']);
    assert.deepEqual(openChanges, []);
    assert.equal(resets(), 0);
    assert.equal(refreshCount, 0);
    assert.equal((screen.getByLabelText('Access token') as HTMLInputElement).value, 'pat-1234567890');
  });

  it('cancelar vacía los campos y cierra sin enviar', async () => {
    const { submitted, openChanges, resets } = setup({ success: true });
    await waitFor(() => assert.ok(screen.getByText('Conectar HubSpot')));
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'pat-1234567890' } });

    fireEvent.click(buttonByText('Cancelar'));

    assert.deepEqual(openChanges, [false]);
    assert.equal(resets(), 1);
    assert.deepEqual(submitted, []);
  });
});
