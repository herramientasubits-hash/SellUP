/**
 * «Todos los datos en HubSpot», plegado al final del Resumen (dueña 17-11: la pestaña
 * «HubSpot» ya no cabía en la fila de pestañas). Contrato RUNTIME: cerrado no consulta
 * HubSpot; al abrirlo, lee y muestra los grupos en una columna.
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
let HubSpotPropertiesDisclosure: (typeof import('../hubspot-properties-section'))['HubSpotPropertiesDisclosure'];

const h = React.createElement;
const requested: string[] = [];

before(async () => {
  (globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response(
      JSON.stringify({
        status: 'ok',
        sections: [
          { name: 'companyinformation', label: 'Company information', entries: [{ name: 'name', label: 'Company name', value: 'FNL Laboratory', kind: 'text' }] },
          { name: 'calificacion', label: 'Calificación de cuenta', entries: [{ name: 'estado', label: 'Estado de atacabilidad', value: 'Atacable', kind: 'text' }] },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ HubSpotPropertiesDisclosure } = await import('../hubspot-properties-section'));
});

afterEach(() => {
  cleanup();
  requested.length = 0;
});

describe('Todos los datos en HubSpot (plegado en Resumen)', () => {
  it('cerrado no consulta HubSpot; al abrirlo muestra los grupos', async () => {
    render(h(HubSpotPropertiesDisclosure, { kind: 'company', hubspotId: '61081648756', hubspotUrl: null }));
    assert.ok(screen.getByText('Todos los datos en HubSpot'));
    assert.equal(requested.length, 0, 'plegado: no se lee HubSpot');

    fireEvent.click(screen.getByRole('button', { name: 'Ver todos' }));
    await waitFor(() => assert.ok(screen.getByText('Calificación de cuenta')));
    assert.match(requested[0], /op=properties&kind=company&id=61081648756/);
    assert.ok(screen.getByText('FNL Laboratory'));
    assert.ok(screen.getByRole('heading', { name: 'Company information' }));

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    assert.equal(screen.queryByText('Calificación de cuenta'), null);
  });

  it('sin vínculo con HubSpot no se muestra', () => {
    const { container } = render(h(HubSpotPropertiesDisclosure, { kind: 'contact', hubspotId: null }));
    assert.equal(container.textContent, '');
  });
});
