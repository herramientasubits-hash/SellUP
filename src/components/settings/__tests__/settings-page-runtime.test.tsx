/**
 * SettingsPage y TechnicalDetails — contrato RUNTIME: una sola forma de decir
 * dónde se está (las migas, sin flecha de volver ni menú lateral) y lo técnico
 * plegado.
 */

import './jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let SettingsPage: (typeof import('../settings-page'))['SettingsPage'];
let TechnicalDetails: (typeof import('../settings-page'))['TechnicalDetails'];

const h = React.createElement;

let currentPath = '/settings';

mock.module('next/navigation', {
  namedExports: {
    usePathname: () => currentPath,
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  },
});

before(async () => {
  ({ render, screen, within, cleanup, fireEvent } = await import('@testing-library/react'));
  ({ SettingsPage, TechnicalDetails } = await import('../settings-page'));
});

afterEach(() => {
  cleanup();
  currentPath = '/settings';
});

describe('SettingsPage — ubicación', () => {
  it('el resumen no pinta migas: la barra ya dice «SellUp › Configuración»', () => {
    render(
      h(SettingsPage, {
        overview: true,
        title: 'Configuración',
        children: h('p', null, 'contenido'),
      }),
    );

    assert.equal(screen.queryByRole('navigation', { name: 'Breadcrumb' }), null);
  });

  it('una sección de primer nivel se nombra en las migas, sin flecha de volver', () => {
    currentPath = '/settings/users';
    render(
      h(SettingsPage, {
        title: 'Usuarios y acceso',
        description: 'Gestiona el equipo.',
        children: h('p', null, 'contenido'),
      }),
    );

    assert.ok(screen.getByRole('heading', { level: 1, name: 'Usuarios y acceso' }));
    assert.ok(screen.getByText('Gestiona el equipo.'));
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    assert.equal(
      within(crumbs).getByText('Usuarios y acceso').getAttribute('aria-current'),
      'page',
    );
    assert.equal(screen.queryByRole('link', { name: 'Volver' }), null);
  });

  it('una pantalla anidada pinta el camino dentro de la sección y termina en ella misma', () => {
    currentPath = '/settings/integrations/hubspot';
    render(
      h(SettingsPage, {
        title: 'HubSpot',
        trail: [{ label: 'Integraciones comerciales', href: '/settings/integrations' }],
        children: h('p', null, 'contenido'),
      }),
    );

    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const parent = within(crumbs).getByRole('link', { name: 'Integraciones comerciales' });

    assert.equal(parent.getAttribute('href'), '/settings/integrations');
    assert.equal(within(crumbs).getByText('HubSpot').getAttribute('aria-current'), 'page');
    // La sección sale de la URL y el `trail` que ya la nombra no la repite.
    assert.equal(within(crumbs).getAllByText('Integraciones comerciales').length, 1);
    // La raíz «Configuración» ya está en la barra superior: no se repite.
    assert.equal(within(crumbs).queryByText('Configuración'), null);
    assert.equal(screen.queryByRole('link', { name: 'Volver' }), null);
  });

  it('la sección sale de la URL aunque la pantalla no la nombre', () => {
    currentPath = '/settings/usage';
    render(h(SettingsPage, { title: 'Uso, costos y efectividad', children: h('p', null, 'x') }));

    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    assert.equal(
      within(crumbs).getByRole('link', { name: 'Proveedores y consumo' }).getAttribute('href'),
      '/settings/providers',
    );
    assert.equal(
      within(crumbs).getByText('Uso, costos y efectividad').getAttribute('aria-current'),
      'page',
    );
  });

  it('pinta las acciones y el contenido', () => {
    render(
      h(SettingsPage, {
        title: 'Reglas',
        actions: h('button', { type: 'button' }, 'Nueva regla'),
        children: h('p', null, 'contenido de la pantalla'),
      }),
    );

    assert.ok(screen.getByRole('button', { name: 'Nueva regla' }));
    assert.ok(screen.getByText('contenido de la pantalla'));
  });
});

describe('TechnicalDetails — lo técnico, plegado', () => {
  it('arranca cerrado, con título y resumen a la vista', () => {
    render(
      h(TechnicalDetails, { summary: 'Identificadores para soporte.', children: h('p', null, 'Hub ID 123') }),
    );

    const trigger = screen.getByRole('button', { name: /Detalles técnicos/ });
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.ok(screen.getByText('Detalles técnicos'));
    assert.ok(screen.getByText('Identificadores para soporte.'));
  });

  it('se abre y se vuelve a plegar con su botón', () => {
    render(h(TechnicalDetails, { children: h('p', null, 'Hub ID 123') }));
    const trigger = screen.getByRole('button', { name: /Detalles técnicos/ });

    fireEvent.click(trigger);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.ok(screen.getByText('Hub ID 123'));

    fireEvent.click(trigger);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  });

  it('acepta otro título', () => {
    render(h(TechnicalDetails, { title: 'Otros proveedores en estudio (3)', children: h('p', null, 'x') }));

    assert.ok(screen.getByText('Otros proveedores en estudio (3)'));
  });
});
