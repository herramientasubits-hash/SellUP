/**
 * AGENT3-WRITER-ROBUST-1 — el panel del Agente 3 mientras trabaja: la espera ocupa
 * TODO el panel (como en el Agente 1), sin la conversación ni los pasos arriba.
 * Pedido de la dueña tras la corrida de Grupo Ciisa (18-10).
 */
import '../../chat/__tests__/jsdom-setup';

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('@/modules/speech/actions', {
  namedExports: { getFirstCallProgress: async () => 'reading_news' },
});

let rtl: typeof import('@testing-library/react');
let FirstContactAgentPanel: (typeof import('../first-contact-agent-panel'))['FirstContactAgentPanel'];
const realFetch = globalThis.fetch;

before(async () => {
  rtl = await import('@testing-library/react');
  ({ FirstContactAgentPanel } = await import('../first-contact-agent-panel'));
});

afterEach(async () => {
  rtl.cleanup();
  globalThis.fetch = realFetch;
  // Cada prueba con un registro de preparaciones limpio (vive fuera del panel).
  window.localStorage.clear();
  const { resetFirstContactRunsStoreForTests } = await import('@/modules/speech/first-contact-runs-client');
  resetFirstContactRunsStoreForTests(null);
});

const CONTACTS = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Emily Cerdas', title: 'Head of Human Resources' }];

function clickButton(name: string | RegExp) {
  rtl.fireEvent.click(rtl.screen.getByRole('button', { name }));
}

describe('Agente 3 · panel mientras trabaja', () => {
  it('la espera ocupa todo el panel: sin la conversación ni los pasos', async () => {
    // La API no responde todavía: el panel queda trabajando.
    globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
    rtl.render(
      React.createElement(FirstContactAgentPanel, {
        open: true,
        onOpenChange: () => {},
        accountId: '7d2b8c5e-1f3a-4b6c-9d8e-0a1b2c3d4e5f',
        accountName: 'Grupo Ciisa',
        contacts: CONTACTS,
        hasFreshBrief: false,
      }),
    );
    // Decisores → Canales → Objetivo → Enfoque → Productos → Resumen.
    for (let i = 0; i < 5; i += 1) clickButton('Continuar');
    assert.ok(rtl.screen.getByText(/Primero investigo la empresa/));
    clickButton(/^Preparar\s*Con lo que elegiste/);

    const running = await rtl.screen.findByTestId('first-contact-running');
    assert.ok(running);
    assert.equal(rtl.screen.queryByTestId('first-contact-agent'), null, 'la conversación no se ve mientras trabaja');
    assert.equal(rtl.screen.queryByText(/Primero investigo la empresa/), null);
    assert.equal(rtl.screen.queryByRole('list', { name: /Pasos del primer contacto/ }), null);
    assert.ok(rtl.within(running).getByText(/Puedes minimizar o cerrar este panel/));
    // Se puede minimizar: sigue en el Centro de procesos.
    assert.ok(rtl.screen.getByTestId('chat-panel-minimize'));
  });

  it('al terminar cierra el panel y lleva al resultado (como el Agente 1)', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, packIds: ['a', 'b'], packStatuses: ['draft', 'needs_review'], reusedBrief: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    const closed: boolean[] = [];
    let viewed = 0;
    let done = 0;
    rtl.render(
      React.createElement(FirstContactAgentPanel, {
        open: true,
        onOpenChange: (open: boolean) => closed.push(open),
        accountId: '7d2b8c5e-1f3a-4b6c-9d8e-0a1b2c3d4e5f',
        accountName: 'Grupo Ciisa',
        contacts: CONTACTS,
        hasFreshBrief: false,
        onDone: () => (done += 1),
        onViewResult: () => (viewed += 1),
      }),
    );
    for (let i = 0; i < 5; i += 1) clickButton('Continuar');
    clickButton(/^Preparar\s*Con lo que elegiste/);
    await rtl.waitFor(() => assert.equal(viewed, 1));
    assert.equal(done, 1);
    assert.deepEqual(closed, [false]);
  });
});
