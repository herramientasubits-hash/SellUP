/**
 * SettingsPage y TechnicalDetails — contrato RUNTIME: una sola forma de decir
 * dónde se está (sin flecha de volver) y lo técnico plegado.
 */

import './jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let SettingsPage: (typeof import('../settings-page'))['SettingsPage'];
let TechnicalDetails: (typeof import('../settings-page'))['TechnicalDetails'];

const h = React.createElement;

before(async () => {
  ({ render, screen, within, cleanup, fireEvent } = await import('@testing-library/react'));
  ({ SettingsPage, TechnicalDetails } = await import('../settings-page'));
});

afterEach(() => {
  cleanup();
});

describe('SettingsPage — ubicación', () => {
  it('una sección de primer nivel no pinta migas ni flecha de volver', () => {
    render(
      h(SettingsPage, {
        title: 'Usuarios y acceso',
        description: 'Gestiona el equipo.',
        children: h('p', null, 'contenido'),
      }),
    );

    assert.ok(screen.getByRole('heading', { level: 1, name: 'Usuarios y acceso' }));
    assert.ok(screen.getByText('Gestiona el equipo.'));
    assert.equal(screen.queryByRole('navigation', { name: 'Breadcrumb' }), null);
    assert.equal(screen.queryByRole('link', { name: 'Volver' }), null);
  });

  it('una pantalla anidada pinta el camino dentro de la sección y termina en ella misma', () => {
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
    // La raíz «Configuración» ya está en la barra superior: no se repite.
    assert.equal(within(crumbs).queryByText('Configuración'), null);
    assert.equal(screen.queryByRole('link', { name: 'Volver' }), null);
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
