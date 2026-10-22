/**
 * Una sola capa visible a la vez (dueña 22-10): un panel, diálogo o confirmación abierto encima
 * de otro oculta al de abajo sin desmontarlo, y al cerrarse el de arriba el de abajo vuelve.
 */
import '../../chat/__tests__/jsdom-setup';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let rtl: typeof import('@testing-library/react');
let DrawerShell: (typeof import('../drawer-shell'))['DrawerShell'];
let ui: typeof import('@/components/ui/dialog');
let alert: typeof import('@/components/ui/alert-dialog');
let stack: typeof import('@/lib/overlay-stack');

before(async () => {
  rtl = await import('@testing-library/react');
  ({ DrawerShell } = await import('../drawer-shell'));
  ui = await import('@/components/ui/dialog');
  alert = await import('@/components/ui/alert-dialog');
  stack = await import('@/lib/overlay-stack');
});

afterEach(() => {
  rtl.cleanup();
  document.body.style.overflow = '';
});

const covered = (el: Element | null) => el?.hasAttribute('data-overlay-covered') ?? false;
const sheets = () => [...document.querySelectorAll('[data-slot="sheet-content"]')];
const visibleVeils = () =>
  [...document.querySelectorAll('[data-slot$="-overlay"]')].filter((el) => !el.className.includes('invisible'));

function Nested({ child }: { child: 'drawer' | 'dialog' | 'alert' }) {
  const [open, setOpen] = React.useState(true);
  return (
    <DrawerShell open title="Empresa">
      <p>Ficha de la empresa</p>
      {child === 'drawer' && (
        <DrawerShell open={open} onOpenChange={setOpen} title="Editar empresa">
          <button type="button" onClick={() => setOpen(false)}>Cancelar</button>
        </DrawerShell>
      )}
      {child === 'dialog' && (
        <ui.Dialog open={open} onOpenChange={setOpen}>
          <ui.DialogContent>
            <button type="button" onClick={() => setOpen(false)}>Cancelar</button>
          </ui.DialogContent>
        </ui.Dialog>
      )}
      {child === 'alert' && (
        <alert.AlertDialog open={open} onOpenChange={setOpen}>
          <alert.AlertDialogContent>
            <button type="button" onClick={() => setOpen(false)}>Cancelar</button>
          </alert.AlertDialogContent>
        </alert.AlertDialog>
      )}
    </DrawerShell>
  );
}

describe('una sola capa visible', () => {
  it('editar desde la ficha: la ficha se oculta (sin desmontarse) y vuelve al cancelar', async () => {
    rtl.render(<Nested child="drawer" />);
    const [ficha, editar] = sheets();
    assert.equal(covered(ficha), true);
    assert.equal(covered(editar), false);
    assert.match(ficha.className, /invisible/);
    assert.ok(rtl.screen.getByText('Ficha de la empresa'), 'la ficha sigue montada');
    assert.equal(visibleVeils().length, 1, 'un solo velo visible');

    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Cancelar' }));
    await rtl.waitFor(() => assert.equal(covered(sheets()[0]), false));
    assert.doesNotMatch(sheets()[0].className, /invisible/);
  });

  for (const child of ['dialog', 'alert'] as const) {
    it(`un ${child === 'dialog' ? 'diálogo' : 'aviso de confirmación'} sobre la ficha también la oculta`, async () => {
      rtl.render(<Nested child={child} />);
      assert.equal(covered(sheets()[0]), true);
      const top = document.querySelector(`[data-slot="${child === 'dialog' ? 'dialog' : 'alert-dialog'}-content"]`);
      assert.equal(covered(top), false);
      rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Cancelar' }));
      await rtl.waitFor(() => assert.equal(covered(sheets()[0]), false));
    });
  }

  it('dos paneles hermanos (no anidados): sólo el último se ve', () => {
    rtl.render(
      <>
        <DrawerShell open title="Uno" />
        <DrawerShell open title="Dos" />
      </>,
    );
    const [uno, dos] = sheets();
    assert.equal(covered(uno), true);
    assert.equal(covered(dos), false);
    assert.equal(visibleVeils().length, 1);
  });

  it('la pila: la última capa es la que se ve y sacar una no afecta a las demás', () => {
    const popA = stack.pushOverlayLayer('a');
    const popB = stack.pushOverlayLayer('b');
    assert.equal(stack.topOverlayLayer(), 'b');
    popA();
    assert.equal(stack.topOverlayLayer(), 'b');
    popB();
    assert.equal(stack.topOverlayLayer(), null);
  });
});
