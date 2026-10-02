/**
 * Pipeline · filtros — contrato RUNTIME: un solo botón «Filtros · n» abre el
 * panel con todos los grupos; marcar varios, chips quitables y «Limpiar todo»;
 * la franja de atención y las casillas son el MISMO estado; el tablero aplica
 * los mismos filtros; y el estado viaja a la URL (con el escritor inyectado).
 */

import '../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_PIPELINE_FILTERS,
  applyPipelineFilters,
  parsePipelineFilters,
  type PipelineFilters,
} from '@/modules/pipeline/pipeline-filters';
import type { PipelineOverviewAccount } from '@/modules/pipeline/types';
import { pipelineHref } from '../pipeline-copy';
import { urlWithFilters } from '../pipeline-filter-state';
import { NOW, buildOverview } from './pipeline-fixtures';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let PipelineFilterBar: (typeof import('../pipeline-filters-panel'))['PipelineFilterBar'];
let PipelineJourney: (typeof import('../pipeline-journey'))['PipelineJourney'];
let PipelineBoard: (typeof import('../pipeline-board'))['PipelineBoard'];
let usePipelineUrlFilters: (typeof import('../pipeline-filter-state'))['usePipelineUrlFilters'];

const h = React.createElement;

before(async () => {
  ({ render, screen, within, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ PipelineFilterBar } = await import('../pipeline-filters-panel'));
  ({ PipelineJourney } = await import('../pipeline-journey'));
  ({ PipelineBoard } = await import('../pipeline-board'));
  ({ usePipelineUrlFilters } = await import('../pipeline-filter-state'));
});

afterEach(() => {
  cleanup();
});

/** Las 4 empresas de siempre, con industrias y un país nulo para ver todos los grupos. */
function accounts(): PipelineOverviewAccount[] {
  const [acme, initech, globex, umbrella] = buildOverview().accounts;
  return [
    { ...acme, industry: 'Retail' },
    { ...initech, industry: null, countryCode: null },
    globex,
    { ...umbrella, signals: [{ id: 'corrida_fallida', label: 'Última corrida de contactos falló', severity: 'alert', stageId: 'enriquecimiento' }] },
  ];
}

/** La barra con los filtros en un estado de verdad, y el escritor de URL inyectado. */
function Bar({ items, initial, log }: { items: PipelineOverviewAccount[]; initial?: PipelineFilters; log: PipelineFilters[] }) {
  const [filters, setFilters] = usePipelineUrlFilters(initial ?? EMPTY_PIPELINE_FILTERS, (next) => log.push(next));
  const visible = applyPipelineFilters(items, filters, NOW);
  return h(
    'div',
    null,
    h(PipelineFilterBar, { accounts: items, filters, onChange: setFilters, visibleCount: visible.length }),
    h('p', { 'data-testid': 'visibles' }, visible.map((item) => item.name).join(',')),
  );
}

function renderBar(props: { items?: PipelineOverviewAccount[]; initial?: PipelineFilters } = {}) {
  const log: PipelineFilters[] = [];
  render(h(Bar, { items: props.items ?? accounts(), initial: props.initial, log }));
  return { log };
}

const visibles = () => screen.getByTestId('visibles').textContent;
const openPanel = async () => {
  fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
  await screen.findByRole('region', { name: 'Etapa' });
};
const group = (name: string) => within(screen.getByRole('region', { name }));
const chipLabels = () =>
  Array.from(screen.getByRole('group', { name: 'Filtros activos' }).querySelectorAll('div > span'), (node) => node.textContent);

