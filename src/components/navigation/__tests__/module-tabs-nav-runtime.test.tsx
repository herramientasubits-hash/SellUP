/**
 * ModuleTabsNav / ContactsModuleTabsNav — contrato RUNTIME.
 *
 * Los módulos «Empresas» y «Contactos» hablan con una sola voz: las pestañas
 * dicen qué son («Empresas», «Por revisar», «Descartadas»), llevan su contador
 * cuando la pantalla lo conoce y navegan a las MISMAS rutas de siempre.
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
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const pushed: string[] = [];
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ push: (href: string) => pushed.push(href), refresh: () => {}, replace: () => {} }),
  },
});

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ModuleTabsNav: (typeof import('../module-tabs-nav'))['ModuleTabsNav'];
let ContactsModuleTabsNav: (typeof import('../contacts-module-tabs-nav'))['ContactsModuleTabsNav'];

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ModuleTabsNav } = await import('../module-tabs-nav'));
  ({ ContactsModuleTabsNav } = await import('../contacts-module-tabs-nav'));
});

beforeEach(() => {
  pushed.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('ModuleTabsNav — módulo Empresas', () => {
  it('las pestañas dicen qué son, sin «Prospectos aprobados» ni «Candidatos»', () => {
    render(h(ModuleTabsNav, { active: 'empresas' }));

    const nav = screen.getByRole('navigation', { name: 'Vistas de empresas' });
    assert.deepEqual(
      Array.from(nav.querySelectorAll('button'), (button) => button.textContent),
      ['Empresas', 'Por revisar', 'Descartadas'],
    );
    assert.equal(screen.queryByText(/Prospectos aprobados/), null);
    assert.equal(screen.queryByText(/Candidatos por revisar/), null);
  });

  it('marca la pestaña activa con aria-current', () => {
    render(h(ModuleTabsNav, { active: 'prospectos' }));

    assert.equal(screen.getByRole('button', { name: /Por revisar/ }).getAttribute('aria-current'), 'page');
    assert.equal(screen.getByRole('button', { name: /^Empresas/ }).getAttribute('aria-current'), null);
  });

  it('pinta el contador de las pestañas que lo reciben', () => {
    render(h(ModuleTabsNav, { active: 'prospectos', counts: { prospectos: 43, descartadas: 7 } }));

    assert.equal(screen.getByRole('button', { name: /Por revisar/ }).textContent, 'Por revisar43');
    assert.equal(screen.getByRole('button', { name: /Descartadas/ }).textContent, 'Descartadas7');
    assert.equal(screen.getByRole('button', { name: /^Empresas/ }).textContent, 'Empresas');
  });

  it('discardedCount sigue valiendo como contador de Descartadas', () => {
    render(h(ModuleTabsNav, { active: 'descartadas', discardedCount: 12 }));

    assert.equal(screen.getByRole('button', { name: /Descartadas/ }).textContent, 'Descartadas12');
  });

  it('navega a las rutas de siempre (los enlaces profundos no cambian)', () => {
    render(h(ModuleTabsNav, { active: 'empresas' }));

    fireEvent.click(screen.getByRole('button', { name: /Por revisar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Descartadas/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Empresas/ }));

    assert.deepEqual(pushed, [
      '/accounts?tab=prospectos',
      '/accounts?tab=prospectos&view=descartadas',
      '/accounts',
    ]);
  });
});

describe('ContactsModuleTabsNav — módulo Contactos', () => {
  it('las pestañas son «Contactos» y «Por revisar»', () => {
    render(h(ContactsModuleTabsNav, { active: 'approved' }));

    const nav = screen.getByRole('navigation', { name: 'Vistas de contactos' });
    assert.deepEqual(
      Array.from(nav.querySelectorAll('button'), (button) => button.textContent),
      ['Contactos', 'Por revisar'],
    );
  });

  it('pinta el contador que recibe y marca la activa', () => {
    render(h(ContactsModuleTabsNav, { active: 'candidates', counts: { candidates: 25 } }));

    const candidates = screen.getByRole('button', { name: /Por revisar/ });
    assert.equal(candidates.textContent, 'Por revisar25');
    assert.equal(candidates.getAttribute('aria-current'), 'page');
  });

  it('navega a las rutas de siempre', () => {
    render(h(ContactsModuleTabsNav, { active: 'approved' }));

    fireEvent.click(screen.getByRole('button', { name: /Por revisar/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Contactos/ }));

    assert.deepEqual(pushed, ['/contacts?tab=candidates', '/contacts']);
  });

  it('en la cola de duplicados ninguna pestaña queda marcada', () => {
    render(h(ContactsModuleTabsNav, { active: 'duplicates' }));

    for (const button of screen.getAllByRole('button')) {
      assert.equal(button.getAttribute('aria-current'), null);
    }
  });
});
