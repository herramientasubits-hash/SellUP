/**
 * Catálogo de fuentes — el arrastre de filas, guardando el orden.
 *
 * El catálogo es un registro en código: no hay columna de orden ni acción de
 * servidor que lo guarde. El orden que deja quien arrastra es una preferencia
 * suya, recordada en este navegador (`sellup:source-catalog:order`).
 *
 * Lo que se protege:
 *   - cada fila lleva su asa y el HTML de la tabla sigue siendo válido (ningún
 *     `<div>` entre `<tr>` y `<td>`, aunque la fila tenga menú contextual);
 *   - el orden guardado se aplica al entrar y sobrevive a cambiar de vista;
 *   - reordenar dentro de una vista parcial no descoloca las demás fuentes;
 *   - una fuente nueva conserva su sitio; una clave que ya no existe se ignora;
 *   - «Orden original» lo deshace.
 *
 * (El gesto de arrastre de dnd-kit necesita medidas reales de pantalla y no se
 * puede reproducir en jsdom: se prueba el orden que resulta de soltar.)
 */

import '../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { SourceCatalogViewModel, SourceViewModel } from '@/modules/source-catalog/queries';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];
let SourceCatalogClient: (typeof import('../source-catalog-client'))['SourceCatalogClient'];
let order: typeof import('../source-catalog-order');

const h = React.createElement;

mock.module('../../../../modules/source-catalog/actions', {
  namedExports: {
    getSourceDetailDrawerDataAction: async () => null,
  },
});

function source(overrides: Partial<SourceViewModel> & Pick<SourceViewModel, 'key' | 'name'>): SourceViewModel {
  return {
    countryCodes: ['CO'],
    sectors: [],
    type: 'public_dataset',
    priority: 'high',
    automationLevel: 'high',
    operationalStatus: 'operational_verified',
    url: null,
    recommendedUse: '',
    limitations: [],
    riskNotes: [],
    sellupUse: 'company_discovery',
    aiFlowStatus: 'connected',
    connectionMode: 'api',
    nextAction: 'Nada pendiente',
    ...overrides,
  } as SourceViewModel;
}

// Tres fuentes que usa la IA (dos verificadas, una por conectar) y una de consulta manual.
const SOURCES: SourceViewModel[] = [
  source({ key: 'co_rues', name: 'RUES Colombia' }),
  source({ key: 'mx_denue', name: 'DENUE México', countryCodes: ['MX'] }),
  source({
    key: 'pe_sunat',
    name: 'SUNAT Perú',
    countryCodes: ['PE'],
    operationalStatus: 'connection_required',
    nextAction: 'Cargar la credencial de SUNAT y probar la conexión',
  }),
  source({
    key: 'cl_manual',
    name: 'Directorio manual Chile',
    countryCodes: ['CL'],
    operationalStatus: 'manual_signal_only',
    sellupUse: 'manual_reference',
    aiFlowStatus: 'manual_only',
    connectionMode: 'not_connected',
  }),
];

const VIEW_MODEL = {
  sources: SOURCES,
  filters: {
    countries: ['CL', 'CO', 'MX', 'PE'],
    operationalStatuses: ['connection_required', 'manual_signal_only', 'operational_verified'],
    priorities: ['high'],
    types: ['public_dataset'],
    automationLevels: ['high'],
    sectors: [],
  },
} as unknown as SourceCatalogViewModel;

const NO_BATCHES = { batches: [], totalCount: 0, readyForReview: 0, cancelled: 0, smokeTests: 0 };

function renderCatalog() {
  return render(
    h(SourceCatalogClient, {
      viewModel: VIEW_MODEL,
      latestTests: {},
      socrataBatches: NO_BATCHES,
      statusOverrides: {},
    }),
  );
}

const ORDER_KEY = 'sellup:source-catalog:order';

/** Los nombres de las fuentes, en el orden en que la tabla pinta las filas. */
function rowOrder(): string[] {
  return Array.from(document.querySelectorAll('tbody tr'))
    .map((row) => SOURCES.find((s) => row.textContent?.includes(s.name))?.key)
    .filter((key): key is string => Boolean(key));
}

