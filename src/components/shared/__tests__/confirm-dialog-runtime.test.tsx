/**
 * ConfirmDialog (Thema `overlays/ConfirmDialog`) — contrato RUNTIME: una
 * confirmación no se cierra por accidente (sin X, sin clic afuera), el foco
 * entra donde toca y la acción destructiva se distingue.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ConfirmDialog: (typeof import('../confirm-dialog'))['ConfirmDialog'];

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ConfirmDialog } = await import('../confirm-dialog'));
});

afterEach(() => {
  cleanup();
});

function Harness(props: Partial<React.ComponentProps<typeof ConfirmDialog>> & { log: string[] }) {
  const { log, ...rest } = props;
  const [open, setOpen] = React.useState(true);
  return h(ConfirmDialog, {
    open,
    onOpenChange: (next: boolean) => {
      log.push(`open:${next}`);
      setOpen(next);
    },
    title: '¿Eliminar el lote?',
    description: 'No se puede deshacer.',
    confirmLabel: 'Eliminar',
    onConfirm: () => log.push('confirm'),
    onCancel: () => log.push('cancel'),
    ...rest,
  });
}

describe('ConfirmDialog — no se cierra por accidente', () => {
  it('es un alertdialog, sin botón X de cerrar', () => {
    render(h(Harness, { log: [] }));
    const dialog = screen.getByRole('alertdialog');
    assert.ok(dialog);
    assert.equal(screen.queryByRole('button', { name: 'Cerrar' }), null);
    const buttons = Array.from(dialog.querySelectorAll('button')).map((b) => b.textContent);
    assert.deepEqual(buttons, ['Cancelar', 'Eliminar']);
  });

  it('un clic afuera no lo cierra', () => {
    const log: string[] = [];
    render(h(Harness, { log }));
    const backdrop = document.querySelector('[data-slot="alert-dialog-overlay"]') as HTMLElement;
    assert.ok(backdrop, 'debe pintar el velo');
    fireEvent.pointerDown(backdrop);
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    assert.ok(screen.getByRole('alertdialog'));
    assert.deepEqual(log, []);
  });

  it('Cancelar avisa y cierra', async () => {
    const log: string[] = [];
    render(h(Harness, { log }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    assert.deepEqual(log, ['cancel', 'open:false']);
    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null));
  });

  it('confirmar dispara la acción y NO cierra solo (cierre manual tras éxito)', () => {
    const log: string[] = [];
    render(h(Harness, { log }));
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    assert.deepEqual(log, ['confirm']);
    assert.ok(screen.getByRole('alertdialog'));
  });
});

describe('ConfirmDialog — con disparador propio', () => {
  it('se abre desde su disparador y Cancelar lo cierra sin estado externo', async () => {
    render(
      h(ConfirmDialog, {
        trigger: h('button', { type: 'button' }, 'Eliminar lote'),
        title: '¿Eliminar el lote?',
      }),
    );
    assert.equal(screen.queryByRole('alertdialog'), null);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar lote' }));
    assert.ok(await screen.findByRole('alertdialog'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null));
  });
});

describe('ConfirmDialog — foco y tono', () => {
  it('el foco entra en Cancelar, no en la acción', async () => {
    render(h(Harness, { log: [] }));
    // `assert.ok(a === b)`: comparar nodos con `assert.equal` intenta pintar el
    // DOM entero al fallar.
    await waitFor(() =>
      assert.ok(document.activeElement === screen.getByRole('button', { name: 'Cancelar' })),
    );
  });

  it('con texto de confirmación, el foco va al campo y la acción espera al texto exacto', async () => {
    const log: string[] = [];
    render(h(Harness, { log, confirmationText: 'Lote 7', variant: 'destructive' }));
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await waitFor(() => assert.ok(document.activeElement === input));

    const action = screen.getByRole('button', { name: 'Eliminar' }) as HTMLButtonElement;
    assert.equal(action.disabled, true);
    fireEvent.change(input, { target: { value: 'Lote 7' } });
    assert.equal(action.disabled, false);
    fireEvent.keyDown(input, { key: 'Enter' });
    assert.deepEqual(log, ['confirm']);
  });

  it('destructivo: título en rojo, chip del tono y botón rojo sólido', () => {
    render(h(Harness, { log: [], variant: 'destructive' }));
    const title = screen.getByText('¿Eliminar el lote?');
    assert.match(title.className, /text-destructive/);
    const tile = document.querySelector('[data-slot="icon-tile"]') as HTMLElement;
    assert.equal(tile.getAttribute('data-tone'), 'negative');
    const action = screen.getByRole('button', { name: 'Eliminar' });
    assert.match(action.className, /destructive/);
  });

  it('mientras carga, ni cancelar ni confirmar responden', () => {
    render(h(Harness, { log: [], loading: true }));
    assert.equal((screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled, true);
    assert.equal((screen.getByRole('button', { name: 'Eliminar' }) as HTMLButtonElement).disabled, true);
  });

  it('el tercer botón va entre cancelar y confirmar', () => {
    const log: string[] = [];
    render(
      h(Harness, {
        log,
        confirmLabel: 'Guardar y salir',
        secondaryLabel: 'Salir sin guardar',
        onSecondary: () => log.push('secondary'),
      }),
    );
    const labels = Array.from(screen.getByRole('alertdialog').querySelectorAll('button')).map(
      (b) => b.textContent,
    );
    assert.deepEqual(labels, ['Cancelar', 'Salir sin guardar', 'Guardar y salir']);
    fireEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' }));
    assert.deepEqual(log, ['secondary']);
  });
});
