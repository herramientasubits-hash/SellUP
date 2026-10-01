/**
 * SettingsNav — contrato RUNTIME: qué secciones lista, cuál marca como actual y
 * qué aviso lleva cada una.
 */

import './jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let SettingsNav: (typeof import('../settings-nav'))['SettingsNav'];

const h = React.createElement;

let currentPath = '/settings';

mock.module('next/navigation', {
  namedExports: {
    usePathname: () => currentPath,
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  },
});

function sideNav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Secciones de Configuración', hidden: true });
}

function linkNames(): string[] {
  return within(sideNav())
    .getAllByRole('link', { hidden: true })
    .map((link) => link.getAttribute('href') ?? '');
}

before(async () => {
  ({ render, screen, within, cleanup } = await import('@testing-library/react'));
  ({ SettingsNav } = await import('../settings-nav'));
});

afterEach(() => {
  cleanup();
  currentPath = '/settings';
});

describe('SettingsNav — secciones', () => {
  it('a un administrador le lista el resumen y las ocho secciones', () => {
    render(h(SettingsNav, { isAdmin: true, isActive: true }));

    assert.deepEqual(linkNames(), [
      '/settings',
      '/settings/users',
      '/settings/providers',
      '/settings/automations',
      '/settings/integrations',
      '/settings/prospecting',
      '/settings/activity',
      '/settings/source-catalog',
      '/settings/my-drive',
    ]);
  });

  it('🔴 a quien no es administrador no le enlaza secciones que redirigen', () => {
    render(h(SettingsNav, { isAdmin: false, isActive: true }));

    assert.deepEqual(linkNames(), ['/settings', '/settings/activity', '/settings/my-drive']);
  });
});

describe('SettingsNav — sección actual', () => {
  it('marca la sección de la ruta, también en una pantalla anidada', () => {
    currentPath = '/settings/integrations/hubspot';
    render(h(SettingsNav, { isAdmin: true, isActive: true }));

    const current = within(sideNav())
      .getAllByRole('link', { hidden: true })
      .filter((link) => link.getAttribute('aria-current') === 'page');

    assert.equal(current.length, 1);
    assert.equal(current[0].getAttribute('href'), '/settings/integrations');
  });

  it('en el resumen marca «Resumen» y no una sección', () => {
    render(h(SettingsNav, { isAdmin: true, isActive: true }));

    const current = within(sideNav())
      .getAllByRole('link', { hidden: true })
      .filter((link) => link.getAttribute('aria-current') === 'page');

    assert.deepEqual(current.map((link) => link.getAttribute('href')), ['/settings']);
  });

  it('una vista antigua de presupuesto marca Proveedores y consumo', () => {
    currentPath = '/settings/budget-credits';
    render(h(SettingsNav, { isAdmin: true, isActive: true }));

    const current = within(sideNav())
      .getAllByRole('link', { hidden: true })
      .find((link) => link.getAttribute('aria-current') === 'page');

    assert.equal(current?.getAttribute('href'), '/settings/providers');
  });
});

describe('SettingsNav — avisos', () => {
  it('pinta el aviso de cada sección junto a su nombre', () => {
    render(
      h(SettingsNav, {
        isAdmin: true,
        isActive: true,
        badges: {
          users: { label: '5 pendientes', tone: 'warning' },
          'source-catalog': { label: '53 fuentes', tone: 'brand' },
          'my-drive': { label: 'Conectado', tone: 'positive' },
        },
      }),
    );

    const nav = sideNav();
    assert.ok(within(nav).getByText('5 pendientes'));
    assert.ok(within(nav).getByText('53 fuentes'));
    assert.ok(within(nav).getByText('Conectado'));
  });

  it('una sección sin aviso no pinta ninguno', () => {
    render(h(SettingsNav, { isAdmin: true, isActive: true }));

    assert.equal(within(sideNav()).queryByText(/pendiente/), null);
  });
});