describe('Pipeline · filtros: un solo botón con todos los grupos', () => {
  it('el botón dice «Filtros» y abre el panel con sus siete grupos, cada uno con título', async () => {
    renderBar();
    assert.ok(screen.getByRole('button', { name: 'Filtros' }));
    await openPanel();

    assert.deepEqual(
      Array.from(document.querySelectorAll('[data-slot="filter-group"] h3'), (title) => title.textContent),
      ['Etapa', 'País', 'Industria', 'Fecha', 'Riesgo por inactividad', 'Fallos de IA', 'Otras señales'],
    );
    // Sin filtros puestos no hay «Limpiar todo» ni chips.
    assert.ok(screen.queryByRole('button', { name: 'Limpiar todo' }) === null);
    assert.ok(screen.queryByRole('group', { name: 'Filtros activos' }) === null);
  });

  it('país: los presentes con bandera, nombre completo y conteo; «Sin país» para los nulos', async () => {
    renderBar();
    await openPanel();
    const items = group('País').getAllByRole('listitem').map((item) => item.textContent);
    assert.equal(items.length, 4);
    assert.ok(items.includes('🇨🇴 Colombia1'));
    assert.ok(items.includes('🇲🇽 México1'));
    assert.equal(items.at(-1), 'Sin país1');
  });

  it('industria: las presentes con conteo y «Sin industria»; con más de 8, trae buscador', async () => {
    renderBar();
    await openPanel();
    assert.deepEqual(
      group('Industria').getAllByRole('listitem').map((item) => item.textContent),
      ['Tecnología2', 'Retail1', 'Sin industria1'],
    );
    assert.ok(group('Industria').queryByRole('textbox') === null);
    cleanup();

    const many = Array.from({ length: 10 }, (_, index) => ({ ...accounts()[0], id: `x${index}`, industry: `Sector ${index}` }));
    renderBar({ items: many });
    await openPanel();
    const search = group('Industria').getByRole('textbox', { name: 'Buscar industria' });
    fireEvent.change(search, { target: { value: 'sector 7' } });
    assert.deepEqual(group('Industria').getAllByRole('listitem').map((item) => item.textContent), ['Sector 71']);
  });

  it('inactividad: umbrales 7 / 14 / 21 y «Sin riesgo», excluyentes', async () => {
    renderBar();
    await openPanel();
    assert.deepEqual(
      group('Riesgo por inactividad').getAllByRole('listitem').map((item) => item.textContent),
      ['7 días o más1', '14 días o más1', '21 días o más1', 'Sin riesgo3'],
    );
    fireEvent.click(group('Riesgo por inactividad').getByRole('checkbox', { name: '7 días o más' }));
    fireEvent.click(group('Riesgo por inactividad').getByRole('checkbox', { name: 'Sin riesgo' }));
    assert.deepEqual(chipLabels(), ['Filtros:', 'Inactividad: sin riesgo']);
    assert.equal(group('Riesgo por inactividad').getByRole('checkbox', { name: '7 días o más' }).getAttribute('aria-checked'), 'false');
    // Volver a pulsar la opción puesta la quita.
    fireEvent.click(group('Riesgo por inactividad').getByRole('checkbox', { name: 'Sin riesgo' }));
    assert.ok(screen.queryByRole('group', { name: 'Filtros activos' }) === null);
  });

  it('fallos de IA: por etapa, y solo el del agente que existe', async () => {
    renderBar();
    await openPanel();
    const failures = group('Fallos de IA');
    assert.ok(failures.getByText('Enriquecimiento'));
    assert.deepEqual(failures.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label')), [
      'Última búsqueda de contactos fallida',
    ]);
    fireEvent.click(failures.getByRole('checkbox'));
    assert.equal(visibles(), 'Umbrella');
    assert.deepEqual(chipLabels(), ['Filtros:', 'Fallo de IA']);
  });

  it('otras señales: las que existen, con conteo', async () => {
    renderBar();
    await openPanel();
    assert.deepEqual(
      group('Otras señales').getAllByRole('listitem').map((item) => item.textContent),
      ['Sin contactos1', 'Sin responsable1', 'Sin sincronizar con HubSpot0', 'Decisor sin teléfono0'],
    );
  });
});

