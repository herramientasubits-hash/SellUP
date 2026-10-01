/**
 * Catálogo de fuentes — contrato RUNTIME de la cabecera de la lista.
 *
 * Lo que se protege:
 *   - las vistas (pestañas) están a la vista con su recuento;
 *   - los conteos por estado son a la vez el filtro rápido de la tabla;
 *   - cambiar de vista suelta el filtro rápido (el estado puede no existir allí).
 *
 * Sin red: la acción de detalle del drawer está sustituida.
 */

import '../../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { SourceCatalogViewModel, SourceViewModel } from '@/modules/source-catalog/queries';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let SourceCatalogClient: (typeof import('../source-catalog-client'))['SourceCatalogClient'];

const h = React.createElement;

mock.module('../../../../../modules/source-catalog/actions', {
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

function chip(name: RegExp): HTMLElement {
  return within(screen.getByRole('radiogroup', { name: 'Filtrar fuentes por estado' })).getByRole('radio', { name });
}

function rowNames(): string[] {
  return SOURCES.map((s) => s.name).filter((name) => screen.queryByText(name) !== null);
}

before(async () => {
  ({ render, screen, within, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ SourceCatalogClient } = await import('../source-catalog-client'));
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('Catálogo de fuentes — vistas', () => {
  it('las tres vistas están a la vista, cada una con su recuento', () => {
    renderCatalog();

    const tabs = within(screen.getByRole('tablist', { name: 'Qué fuentes ver' })).getAllByRole('tab');

    assert.deepEqual(
      tabs.map((tab) => tab.textContent),
      ['Usadas por la IA3', 'De consulta manual1', 'Todas4'],
    );
  });

  it('arranca en «Usadas por la IA» y lista solo esas fuentes', () => {
    renderCatalog();

    assert.deepEqual(rowNames(), ['RUES Colombia', 'DENUE México', 'SUNAT Perú']);
  });

  it('la cabecera no pinta flecha de volver ni migas: es una sección de primer nivel', () => {
    renderCatalog();

    assert.ok(screen.getByRole('heading', { level: 1, name: 'Catálogo de fuentes' }));
    assert.equal(screen.queryByRole('link', { name: 'Volver' }), null);
    assert.equal(screen.queryByRole('navigation', { name: 'Breadcrumb' }), null);
  });
});

describe('Catálogo de fuentes — filtro rápido por estado', () => {
  it('los chips cuentan las fuentes de la vista por estado, con nombres cortos', () => {
    renderCatalog();

    assert.ok(chip(/Todas\s*3/));
    assert.ok(chip(/Verificadas\s*2/));
    assert.ok(chip(/Por conectar\s*1/));
  });

  it('pulsar un chip deja en la tabla solo las fuentes en ese estado', () => {
    renderCatalog();

    fireEvent.click(chip(/Por conectar/));

    assert.deepEqual(rowNames(), ['SUNAT Perú']);
    assert.equal(chip(/Por conectar/).getAttribute('aria-checked'), 'true');
    // El contador de un chip no cambia por pulsarlo.
    assert.ok(chip(/Verificadas\s*2/));
  });

  it('la siguiente acción se lee entera en su fila', () => {
    renderCatalog();

    assert.ok(screen.getByText('Cargar la credencial de SUNAT y probar la conexión'));
  });

  it('cambiar de vista suelta el filtro rápido', () => {
    renderCatalog();
    fireEvent.click(chip(/Por conectar/));

    fireEvent.click(screen.getByRole('tab', { name: /Todas/ }));

    assert.equal(chip(/Todas\s*4/).getAttribute('aria-checked'), 'true');
    assert.deepEqual(rowNames(), SOURCES.map((s) => s.name));
  });
});
