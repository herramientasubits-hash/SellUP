/**
 * Panel del agente (Thema · ChatPanel / AiAgentDrawer / ShellAgentPanelSlot) —
 * contrato RUNTIME: abre, cierra, ESTRECHA la página (no la tapa) y no es modal.
 */
import './jsdom-setup';

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let rtl: typeof import('@testing-library/react');
let ChatPanel: (typeof import('../chat-panel'))['ChatPanel'];
let ShellAgentPanelSlotProvider: (typeof import('@/components/layout/shell-agent-panel-slot'))['ShellAgentPanelSlotProvider'];
let motion: typeof import('@/components/ai/agent-panel-motion');
type PanelProps = Partial<React.ComponentProps<(typeof import('../chat-panel'))['ChatPanel']>>;

/** Un shell mínimo: la columna de contenido y, hermana suya, la ranura del panel. */
function Shell({ initialOpen = false, panel = {} }: { initialOpen?: boolean; panel?: PanelProps }) {
  const [slot, setSlot] = React.useState<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(initialOpen);
  return (
    <ShellAgentPanelSlotProvider value={slot}>
      <div data-testid="row" style={{ display: 'flex' }}>
        <main data-testid="content" style={{ flex: 1 }}>
          <button type="button" onClick={() => setOpen(true)}>
            Abrir asistente
          </button>
          <button type="button">Acción de la página</button>
          <ChatPanel open={open} onOpenChange={setOpen} subtitle="Generar empresas candidatas" {...panel}>
            <p>Cuerpo del asistente</p>
            <input aria-label="campo del asistente" />
          </ChatPanel>
        </main>
        <div ref={setSlot} data-testid="slot" />
      </div>
    </ShellAgentPanelSlotProvider>
  );
}

function isOpenWidth(wrapper: HTMLElement): boolean {
  return wrapper.style.width !== '' && wrapper.style.width !== '0px' && /45vw/.test(wrapper.style.width);
}

before(async () => {
  rtl = await import('@testing-library/react');
  ({ ChatPanel } = await import('../chat-panel'));
  ({ ShellAgentPanelSlotProvider } = await import('@/components/layout/shell-agent-panel-slot'));
  motion = await import('@/components/ai/agent-panel-motion');
});

afterEach(() => {
  rtl.cleanup();
  mock.timers.reset();
});

