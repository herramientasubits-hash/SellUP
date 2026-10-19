/**
 * AGENT3-OUTSIDE-COMPANY-1 — «Preparar primer contacto» desde afuera: primero la
 * empresa (SellUp o HubSpot); si no está, país y dominio y se crea (dueña 18-10).
 */
import '../../chat/__tests__/jsdom-setup';

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let candidates: unknown[] = [];
const resolveCalls: unknown[] = [];

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    resolveContactEnrichmentCompanyAction: async () => ({ success: true, data: { resolved: false, singleMatch: false, candidates, skippedHubSpot: false } }),
  },
});
mock.module('@/modules/speech/first-contact-company-actions', {
  namedExports: {
    resolveFirstContactCompanyAction: async (input: unknown) => {
      resolveCalls.push(input);
      return { success: true, accountId: 'acc-new', created: true, hubspot: 'created' };
    },
  },
});

let rtl: typeof import('@testing-library/react');
let FirstContactCompanyPicker: (typeof import('../first-contact-company-picker'))['FirstContactCompanyPicker'];

before(async () => {
  rtl = await import('@testing-library/react');
  ({ FirstContactCompanyPicker } = await import('../first-contact-company-picker'));
});

afterEach(() => {
  rtl.cleanup();
  candidates = [];
  resolveCalls.length = 0;
});

function answerText(text: string) {
  const input = rtl.screen.getByRole('textbox');
  rtl.fireEvent.change(input, { target: { value: text } });
  rtl.fireEvent.keyDown(input, { key: 'Enter' });
}

describe('Agente 3 · elegir la empresa desde afuera', () => {
  it('si no está en SellUp ni en HubSpot, pide país y dominio y la crea', async () => {
    const resolved: string[] = [];
    rtl.render(React.createElement(FirstContactCompanyPicker, { open: true, onOpenChange: () => {}, onResolved: (id: string) => resolved.push(id) }));

    answerText('Nueva Empresa SA');
    await rtl.screen.findByText(/¿De qué país es Nueva Empresa SA\?/);
    rtl.fireEvent.click(rtl.screen.getByRole('button', { name: /^Colombia/ }));
    await rtl.screen.findByText('¿Cuál es su sitio web?');
    answerText('nuevaempresa.co');

    await rtl.waitFor(() => assert.deepEqual(resolved, ['acc-new']));
    assert.deepEqual(resolveCalls, [{ manual: { name: 'Nueva Empresa SA', countryCode: 'CO', domain: 'nuevaempresa.co' } }]);
  });

  it('si la encuentra, se elige y se usa esa', async () => {
    candidates = [{ source: 'hubspot', hubspotCompanyId: '123456789', name: 'Grupo Ciisa', domain: 'grupociisa.com', country: 'Costa Rica', matchConfidence: 0.9 }];
    const resolved: string[] = [];
    rtl.render(React.createElement(FirstContactCompanyPicker, { open: true, onOpenChange: () => {}, onResolved: (id: string) => resolved.push(id) }));

    answerText('Grupo Ciisa');
    rtl.fireEvent.click(await rtl.screen.findByRole('button', { name: /^Grupo Ciisa/ }));

    await rtl.waitFor(() => assert.deepEqual(resolved, ['acc-new']));
    assert.equal((resolveCalls[0] as { candidate: { hubspotCompanyId: string } }).candidate.hubspotCompanyId, '123456789');
  });

  it('al elegir, queda «Abriendo el primer contacto» (no vuelve a preguntar ni se cierra solo) hasta que Rumbo lo reemplaza', async () => {
    candidates = [{ source: 'hubspot', hubspotCompanyId: '123456789', name: 'Grupo Ciisa', domain: 'grupociisa.com', country: 'Costa Rica', matchConfidence: 0.9 }];
    const resolved: string[] = [];
    const openChanges: boolean[] = [];
    rtl.render(
      React.createElement(FirstContactCompanyPicker, {
        open: true,
        onOpenChange: (open: boolean) => openChanges.push(open),
        onResolved: (id: string) => resolved.push(id),
      }),
    );
    answerText('Grupo Ciisa');
    rtl.fireEvent.click(await rtl.screen.findByRole('button', { name: /^Grupo Ciisa/ }));
    await rtl.waitFor(() => assert.deepEqual(resolved, ['acc-new']));
    assert.ok(rtl.screen.getByTestId('first-contact-company-working'));
    assert.ok(rtl.screen.getByText('Abriendo el primer contacto'));
    assert.deepEqual(openChanges, [], 'quien lo monta lo cierra al abrir Rumbo, no el buscador');
  });
});
