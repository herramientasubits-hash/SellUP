/**
 * navigation (Stepper, Breadcrumbs, TabsNav) — contrato RUNTIME.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ───────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
defineGlobal('window', dom.window);
defineGlobal('document', dom.window.document);
defineGlobal('navigator', dom.window.navigator);
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true);
function copyWindowPropsToGlobal(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  const source = dom.window as unknown as Record<string, unknown>;
  for (const prop of Object.getOwnPropertyNames(dom.window)) {
    if (prop in target) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, prop);
    if (descriptor) Object.defineProperty(target, prop, descriptor);
  }
}
copyWindowPropsToGlobal();

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// next/link necesita el contexto del app-router; en jsdom se pinta como un <a>.
mock.module('next/link', {
  defaultExport: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => React.createElement('a', { href, ...rest }, children),
});
let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let Stepper: (typeof import('../stepper'))['Stepper'];
let Breadcrumbs: (typeof import('../breadcrumbs'))['Breadcrumbs'];
let TabsNav: (typeof import('../tabs-nav'))['TabsNav'];
let Users: (typeof import('@/icons'))['Users'];

const h = React.createElement;

before(async () => {
  ({ render, screen, within, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ Stepper } = await import('../stepper'));
  ({ Breadcrumbs } = await import('../breadcrumbs'));
  ({ TabsNav } = await import('../tabs-nav'));
  ({ Users } = await import('@/icons'));
});

afterEach(() => {
  cleanup();
});

describe('Stepper', () => {
  const STEPS = [
    { id: 'file', label: 'Archivo' },
    { id: 'mapping', label: 'Columnas', description: 'Empareja cada columna' },
    { id: 'review', label: 'Revisión' },
  ];
  const stepOf = (label: string) => screen.getByText(label).closest('li') as HTMLElement;

  it('es una lista «Progreso» con un paso por elemento', () => {
    render(h(Stepper, { steps: STEPS, current: 1 }));

    const list = screen.getByRole('list', { name: 'Progreso' });
    assert.equal(within(list).getAllByRole('listitem').length, 3);
  });

  it('marca solo el paso actual con aria-current="step"', () => {
    render(h(Stepper, { steps: STEPS, current: 1 }));

    assert.equal(stepOf('Columnas').getAttribute('aria-current'), 'step');
    assert.equal(stepOf('Archivo').hasAttribute('aria-current'), false);
    assert.equal(stepOf('Revisión').hasAttribute('aria-current'), false);
  });

  it('los anteriores quedan completados y los siguientes pendientes', () => {
    render(h(Stepper, { steps: STEPS, current: 1 }));

    assert.equal(stepOf('Archivo').getAttribute('data-status'), 'complete');
    assert.equal(stepOf('Columnas').getAttribute('data-status'), 'current');
    assert.equal(stepOf('Revisión').getAttribute('data-status'), 'upcoming');
  });

  it('el completado cambia su número por un check; el resto lo conserva', () => {
    render(h(Stepper, { steps: STEPS, current: 1 }));

    const mark = (label: string) => stepOf(label).querySelector('span.rounded-full') as HTMLElement;
    assert.ok(mark('Archivo').querySelector('svg'));
    assert.equal(mark('Columnas').textContent, '2');
    assert.equal(mark('Revisión').textContent, '3');
  });

  it('pinta la descripción del paso', () => {
    render(h(Stepper, { steps: STEPS, current: 0 }));

    assert.ok(screen.getByText('Empareja cada columna'));
  });

  it('status explícito gana al que se deriva de current', () => {
    render(h(Stepper, { steps: [STEPS[0], { ...STEPS[1], status: 'error' as const }, STEPS[2]], current: 2 }));

    assert.equal(stepOf('Columnas').getAttribute('data-status'), 'error');
  });

  it('sin onStepClick los pasos no son botones', () => {
    render(h(Stepper, { steps: STEPS, current: 1 }));

    assert.equal(screen.queryByRole('button'), null);
  });

  it('onStepClick recibe el índice del paso pulsado', () => {
    const calls: number[] = [];
    render(h(Stepper, { steps: STEPS, current: 1, onStepClick: (index) => calls.push(index) }));

    fireEvent.click(screen.getByRole('button', { name: /Archivo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Columnas/ }));

    assert.deepEqual(calls, [0, 1]);
  });

  it('con onStepClick los pasos pendientes quedan deshabilitados y no lo llaman', () => {
    const calls: number[] = [];
    render(h(Stepper, { steps: STEPS, current: 1, onStepClick: (index) => calls.push(index) }));
    const pending = screen.getByRole('button', { name: /Revisión/ }) as HTMLButtonElement;

    fireEvent.click(pending);

    assert.equal(pending.disabled, true);
    assert.deepEqual(calls, []);
  });

  it('refleja la orientación en data-orientation', () => {
    render(h(Stepper, { steps: STEPS, current: 0, orientation: 'vertical' }));

    assert.equal(screen.getByRole('list').getAttribute('data-orientation'), 'vertical');
  });
});

describe('Breadcrumbs', () => {
  it('es una navegación «Breadcrumb»', () => {
    render(h(Breadcrumbs, { items: ['Configuración'] }));

    assert.ok(screen.getByRole('navigation', { name: 'Breadcrumb' }));
  });

  it('acepta strings y objetos en la misma ruta', () => {
    render(
      h(Breadcrumbs, {
        items: [{ label: 'Configuración', href: '/settings' }, 'Catálogos', { label: 'DIAN' }],
      }),
    );

    assert.equal(screen.getByRole('link', { name: 'Configuración' }).getAttribute('href'), '/settings');
    assert.ok(screen.getByText('Catálogos'));
    assert.ok(screen.getByText('DIAN'));
  });

  it('un string intermedio queda como texto, sin enlace ni aria-current', () => {
    render(h(Breadcrumbs, { items: ['Configuración', 'DIAN'] }));

    const section = screen.getByText('Configuración');
    assert.equal(section.tagName, 'SPAN');
    assert.equal(section.hasAttribute('aria-current'), false);
  });

  it('el último tramo lleva aria-current="page"', () => {
    render(h(Breadcrumbs, { items: [{ label: 'Configuración', href: '/settings' }, 'DIAN'] }));

    assert.equal(screen.getByText('DIAN').getAttribute('aria-current'), 'page');
  });

  it('el último tramo no es enlace aunque traiga href', () => {
    render(
      h(Breadcrumbs, {
        items: [
          { label: 'Configuración', href: '/settings' },
          { label: 'DIAN', href: '/settings/dian' },
        ],
      }),
    );

    assert.equal(screen.getAllByRole('link').length, 1);
    assert.equal(screen.getByText('DIAN').tagName, 'SPAN');
  });

  it('un tramo con onClick es un botón que lo llama', () => {
    let clicks = 0;
    render(h(Breadcrumbs, { items: [{ label: 'Paso 1', onClick: () => clicks++ }, 'Paso 2'] }));

    fireEvent.click(screen.getByRole('button', { name: 'Paso 1' }));

    assert.equal(clicks, 1);
  });

  it('active explícito marca un tramo que no es el último', () => {
    render(
      h(Breadcrumbs, {
        items: [{ label: 'Configuración', href: '/settings', active: true }, { label: 'DIAN', active: false }],
      }),
    );

    assert.equal(screen.getByText('Configuración').getAttribute('aria-current'), 'page');
    assert.equal(screen.queryByRole('link'), null);
    assert.equal(screen.getByText('DIAN').hasAttribute('aria-current'), false);
  });

  it('pinta un separador entre tramos y ninguno tras el último', () => {
    const { container } = render(h(Breadcrumbs, { items: ['A', 'B', 'C'] }));

    assert.equal(container.querySelectorAll('svg[aria-hidden="true"]').length, 2);
  });
});

describe('TabsNav', () => {
  const TABS = [
    { id: 'all', label: 'Todos', count: 120 },
    { id: 'review', label: 'En revisión', count: 0 },
    { id: 'approved', label: 'Aprobados', count: 7, icon: undefined },
    { id: 'archived', label: 'Archivados' },
  ];

  it('pinta un botón por pestaña', () => {
    render(h(TabsNav, { tabs: TABS, activeTabId: 'all', onTabChange: () => {} }));

    assert.equal(screen.getAllByRole('button').length, 4);
  });

  it('marca solo la activa con aria-current="page"', () => {
    render(h(TabsNav, { tabs: TABS, activeTabId: 'approved', onTabChange: () => {} }));

    const current = screen.getAllByRole('button').filter((tab) => tab.getAttribute('aria-current') === 'page');
    assert.equal(current.length, 1);
    assert.match(current[0].textContent ?? '', /^Aprobados/);
  });

  it('onTabChange recibe el id de la pestaña pulsada', () => {
    const calls: string[] = [];
    render(h(TabsNav, { tabs: TABS, activeTabId: 'all', onTabChange: (id) => calls.push(id) }));

    fireEvent.click(screen.getByRole('button', { name: /Archivados/ }));

    assert.deepEqual(calls, ['archived']);
  });

  it('pinta el contador solo cuando es mayor que cero', () => {
    render(h(TabsNav, { tabs: TABS, activeTabId: 'all', onTabChange: () => {} }));

    assert.equal(screen.getByRole('button', { name: /Aprobados/ }).textContent, 'Aprobados7');
    assert.equal(screen.getByRole('button', { name: /En revisión/ }).textContent, 'En revisión');
    assert.equal(screen.getByRole('button', { name: /Archivados/ }).textContent, 'Archivados');
  });

  it('por encima de 99 el contador es «99+»', () => {
    render(h(TabsNav, { tabs: TABS, activeTabId: 'all', onTabChange: () => {} }));

    assert.equal(screen.getByRole('button', { name: /Todos/ }).textContent, 'Todos99+');
  });

  it('99 exacto se pinta tal cual', () => {
    render(h(TabsNav, { tabs: [{ id: 'a', label: 'A', count: 99 }], activeTabId: 'a', onTabChange: () => {} }));

    assert.equal(screen.getByRole('button').textContent, 'A99');
  });

  it('pinta el icono de la pestaña oculto a lectores de pantalla', () => {
    render(
      h(TabsNav, { tabs: [{ id: 'a', label: 'Equipo', icon: Users }], activeTabId: 'a', onTabChange: () => {} }),
    );

    const icon = screen.getByRole('button').querySelector('svg') as SVGElement;
    assert.equal(icon.getAttribute('aria-hidden'), 'true');
  });
});