describe('ChatPanel en la ranura del shell', () => {
  it('cerrado no ocupa nada ni monta el cuerpo', () => {
    rtl.render(<Shell />);
    const wrapper = rtl.screen.getByTestId('agent-panel-slot');
    assert.equal(wrapper.style.width, '0px');
    assert.equal(wrapper.hasAttribute('data-agent-panel-open'), false);
    assert.equal(rtl.screen.queryByText('Cuerpo del asistente'), null);
  });

  it('abre al lado del contenido: se porta a la ranura hermana y toma su ancho', () => {
    rtl.render(<Shell />);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Abrir asistente' }));

    const slot = rtl.screen.getByTestId('slot');
    const wrapper = rtl.screen.getByTestId('agent-panel-slot');
    assert.ok(slot.contains(wrapper), 'el panel vive en la ranura del shell, no dentro de la página');
    assert.equal(rtl.screen.getByTestId('content').contains(wrapper), false);
    assert.equal(slot.parentElement, rtl.screen.getByTestId('row'), 'la ranura es hermana de la columna de contenido');

    // El ancho lo pone el propio panel: es lo que estrecha la columna de al lado.
    // (jsdom reescribe `calc(min(…))`, así que se comprueba que dejó de ser 0 y la constante aparte.)
    assert.ok(isOpenWidth(wrapper));
    assert.equal(motion.AGENT_PANEL_WIDTH, 'min(400px, 45vw)');
    assert.equal(motion.AGENT_PANEL_OUTER_WIDTH, 'calc(min(400px, 45vw) + 12px)');
    assert.match(wrapper.style.transition, /width 320ms/);
    assert.ok(wrapper.hasAttribute('data-agent-panel-open'));
    assert.ok(rtl.screen.getByText('Cuerpo del asistente'));
  });

  it('cabecera de Thema: marca, título, subtítulo y cerrar; lo demás solo si hay quién lo atienda', () => {
    const onNewConversation = mock.fn();
    const { rerender } = rtl.render(<Shell initialOpen />);
    const panel = rtl.screen.getByTestId('chat-panel');
    assert.equal(panel.tagName, 'ASIDE');
    assert.match(panel.className, /ai-mesh-agent/);
    assert.ok(panel.querySelector('[data-slot="chat-mark"]'));
    assert.ok(rtl.screen.getByRole('heading', { name: 'Agente IA' }));
    assert.ok(rtl.screen.getByText('Generar empresas candidatas'));
    assert.ok(rtl.screen.getByRole('button', { name: 'Cerrar' }));
    assert.equal(rtl.screen.queryByRole('button', { name: 'Historial' }), null);
    assert.equal(rtl.screen.queryByRole('button', { name: 'Nueva conversación' }), null);

    rerender(<Shell initialOpen panel={{ onNewConversation, newConversationLabel: 'Comenzar de nuevo', onHistory: () => {} }} />);
    assert.ok(rtl.screen.getByRole('button', { name: 'Historial' }));
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Comenzar de nuevo' }));
    assert.equal(onNewConversation.mock.callCount(), 1);
  });

  it('no es modal: sin velo, sin aria-modal, y la página sigue siendo usable', () => {
    rtl.render(<Shell initialOpen />);
    assert.equal(document.querySelector('[data-slot="sheet-overlay"]'), null);
    assert.equal(document.querySelector('[aria-modal="true"]'), null);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    const pageAction = rtl.screen.getByRole('button', { name: 'Acción de la página' });
    assert.equal(pageAction.closest('[aria-hidden="true"]'), null);
    assert.equal(pageAction.closest('[inert]'), null);
    assert.notEqual(document.body.style.overflow, 'hidden');
  });

  it('cerrar encoge el hueco y desmonta el cuerpo al terminar la transición', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    rtl.render(<Shell initialOpen />);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Cerrar' }));

    const wrapper = rtl.screen.getByTestId('agent-panel-slot');
    assert.equal(wrapper.style.width, '0px');
    assert.equal(wrapper.hasAttribute('data-agent-panel-open'), false);
    assert.ok(rtl.screen.getByText('Cuerpo del asistente'), 'sigue pintado mientras se cierra');

    rtl.act(() => mock.timers.tick(motion.AGENT_PANEL_DURATION_MS));
    assert.equal(rtl.screen.queryByText('Cuerpo del asistente'), null, 'reabrirlo empieza de cero');
  });

  it('Escape cierra solo con el foco dentro del panel', () => {
    rtl.render(<Shell initialOpen />);
    const wrapper = rtl.screen.getByTestId('agent-panel-slot');

    rtl.fireEvent.keyDown(rtl.screen.getByRole('button', { name: 'Acción de la página' }), { key: 'Escape' });
    assert.ok(isOpenWidth(wrapper), 'Escape fuera del panel no lo cierra');

    rtl.fireEvent.keyDown(rtl.screen.getByLabelText('campo del asistente'), { key: 'Escape' });
    assert.equal(wrapper.style.width, '0px');
  });

  it('con una ejecución en curso no se cierra ni con el botón ni con Escape', () => {
    rtl.render(<Shell initialOpen panel={{ closeDisabled: true }} />);
    const wrapper = rtl.screen.getByTestId('agent-panel-slot');
    assert.equal((rtl.screen.getByRole('button', { name: 'Cerrar' }) as HTMLButtonElement).disabled, true);
    rtl.fireEvent.keyDown(rtl.screen.getByLabelText('campo del asistente'), { key: 'Escape' });
    assert.ok(isOpenWidth(wrapper));
  });
});

describe('ChatPanel sin shell', () => {
  it('flota a la derecha de la ventana, sin velo, en vez de no pintarse', () => {
    rtl.render(
      <ChatPanel open onOpenChange={() => {}}>
        <p>Cuerpo</p>
      </ChatPanel>,
    );
    const floating = document.querySelector('[data-agent-panel-floating]') as HTMLElement;
    assert.ok(floating);
    assert.match(floating.className, /fixed/);
    assert.ok(floating.contains(rtl.screen.getByText('Cuerpo')));
    assert.equal(document.querySelector('[data-slot="sheet-overlay"]'), null);
  });
});