describe('Pipeline · filtros: marcar varios, chips y limpiar', () => {
  it('unión dentro del grupo, intersección entre grupos; el botón y el contador lo dicen', async () => {
    renderBar();
    await openPanel();
    fireEvent.click(group('País').getByRole('checkbox', { name: '🇨🇴 Colombia' }));
    fireEvent.click(group('País').getByRole('checkbox', { name: '🇲🇽 México' }));
    assert.equal(visibles(), 'Acme,Globex');
    fireEvent.click(group('Industria').getByRole('checkbox', { name: 'Tecnología' }));
    assert.equal(visibles(), 'Globex');

    assert.ok(screen.getByRole('button', { name: 'Filtros · 3' }));
    assert.equal(document.querySelector('[data-slot="pipeline-filter-count"]')?.textContent, '1 de 4 empresas');
    assert.deepEqual(chipLabels(), ['Filtros:', 'País: Colombia', 'País: México', 'Industria: Tecnología']);
  });

  it('quitar un chip quita solo ese filtro; «Limpiar todo» (panel o chips) los quita todos', async () => {
    renderBar();
    await openPanel();
    fireEvent.click(group('País').getByRole('checkbox', { name: '🇨🇴 Colombia' }));
    fireEvent.click(group('Industria').getByRole('checkbox', { name: 'Tecnología' }));
    assert.equal(visibles(), '');

    // Con filtros puestos, «Limpiar todo» está en el panel y junto a los chips.
    assert.equal(screen.getAllByRole('button', { name: 'Limpiar todo' }).length, 2);

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Industria: Tecnología' }));
    assert.equal(visibles(), 'Acme');
    assert.deepEqual(chipLabels(), ['Filtros:', 'País: Colombia']);

    fireEvent.click(within(screen.getByRole('group', { name: 'Filtros activos' })).getByRole('button', { name: 'Limpiar todo' }));
    assert.equal(visibles(), 'Acme,Initech,Globex,Umbrella');
    assert.ok(screen.getByRole('button', { name: 'Filtros' }));
  });

  it('fecha: un periodo sobre el último movimiento, o sobre la entrada al pipeline', async () => {
    renderBar();
    await openPanel();
    const dates = group('Fecha');
    assert.equal(dates.getByRole('radio', { name: 'Último movimiento' }).getAttribute('aria-checked'), 'true');
    assert.deepEqual(
      within(dates.getByRole('group', { name: 'Periodo' })).getAllByRole('button').map((button) => button.textContent),
      ['Hoy', 'Últimos 7 días', 'Últimos 30 días', 'Este mes'],
    );

    fireEvent.click(dates.getByRole('button', { name: 'Últimos 7 días' }));
    // Acme lleva 30 días sin moverse: queda fuera.
    assert.equal(visibles(), 'Initech,Globex,Umbrella');
    assert.deepEqual(chipLabels(), ['Filtros:', 'Último movimiento: últimos 7 días']);
    assert.equal(dates.getByRole('button', { name: 'Últimos 7 días' }).getAttribute('aria-pressed'), 'true');

    fireEvent.click(dates.getByRole('radio', { name: 'Entrada al pipeline' }));
    assert.deepEqual(chipLabels(), ['Filtros:', 'Entrada: últimos 7 días']);
    assert.ok(screen.getByRole('button', { name: 'Filtros · 1' }), 'la fecha cuenta como un solo filtro');
  });
});

