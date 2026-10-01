/**
 * Celdas compartidas de las listas — contrato RUNTIME.
 *
 * El mismo dato se lee igual en todas las tablas: el vacío es una raya apagada,
 * el país lleva bandera y nombre completo, y un enlace externo dice que sale.
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
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let cells: typeof import('../table-cells');
let Globe: (typeof import('@/icons'))['Globe'];

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  cells = await import('../table-cells');
  ({ Globe } = await import('@/icons'));
});

afterEach(() => {
  cleanup();
});

describe('EmptyCell', () => {
  it('pinta una raya apagada y la nombra para el lector de pantalla', () => {
    const { container } = render(h(cells.EmptyCell));

    assert.equal(container.querySelector('[aria-hidden]')?.textContent, '—');
    assert.ok(screen.getByText('Sin dato'));
    assert.ok(container.firstElementChild?.className.includes('text-text-muted'));
  });

  it('acepta decir qué falta', () => {
    render(h(cells.EmptyCell, { label: 'Sin teléfono' }));

    assert.ok(screen.getByText('Sin teléfono'));
  });
});

describe('CountryCell', () => {
  it('muestra la bandera y el nombre completo del país', () => {
    const { container } = render(h(cells.CountryCell, { code: 'CO' }));

    assert.ok(screen.getByText('Colombia'));
    assert.equal(container.querySelector('[aria-hidden]')?.textContent, cells.countryFlag('CO'));
  });

  it('acepta el código en minúsculas', () => {
    render(h(cells.CountryCell, { code: 'mx' }));

    assert.ok(screen.getByText('México'));
  });

  it('un país que no conoce se muestra por su código, con su bandera', () => {
    render(h(cells.CountryCell, { code: 'FR' }));

    assert.ok(screen.getByText('FR'));
  });

  it('sin país pinta el vacío de siempre', () => {
    render(h(cells.CountryCell, { code: null }));

    assert.ok(screen.getByText('Sin país'));
  });
});

describe('countryFlag / countryName / toExternalHref', () => {
  it('countryFlag solo acepta códigos de dos letras', () => {
    assert.equal(cells.countryFlag('Colombia'), '');
    assert.equal(cells.countryFlag(null), '');
    assert.equal([...cells.countryFlag('co')].length, 2);
  });

  it('countryName devuelve null sin código', () => {
    assert.equal(cells.countryName(''), null);
    assert.equal(cells.countryName(undefined), null);
    assert.equal(cells.countryName('pe'), 'Perú');
  });

  it('toExternalHref pone https:// solo si falta el protocolo', () => {
    assert.equal(cells.toExternalHref('acme.co'), 'https://acme.co');
    assert.equal(cells.toExternalHref('http://acme.co'), 'http://acme.co');
    assert.equal(cells.toExternalHref('HTTPS://acme.co'), 'HTTPS://acme.co');
  });
});

describe('ExternalLinkCell / ExternalIconLink', () => {
  it('abre fuera, en pestaña nueva y sin referrer', () => {
    render(h(cells.ExternalLinkCell, { href: 'acme.co', icon: Globe, label: 'Abrir el sitio web de Acme' }, 'acme.co'));

    const link = screen.getByRole('link', { name: /Abrir el sitio web de Acme/ });
    assert.equal(link.getAttribute('href'), 'https://acme.co');
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
    assert.ok(link.className.includes('focus-visible:ring-3'), 'foco visible');
  });

  it('sin texto muestra el propio destino', () => {
    render(h(cells.ExternalLinkCell, { href: 'acme.co' }));

    assert.ok(screen.getByText('acme.co'));
  });

  it('el clic en el enlace no llega a la fila', () => {
    let rowClicks = 0;
    render(
      h(
        'div',
        { onClick: () => { rowClicks += 1; } },
        h(cells.ExternalLinkCell, { href: 'acme.co' }, 'acme.co'),
        h(cells.ExternalIconLink, { href: 'linkedin.com/company/acme', icon: Globe, label: 'Abrir LinkedIn de Acme' }),
      ),
    );

    for (const link of screen.getAllByRole('link')) {
      link.addEventListener('click', (event) => event.preventDefault());
      fireEvent.click(link);
    }
    assert.equal(rowClicks, 0);
  });

  it('el enlace de solo icono tiene nombre accesible', () => {
    render(h(cells.ExternalIconLink, { href: 'linkedin.com/company/acme', icon: Globe, label: 'Abrir LinkedIn de Acme' }));

    const link = screen.getByRole('link', { name: /Abrir LinkedIn de Acme/ });
    assert.equal(link.getAttribute('href'), 'https://linkedin.com/company/acme');
  });
});

describe('RowTitleButton', () => {
  it('abre el detalle sin que el clic llegue a la fila', () => {
    let opened = 0;
    let rowClicks = 0;
    render(
      h(
        'div',
        { onClick: () => { rowClicks += 1; } },
        h(cells.RowTitleButton, { onClick: () => { opened += 1; }, children: 'Acme S.A.S.' }),
      ),
    );

    const button = screen.getByRole('button', { name: 'Acme S.A.S.' });
    fireEvent.click(button);

    assert.equal(opened, 1);
    assert.equal(rowClicks, 0);
    assert.equal(button.getAttribute('title'), 'Acme S.A.S.');
    assert.ok(button.className.includes('truncate'));
  });
});
