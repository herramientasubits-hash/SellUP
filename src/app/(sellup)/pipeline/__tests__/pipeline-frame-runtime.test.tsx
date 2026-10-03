/**
 * Pipeline · marco de la pantalla — contrato RUNTIME: la cabecera es la banda
 * compacta de Empresas y Contactos (título, descripción al lado y las dos
 * vistas a la derecha, sin `PageHeader` de dos líneas), las migas enlazan de
 * vuelta al resumen cuando hay una empresa elegida, y el esqueleto de carga
 * tiene la misma cabecera y la misma forma (lista + recorrido) que la pantalla.
 */

import '../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { mainNavItems } from '@/config/navigation';
import { PIPELINE_CRUMB_LABEL, pipelineHref } from '../pipeline-copy';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let AppRouterContext: typeof import('next/dist/shared/lib/app-router-context.shared-runtime')['AppRouterContext'];
let PipelineFrame: (typeof import('../pipeline-frame'))['PipelineFrame'];
let pipelineCrumbs: (typeof import('../pipeline-frame'))['pipelineCrumbs'];
let PipelineSkeleton: (typeof import('../pipeline-skeleton'))['PipelineSkeleton'];

const h = React.createElement;

const pushes: string[] = [];
const routerStub = {
  push: (href: string) => pushes.push(href),
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
} as unknown as import('next/dist/shared/lib/app-router-context.shared-runtime').AppRouterInstance;

before(async () => {
  ({ render, screen, within, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime'));
  ({ PipelineFrame, pipelineCrumbs } = await import('../pipeline-frame'));
  ({ PipelineSkeleton } = await import('../pipeline-skeleton'));
});

afterEach(() => {
  cleanup();
  pushes.length = 0;
});

const inRouter = (node: React.ReactElement) => h(AppRouterContext.Provider, { value: routerStub }, node);

describe('Pipeline · cabecera como Empresas y Contactos', () => {
  it('título, descripción y vistas comparten una sola banda compacta', () => {
    render(inRouter(h(PipelineFrame, { view: 'recorrido', accountId: null }, h('div', null, 'contenido'))));

    const band = document.querySelector('[data-slot="page-header-compact"]') as HTMLElement;
    assert.ok(band, 'debe usar la cabecera compacta de DataTablePage');
    assert.equal(within(band).getByRole('heading', { level: 1 }).textContent, 'Pipeline');
    assert.match(band.textContent ?? '', /En qué etapa del proceso de venta está cada empresa/);
    assert.ok(within(band).getByRole('button', { name: 'Recorrido' }));
    assert.ok(within(band).getByRole('button', { name: 'Tablero' }));
    // Nada de la cabecera alta de dos líneas.
    assert.ok(document.querySelector('header[data-width]') === null);
    assert.ok(screen.getByText('contenido'));
  });

  it('la vista puesta es la activa y las vistas navegan (no son un tablist)', () => {
    render(inRouter(h(PipelineFrame, { view: 'tablero', accountId: null }, null)));

    assert.equal(screen.getByRole('button', { name: 'Tablero' }).getAttribute('aria-current'), 'page');
    assert.equal(screen.getByRole('button', { name: 'Recorrido' }).getAttribute('aria-current'), null);
    assert.ok(screen.queryByRole('tablist') === null);
  });

  it('sin quien lleve la navegación, la propia tira navega con la vista en la URL', () => {
    render(inRouter(h(PipelineFrame, { view: 'recorrido', accountId: 'globex' }, null)));

    fireEvent.click(screen.getByRole('button', { name: 'Tablero' }));
    assert.deepEqual(pushes, ['/pipeline?view=tablero']);
  });

  it('con quien lleve la navegación (la pantalla), la avisa y no navega sola', () => {
    const views: string[] = [];
    render(inRouter(h(PipelineFrame, { view: 'recorrido', accountId: null, onViewChange: (v: string) => views.push(v) }, null)));

    fireEvent.click(screen.getByRole('button', { name: 'Tablero' }));
    assert.deepEqual(views, ['tablero']);
    assert.deepEqual(pushes, []);
  });

  it('volver al recorrido conserva la empresa elegida; el tablero no lleva ninguna', () => {
    assert.equal(pipelineHref('recorrido', 'globex'), '/pipeline?account=globex');
    assert.equal(pipelineHref('tablero', null), '/pipeline?view=tablero');
  });
});

describe('Pipeline · migas', () => {
  it('el primer tramo se llama como el módulo en el menú lateral, para que la cabecera no lo repita', () => {
    const navItem = mainNavItems.find((item) => item.href === '/pipeline');
    assert.equal(PIPELINE_CRUMB_LABEL, navItem?.title);
  });

  it('sin empresa es la página actual; con empresa, el tramo enlaza de vuelta a /pipeline', () => {
    assert.deepEqual(pipelineCrumbs(null), [PIPELINE_CRUMB_LABEL]);
    assert.deepEqual(pipelineCrumbs('globex', 'Globex'), [{ label: PIPELINE_CRUMB_LABEL, href: '/pipeline' }, 'Globex']);
    assert.deepEqual(pipelineCrumbs('globex'), [{ label: PIPELINE_CRUMB_LABEL, href: '/pipeline' }, 'Empresa']);
  });

  it('las migas se pintan como enlace solo cuando hay una empresa elegida', () => {
    render(inRouter(h(PipelineFrame, { view: 'recorrido', accountId: 'globex', accountName: 'Globex' }, null)));
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    assert.equal(within(nav).getByRole('link', { name: PIPELINE_CRUMB_LABEL }).getAttribute('href'), '/pipeline');
    assert.equal(within(nav).getByText('Globex').getAttribute('aria-current'), 'page');

    cleanup();
    render(inRouter(h(PipelineFrame, { view: 'recorrido', accountId: null }, null)));
    assert.ok(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).queryByRole('link') === null);
  });
});

describe('Pipeline · esqueleto de carga', () => {
  it('lleva la misma cabecera real y la forma de la pantalla: lista y recorrido', () => {
    render(inRouter(h(PipelineSkeleton, { view: 'recorrido', accountId: null })));

    const band = document.querySelector('[data-slot="page-header-compact"]') as HTMLElement;
    assert.equal(within(band).getByRole('heading', { level: 1 }).textContent, 'Pipeline');
    assert.ok(within(band).getByRole('button', { name: 'Recorrido' }));
    assert.ok(within(band).getByRole('button', { name: 'Tablero' }));
    // Misma rejilla que la pantalla: lista a 340px y recorrido a la derecha, y la página es la que se desplaza.
    const grid = document.querySelector('[class*="lg:grid-cols-[21.25rem_minmax(0,1fr)]"]') as HTMLElement;
    assert.ok(grid, 'misma rejilla que PipelineJourney');
    assert.match(grid.className, /lg:items-start/);
    assert.doesNotMatch(grid.className, /lg:grid-rows|lg:min-h-0/);
    assert.ok(screen.getByRole('status', { name: 'Cargando el recorrido de la empresa' }));
  });

  it('el esqueleto del tablero pinta sus cuatro columnas', () => {
    render(inRouter(h(PipelineSkeleton, { view: 'tablero', accountId: null })));

    assert.ok(screen.getByRole('status', { name: 'Cargando el tablero' }));
    assert.equal(screen.getByRole('button', { name: 'Tablero' }).getAttribute('aria-current'), 'page');
  });
});
