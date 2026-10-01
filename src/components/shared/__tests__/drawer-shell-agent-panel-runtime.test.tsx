/**
 * DrawerShell — props de Thema para convivir con el panel del agente (`modal`,
 * `overlayClassName`, `contentStyle`, `overlayStyle`, tamaños) sin perder las de
 * SellUp (`icon`, `titleBadge`, `headerActions`, `actions`).
 */
import '../../chat/__tests__/jsdom-setup';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let rtl: typeof import('@testing-library/react');
let DrawerShell: (typeof import('../drawer-shell'))['DrawerShell'];
let agentPanelShift: (typeof import('@/components/ai/agent-panel-motion'))['agentPanelShift'];

before(async () => {
  rtl = await import('@testing-library/react');
  ({ DrawerShell } = await import('../drawer-shell'));
  ({ agentPanelShift } = await import('@/components/ai/agent-panel-motion'));
});

afterEach(() => {
  rtl.cleanup();
  document.body.style.overflow = '';
});

const content = () => document.querySelector('[data-slot="sheet-content"]') as HTMLElement;
const overlay = () => document.querySelector('[data-slot="sheet-overlay"]') as HTMLElement | null;

describe('DrawerShell', () => {
  it('conserva la cabecera de SellUp: icono, insignia, acciones y cierre', () => {
    rtl.render(
      <DrawerShell
        open
        title="Empresa"
        description="Detalle"
        icon={<span data-testid="icono" />}
        titleBadge={<span>Activa</span>}
        headerActions={<button type="button">Editar</button>}
        actions={<button type="button">Guardar</button>}
      >
        <p>Cuerpo</p>
      </DrawerShell>,
    );
    assert.ok(rtl.screen.getByTestId('icono'));
    assert.ok(rtl.screen.getByText('Activa'));
    assert.ok(rtl.screen.getByRole('button', { name: 'Editar' }));
    assert.ok(rtl.screen.getByRole('button', { name: 'Guardar' }));
    assert.ok(rtl.screen.getByRole('button', { name: 'Cerrar' }));
    assert.ok(rtl.screen.getByText('Cuerpo'));
  });

  it('acepta los tamaños de Thema además de `workspace`', () => {
    const { rerender } = rtl.render(<DrawerShell open title="t" size="3xl" />);
    assert.match(content().className, /sm:!max-w-3xl/);
    rerender(<DrawerShell open title="t" size="7xl" />);
    assert.match(content().className, /sm:!max-w-7xl/);
    rerender(<DrawerShell open title="t" size="full" />);
    assert.match(content().className, /calc\(100%-1\.5rem\)/);
    rerender(<DrawerShell open title="t" size="workspace" />);
    assert.match(content().className, /90vw/);
  });

  it('`overlayClassName`, `overlayStyle` y `contentStyle` llegan al velo y al cajón', () => {
    const shift = agentPanelShift(true);
    rtl.render(
      <DrawerShell
        open
        title="t"
        overlayClassName="recorte-del-velo"
        overlayStyle={{ right: '40px' }}
        contentStyle={{ right: '52px', transition: shift.content.transition }}
      />,
    );
    assert.match(overlay()?.className ?? '', /recorte-del-velo/);
    assert.equal(overlay()?.style.right, '40px');
    assert.equal(content().style.right, '52px');
    assert.match(content().style.transition, /right 320ms/);
  });

  it('no modal: el fondo no se desplaza mientras está abierto y se libera al cerrar', () => {
    const { rerender } = rtl.render(<DrawerShell open modal={false} title="t" />);
    assert.equal(document.body.style.overflow, 'hidden');
    rerender(<DrawerShell open={false} modal={false} title="t" />);
    assert.equal(document.body.style.overflow, '');
  });
});