before(async () => {
  ({ render, screen, fireEvent, cleanup, act } = await import('@testing-library/react'));
  ({ SourceCatalogClient } = await import('../source-catalog-client'));
  order = await import('../source-catalog-order');
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('applySourceOrder / mergeVisibleOrder — el orden que se guarda', () => {
  const rows = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }];
  const keys = (list: { key: string }[]) => list.map((row) => row.key);

  it('sin nada guardado, el orden de fábrica', () => {
    assert.deepEqual(keys(order.applySourceOrder(rows, [])), ['a', 'b', 'c', 'd']);
  });

  it('aplica el orden guardado', () => {
    assert.deepEqual(keys(order.applySourceOrder(rows, ['d', 'c', 'b', 'a'])), ['d', 'c', 'b', 'a']);
  });

  it('una fuente nueva conserva su sitio; una clave que ya no existe se ignora', () => {
    // Se guardó cuando solo existían a, c y «vieja»; b y d son nuevas.
    assert.deepEqual(keys(order.applySourceOrder(rows, ['c', 'vieja', 'a'])), ['c', 'b', 'a', 'd']);
  });

  it('reordenar una vista parcial recoloca solo sus filas, en sus mismos huecos', () => {
    // La vista enseña a, c y d; se suelta d la primera.
    assert.deepEqual(order.mergeVisibleOrder(['a', 'b', 'c', 'd'], ['d', 'a', 'c']), ['d', 'b', 'a', 'c']);
  });

  it('no muta lo que recibe', () => {
    const input = [...rows];
    order.applySourceOrder(input, ['d', 'a']);
    assert.deepEqual(keys(input), ['a', 'b', 'c', 'd']);
  });
});

describe('Catálogo de fuentes — filas que se arrastran', () => {
  it('cada fila lleva su asa de arrastre', () => {
    renderCatalog();

    assert.equal(screen.getAllByRole('button', { name: 'Reordenar fila' }).length, 3);
    assert.deepEqual(rowOrder(), ['co_rues', 'mx_denue', 'pe_sunat']);
  });

  it('🔴 HTML válido con arrastre y menú contextual: nada entre <tbody> y <tr>, ni entre <tr> y <td>', () => {
    renderCatalog();

    assert.equal(document.querySelector('tbody > div'), null);
    assert.equal(document.querySelector('tr > div'), null);
    for (const row of Array.from(document.querySelectorAll('tbody tr'))) {
      assert.equal(row.parentElement?.tagName, 'TBODY');
      assert.ok(Array.from(row.children).every((cell) => cell.tagName === 'TD'));
    }
  });

  it('el orden guardado se aplica al entrar', () => {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(['pe_sunat', 'cl_manual', 'mx_denue', 'co_rues']));
    renderCatalog();

    assert.deepEqual(rowOrder(), ['pe_sunat', 'mx_denue', 'co_rues']);
  });

  it('y vale para todas las vistas', () => {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(['pe_sunat', 'cl_manual', 'mx_denue', 'co_rues']));
    renderCatalog();

    fireEvent.click(screen.getByRole('tab', { name: /Todas/ }));

    assert.deepEqual(rowOrder(), ['pe_sunat', 'cl_manual', 'mx_denue', 'co_rues']);
  });

  it('algo ilegible guardado no rompe la pantalla: orden de fábrica', () => {
    window.localStorage.setItem(ORDER_KEY, '{no es json');
    renderCatalog();

    assert.deepEqual(rowOrder(), ['co_rues', 'mx_denue', 'pe_sunat']);
  });

  it('sin orden propio no se ofrece «Orden original»', () => {
    renderCatalog();
    assert.equal(screen.queryByRole('button', { name: 'Orden original' }), null);
  });

  it('«Orden original» deshace el orden guardado', () => {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(['pe_sunat', 'cl_manual', 'mx_denue', 'co_rues']));
    renderCatalog();

    fireEvent.click(screen.getByRole('button', { name: 'Orden original' }));

    assert.equal(window.localStorage.getItem(ORDER_KEY), null);
    assert.deepEqual(rowOrder(), ['co_rues', 'mx_denue', 'pe_sunat']);
    assert.equal(screen.queryByRole('button', { name: 'Orden original' }), null);
  });
});

describe('useSourceCatalogOrder — se guarda por persona, en este navegador', () => {
  function Probe() {
    const { order: saved, hasCustomOrder, saveOrder, resetOrder } = order.useSourceCatalogOrder();
    return h(
      'div',
      null,
      h('p', { 'data-testid': 'orden' }, saved.join(',')),
      h('p', { 'data-testid': 'propio' }, String(hasCustomOrder)),
      h('button', { type: 'button', onClick: () => saveOrder(['b', 'a']) }, 'Guardar'),
      h('button', { type: 'button', onClick: resetOrder }, 'Restablecer'),
    );
  }

  it('guardar escribe la clave y avisa a quien la lee; restablecer la borra', () => {
    render(h(Probe));
    assert.equal(screen.getByTestId('propio').textContent, 'false');

    act(() => fireEvent.click(screen.getByRole('button', { name: 'Guardar' })));

    assert.equal(window.localStorage.getItem(ORDER_KEY), JSON.stringify(['b', 'a']));
    assert.equal(screen.getByTestId('orden').textContent, 'b,a');
    assert.equal(screen.getByTestId('propio').textContent, 'true');

    act(() => fireEvent.click(screen.getByRole('button', { name: 'Restablecer' })));

    assert.equal(window.localStorage.getItem(ORDER_KEY), null);
    assert.equal(screen.getByTestId('orden').textContent, '');
  });
});
