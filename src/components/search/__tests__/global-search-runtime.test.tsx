/**
 * GlobalSearch (Thema `search/GlobalSearch`) — contrato RUNTIME: pestañas de
 * alcance, recuento, grupos, registros pedidos en diferido y teclado.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const pushed: string[] = [];
mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ push: (href: string) => pushed.push(href), replace: () => {}, refresh: () => {} }),
  },
});

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let GlobalSearch: (typeof import('../global-search'))['GlobalSearch'];

type SearchObjectItem = import('../global-search').SearchObjectItem;

const h = React.createElement;

const NAVIGATE = [
  { id: 'accounts', label: 'Empresas', href: '/accounts' },
  { id: 'contacts', label: 'Contactos', href: '/contacts' },
  { id: 'users', label: 'Usuarios y acceso', href: '/settings/users', section: 'Configuración', keywords: ['roles'] },
];

const OBJECTS: SearchObjectItem[] = [
  { id: 'a1', title: 'Acme Logística', meta: ['Transporte', 'Colombia'], keywords: ['acme.co'], group: 'Empresas', href: '/accounts/a1' },
  { id: 'a2', title: 'Globex', meta: ['Tecnología'], group: 'Empresas', href: '/accounts/a2' },
  { id: 'c1', title: 'Ana Acosta', meta: ['Gerente', 'Acme Logística'], group: 'Contactos', href: '/contacts/c1' },
];

let loadCalls = 0;
const loadObjects = async () => {
  loadCalls += 1;
  return OBJECTS;
};

function open(props: Partial<React.ComponentProps<typeof GlobalSearch>> = {}): HTMLElement {
  render(h(GlobalSearch, { navigate: NAVIGATE, ...props }));
  fireEvent.click(screen.getByRole('button', { name: 'Abrir la búsqueda general' }));
  return screen.getByRole('dialog');
}

const input = () => screen.getByRole('combobox') as HTMLInputElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const tabs = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
const selectedTab = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent;
const count = () => document.querySelector('[data-slot="search-count"]')?.textContent;
const options = () => screen.queryAllByRole('option').map((option) => option.getAttribute('aria-label'));
const headings = () => Array.from(document.querySelectorAll('[cmdk-group-heading]'), (node) => node.textContent);

before(async () => {
  // cmdk despacha su selección con `new Event(...)`: tiene que ser el Event
  // de jsdom, no el de Node, para que el nodo lo acepte.
  Object.defineProperty(globalThis, 'Event', { value: window.Event, writable: true, configurable: true });
  ({ render, screen, within, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ GlobalSearch } = await import('../global-search'));
});

beforeEach(() => {
  pushed.length = 0;
  loadCalls = 0;
});

afterEach(() => {
  cleanup();
});

describe('GlobalSearch — alcance', () => {
  it('solo ofrece las pestañas de lo que existe', () => {
    open();
    assert.deepEqual(tabs(), ['Todo', 'Ir a']);
    cleanup();

    open({ loadObjects });
    assert.deepEqual(tabs(), ['Todo', 'Ir a', 'Objetos']);
    cleanup();

    open({ loadObjects, onAsk: () => {} });
    assert.deepEqual(tabs(), ['Todo', 'Ir a', 'Objetos', 'Preguntar']);
  });

  it('abre con todos los destinos y su recuento', () => {
    open();
    assert.equal(count(), '3 resultados');
    assert.deepEqual(options(), ['Empresas', 'Contactos', 'Configuración, Usuarios y acceso']);
  });

  it('filtra sin tildes y por palabras clave', () => {
    open();
    type('configuracion roles');
    assert.equal(count(), '1 resultado');
    assert.deepEqual(options(), ['Configuración, Usuarios y acceso']);
    type('zzz');
    assert.equal(count(), '0 resultados');
    assert.ok(screen.getByText('Nada que coincida con «zzz».'));
  });
});

describe('GlobalSearch — registros', () => {
  it('no pide registros hasta que se escribe; luego los pide una sola vez', async () => {
    open({ loadObjects });
    assert.equal(loadCalls, 0);
    type('a');
    assert.equal(loadCalls, 0);
    type('ac');
    await waitFor(() => assert.equal(loadCalls, 1));
    type('acm');
    type('acme');
    await waitFor(() => assert.ok(screen.getByRole('option', { name: /Acme Logística, Transporte/ })));
    assert.equal(loadCalls, 1);
  });

  it('agrupa por tipo de registro y cuenta junto con los destinos', async () => {
    open({ loadObjects });
    type('ac');
    await waitFor(() => assert.deepEqual(headings(), ['Empresas', 'Contactos', 'Ir a']));
    assert.deepEqual(options(), [
      'Acme Logística, Transporte, Colombia',
      'Ana Acosta, Gerente, Acme Logística',
      'Contactos',
      'Configuración, Usuarios y acceso',
    ]);
    assert.equal(count(), '4 resultados');
  });

  it('la pestaña «Objetos» deja solo los registros', async () => {
    open({ loadObjects });
    type('acme');
    await waitFor(() => assert.ok(screen.getByRole('option', { name: /Ana Acosta/ })));
    fireEvent.click(screen.getByRole('tab', { name: 'Objetos' }));
    assert.deepEqual(headings(), ['Empresas', 'Contactos']);
    assert.equal(count(), '2 resultados');
  });

  it('encuentra por un término que no se muestra y abre el registro', async () => {
    open({ loadObjects });
    type('acme.co');
    const row = await screen.findByRole('option', { name: /Acme Logística/ });
    fireEvent.click(row);
    assert.deepEqual(pushed, ['/accounts/a1']);
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  });

  it('mientras llegan, avisa de que está buscando', async () => {
    let release: (items: SearchObjectItem[]) => void = () => {};
    const pending = () => new Promise<SearchObjectItem[]>((resolve) => { release = resolve; });
    open({ loadObjects: pending });
    fireEvent.click(screen.getByRole('tab', { name: 'Objetos' }));
    assert.ok(screen.getByText('Escribe al menos dos letras para buscar registros.'));
    type('glo');
    await waitFor(() => assert.equal(count(), 'Buscando…'));
    assert.ok(document.querySelector('[data-slot="search-objects-loading"]'));
    release(OBJECTS);
    await waitFor(() => assert.deepEqual(options(), ['Globex, Tecnología']));
  });

  it('si la carga falla lo dice, y los destinos siguen funcionando', async () => {
    open({ loadObjects: async () => { throw new Error('boom'); } });
    type('emp');
    await waitFor(() => assert.ok(screen.getByRole('alert')));
    assert.deepEqual(options(), ['Empresas']);
  });
});

describe('GlobalSearch — teclado', () => {
  it('⌘K abre y cierra', () => {
    render(h(GlobalSearch, { navigate: NAVIGATE }));
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    assert.ok(screen.getByRole('dialog'));
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    return waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  });

  it('⇥ cambia de alcance sin sacar el foco del campo', () => {
    open({ loadObjects });
    assert.equal(selectedTab(), 'Todo');
    fireEvent.keyDown(input(), { key: 'Tab' });
    assert.equal(selectedTab(), 'Ir a');
    fireEvent.keyDown(input(), { key: 'Tab' });
    assert.equal(selectedTab(), 'Objetos');
    fireEvent.keyDown(input(), { key: 'Tab' });
    assert.equal(selectedTab(), 'Todo');
    fireEvent.keyDown(input(), { key: 'Tab', shiftKey: true });
    assert.equal(selectedTab(), 'Objetos');
  });

  it('↓ y ↵ abren el resultado señalado', async () => {
    const dialog = open();
    const selected = () => within(dialog).getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true');
    await waitFor(() => assert.equal(selected()?.getAttribute('aria-label'), 'Empresas'));
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    await waitFor(() => assert.equal(selected()?.getAttribute('aria-label'), 'Contactos'));
    fireEvent.keyDown(input(), { key: 'Enter' });
    assert.deepEqual(pushed, ['/contacts']);
  });

  it('con agente, lo escrito se puede preguntar', () => {
    const asked: string[] = [];
    open({ onAsk: (question: string) => asked.push(question), askHint: 'Responde en el chat.' });
    type('cuántas empresas hay');
    fireEvent.click(screen.getByRole('tab', { name: 'Preguntar' }));
    assert.equal(count(), '1 resultado');
    fireEvent.click(screen.getByRole('option', { name: 'Preguntar: cuántas empresas hay' }));
    assert.deepEqual(asked, ['cuántas empresas hay']);
  });
});