describe('Pipeline · filtros en la URL', () => {
  it('cada cambio se escribe en la URL con el escritor inyectado', async () => {
    const { log } = renderBar();
    await openPanel();
    fireEvent.click(group('País').getByRole('checkbox', { name: '🇨🇴 Colombia' }));
    fireEvent.click(group('Riesgo por inactividad').getByRole('checkbox', { name: '14 días o más' }));

    assert.equal(log.length, 2);
    assert.deepEqual(log[1], { ...EMPTY_PIPELINE_FILTERS, countries: ['CO'], inactivity: 14 });
    assert.equal(
      urlWithFilters('http://localhost/pipeline?view=tablero&account=acme&pais=MX', log[1]),
      '/pipeline?view=tablero&account=acme&pais=CO&inactividad=14',
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Limpiar todo' }).at(-1) as HTMLElement);
    assert.equal(urlWithFilters('http://localhost/pipeline?account=acme&pais=CO&inactividad=14', log[2]), '/pipeline?account=acme');
  });

  it('lo que viene en la URL arranca puesto: chips, contador y casillas', async () => {
    renderBar({ initial: parsePipelineFilters({ pais: 'CO,MX', senal: 'sin_contactos' }) });
    assert.ok(screen.getByRole('button', { name: 'Filtros · 3' }));
    assert.deepEqual(chipLabels(), ['Filtros:', 'País: Colombia', 'País: México', 'Señal: Sin contactos']);
    assert.equal(visibles(), 'Acme');
    await openPanel();
    assert.equal(group('País').getByRole('checkbox', { name: '🇲🇽 México' }).getAttribute('aria-checked'), 'true');
  });

  it('los filtros viajan al elegir empresa y al cambiar de vista, junto a view y account', () => {
    const filters = { ...EMPTY_PIPELINE_FILTERS, stages: ['inteligencia' as const], aiFailures: ['corrida_fallida' as const] };
    assert.equal(pipelineHref('recorrido', 'globex', filters), '/pipeline?account=globex&etapa=inteligencia&fallo=1');
    assert.equal(pipelineHref('tablero', null, filters), '/pipeline?view=tablero&etapa=inteligencia&fallo=1');
    assert.equal(pipelineHref('recorrido', null, EMPTY_PIPELINE_FILTERS), '/pipeline');
  });
});

describe('Pipeline · la franja de atención y las casillas son el mismo estado', () => {
  function Journey({ log }: { log: PipelineFilters[] }) {
    const [filters, setFilters] = usePipelineUrlFilters(EMPTY_PIPELINE_FILTERS, (next) => log.push(next));
    return h(PipelineJourney, {
      overview: buildOverview(),
      selectedAccountId: null,
      journey: null,
      onSelectAccount: () => {},
      filters,
      onFiltersChange: setFilters,
      now: NOW,
    });
  }

  it('pulsar «Sin contactos» en la franja marca su casilla, pone su chip y lo lleva a la URL', async () => {
    const log: PipelineFilters[] = [];
    render(h(Journey, { log }));
    assert.ok(document.querySelector('[data-slot="pipeline-overview-unfiltered"]') === null);

    const strip = within(screen.getByRole('group', { name: 'Empresas que requieren atención' }));
    fireEvent.click(strip.getByRole('button', { name: /Sin contactos/ }));

    assert.deepEqual(log.at(-1)?.signals, ['sin_contactos']);
    assert.deepEqual(chipLabels(), ['Filtros:', 'Señal: Sin contactos']);
    assert.equal(strip.getByRole('button', { name: /Sin contactos/ }).getAttribute('aria-pressed'), 'true');
    await openPanel();
    assert.equal(group('Otras señales').getByRole('checkbox', { name: 'Sin contactos' }).getAttribute('aria-checked'), 'true');

    // Y al revés: desmarcar la casilla apaga el motivo de la franja.
    fireEvent.click(group('Otras señales').getByRole('checkbox', { name: 'Sin contactos' }));
    assert.equal(strip.getByRole('button', { name: /Sin contactos/ }).getAttribute('aria-pressed'), 'false');
  });

  it('el resumen no se filtra, y lo dice cuando hay filtros puestos', async () => {
    render(h(Journey, { log: [] }));
    await openPanel();
    fireEvent.click(group('Etapa').getByRole('checkbox', { name: 'Preparación' }));

    assert.equal(
      document.querySelector('[data-slot="pipeline-overview-unfiltered"]')?.textContent,
      'El resumen muestra todas las empresas; los filtros aplican a la lista.',
    );
    // La lista se filtra; las cifras del resumen siguen siendo las del pipeline entero.
    assert.equal(document.querySelector('[data-slot="pipeline-filter-count"]')?.textContent, '1 de 4 empresas');
    assert.ok(within(screen.getByRole('region', { name: 'Resumen del pipeline' })).getByText('2 empresas requieren atención'));
  });
});

describe('Pipeline · el tablero aplica los mismos filtros', () => {
  const cardsIn = (name: string) =>
    Array.from(
      screen.getByRole('region', { name }).querySelectorAll('[data-slot="kanban-card"]'),
      (node) => node.getAttribute('aria-label'),
    );

  it('la misma barra encima del tablero filtra sus tarjetas', async () => {
    const changes: PipelineFilters[] = [];
    function Board() {
      const [filters, setFilters] = usePipelineUrlFilters(EMPTY_PIPELINE_FILTERS, (next) => changes.push(next));
      return h(PipelineBoard, {
        accounts: buildOverview().accounts,
        onMoveAccount: async () => ({ success: true as const }),
        filters,
        onFiltersChange: setFilters,
        now: NOW,
      });
    }
    render(h(Board));
    assert.deepEqual(cardsIn('Nuevas'), ['Acme']);
    assert.deepEqual(cardsIn('Listas para contacto'), ['Umbrella']);

    await openPanel();
    fireEvent.click(group('Etapa').getByRole('checkbox', { name: 'Preparación' }));
    assert.deepEqual(cardsIn('Nuevas'), []);
    assert.deepEqual(cardsIn('Listas para contacto'), ['Umbrella']);
    assert.equal(document.querySelector('[data-slot="pipeline-filter-count"]')?.textContent, '1 de 4 empresas');
    assert.deepEqual(changes.at(-1)?.stages, ['preparacion']);
  });

  it('con filtros en la URL, el tablero arranca filtrado', () => {
    render(
      h(PipelineBoard, {
        accounts: buildOverview().accounts,
        onMoveAccount: async () => ({ success: true as const }),
        filters: parsePipelineFilters({ etapa: 'inteligencia' }),
        onFiltersChange: () => {},
        now: NOW,
      }),
    );
    assert.deepEqual(cardsIn('Nuevas'), []);
    assert.deepEqual(cardsIn('Listas para investigar'), ['Globex']);
    assert.deepEqual(cardsIn('Investigación en curso'), ['Initech']);
  });
});
