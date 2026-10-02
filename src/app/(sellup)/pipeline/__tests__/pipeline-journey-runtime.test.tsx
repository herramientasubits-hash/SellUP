/**
 * Pipeline · vista «Recorrido» — contrato RUNTIME: el panel de empresas (resumen
 * fijo, buscador, filtro de etapas de selección múltiple y su selección); el
 * resumen sin empresa elegida; el recorrido con
 * las ocho etapas y la pista; la etapa disponible sin empezar como invitación a
 * activarla; y en pantalla estrecha, lista → recorrido → volver. (Las acciones
 * de pantalla —«Cambiar etapa», «Ver empresa», el agente— se prueban en
 * `pipeline-screen-actions-runtime.test.tsx`.)
 */

import '../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEmptyOverview,
  buildJourney,
  buildManualJourney,
  buildOverview,
  buildProspectOnlyJourney,
  NOW,
} from './pipeline-fixtures';
import { pipelineHref, resolvePipelineView } from '../pipeline-copy';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let PipelineJourney: (typeof import('../pipeline-journey'))['PipelineJourney'];

type Props = React.ComponentProps<(typeof import('../pipeline-journey'))['PipelineJourney']>;

const h = React.createElement;

before(async () => {
  ({ render, screen, within, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ PipelineJourney } = await import('../pipeline-journey'));
});

afterEach(() => {
  cleanup();
});

function renderJourney(props: Partial<Props> = {}) {
  const selections: Array<string | null> = [];
  const utils = render(
    h(PipelineJourney, {
      overview: buildOverview(),
      selectedAccountId: null,
      journey: null,
      onSelectAccount: (id: string | null) => selections.push(id),
      now: NOW,
      ...props,
    }),
  );
  return { ...utils, selections };
}

const listNames = () =>
  Array.from(
    screen.getByRole('list', { name: 'Empresas del pipeline' }).querySelectorAll('[data-slot="list-item"]'),
    (row) => row.querySelector('[data-slot="list-item-trigger"] .font-medium')?.textContent,
  );

describe('Pipeline · URL', () => {
  it('la vista por defecto es el recorrido y no ensucia la URL', () => {
    assert.equal(resolvePipelineView(undefined), 'recorrido');
    assert.equal(resolvePipelineView('otra'), 'recorrido');
    assert.equal(resolvePipelineView('tablero'), 'tablero');
    assert.equal(pipelineHref('recorrido', null), '/pipeline');
    assert.equal(pipelineHref('recorrido', 'acme'), '/pipeline?account=acme');
    assert.equal(pipelineHref('tablero', null), '/pipeline?view=tablero');
  });
});

describe('Pipeline · lista de empresas', () => {
  it('lista todas las empresas, con la que tiene señal crítica primero', () => {
    renderJourney();
    assert.deepEqual(listNames(), ['Acme', 'Initech', 'Globex', 'Umbrella']);
  });

  it('cada fila dice país, último movimiento y etapa actual; y marca la que requiere atención', () => {
    renderJourney();
    const rows = screen.getByRole('list', { name: 'Empresas del pipeline' }).querySelectorAll('[data-slot="list-item"]');
    const acme = within(rows[0] as HTMLElement);
    assert.ok(acme.getByText(/Colombia · hace 30 días/));
    assert.ok(acme.getByText('Enriquecimiento'));
    assert.ok(acme.getByRole('img', { name: 'Requiere atención' }));
    const umbrella = within(rows[3] as HTMLElement);
    assert.ok(umbrella.getByText(/Chile · hace 1 día/));
    assert.ok(umbrella.getByText('Preparación'));
    assert.ok(umbrella.queryByRole('img', { name: 'Requiere atención' }) === null);
  });

  it('el buscador filtra por nombre y por dominio', () => {
    renderJourney();
    const search = screen.getByRole('searchbox', { name: 'Buscar empresa por nombre o dominio' });
    fireEvent.change(search, { target: { value: 'glob' } });
    assert.deepEqual(listNames(), ['Globex']);
    fireEvent.change(search, { target: { value: 'initech.pe' } });
    assert.deepEqual(listNames(), ['Initech']);
    fireEvent.change(search, { target: { value: 'nadie' } });
    assert.ok(screen.getByText('Ninguna empresa coincide'));
  });

  const openFilters = () => {
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    return screen.findByRole('list', { name: 'Filtrar por etapa' });
  };

  it('un solo botón «Filtros» abre el panel; el grupo Etapa trae las 8 etapas con su contador (0 apagadas pero elegibles)', async () => {
    renderJourney();
    assert.ok(screen.queryByRole('radiogroup', { name: 'Filtrar por etapa actual' }) === null, 'ya no hay chips en rejilla');
    assert.ok(screen.queryByRole('button', { name: /^Etapa/ }) === null, 'un solo botón de filtros');
    const options = within(await openFilters()).getAllByRole('listitem');
    assert.deepEqual(
      options.map((option) => option.textContent),
      ['Prospección0', 'Enriquecimiento1', 'Inteligencia2', 'Preparación1', 'Reunión0', 'Cotización0', 'Venta interna0', 'Cierre0'],
    );
    const empty = within(options[4]).getByRole('checkbox', { name: 'Reunión' });
    assert.equal((empty as HTMLButtonElement).disabled, false);
    assert.match(options[4].querySelector('span')?.className ?? '', /text-text-muted/);
  });

  it('marcar varias etapas es una unión; el botón cuenta, hay chips quitables y «Limpiar todo»', async () => {
    renderJourney();
    const list = within(await openFilters());
    fireEvent.click(list.getByRole('checkbox', { name: 'Enriquecimiento' }));
    fireEvent.click(list.getByRole('checkbox', { name: 'Preparación' }));
    assert.deepEqual(listNames(), ['Acme', 'Umbrella']);
    assert.ok(screen.getByRole('button', { name: 'Filtros · 2' }));
    assert.equal(document.querySelector('[data-slot="pipeline-filter-count"]')?.textContent, '2 de 4 empresas');
    const chips = within(screen.getByRole('group', { name: 'Filtros activos' }));
    assert.ok(chips.getByText('Etapa: Enriquecimiento'));
    assert.ok(chips.getByText('Etapa: Preparación'));

    // Una etapa a la que ninguna empresa ha llegado se puede marcar: no suma ni quita empresas.
    fireEvent.click(list.getByRole('checkbox', { name: 'Reunión' }));
    assert.deepEqual(listNames(), ['Acme', 'Umbrella']);

    fireEvent.click(within(screen.getByRole('group', { name: 'Filtros activos' })).getByRole('button', { name: 'Limpiar todo' }));
    assert.equal(listNames().length, 4);
    assert.ok(screen.getByRole('button', { name: 'Filtros' }));
    assert.ok(screen.queryByRole('group', { name: 'Filtros activos' }) === null);
    assert.equal(document.querySelector('[data-slot="pipeline-filter-count"]')?.textContent, '4 empresas');
  });

  it('un chip se quita de uno en uno', async () => {
    renderJourney();
    const list = within(await openFilters());
    fireEvent.click(list.getByRole('checkbox', { name: 'Inteligencia' }));
    fireEvent.click(list.getByRole('checkbox', { name: 'Preparación' }));
    assert.deepEqual(listNames(), ['Initech', 'Globex', 'Umbrella']);

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Etapa: Inteligencia' }));
    assert.deepEqual(listNames(), ['Umbrella']);
    assert.ok(screen.getByRole('button', { name: 'Filtros · 1' }));
  });

  it('pulsar una empresa la elige (quien monta la vista la lleva a ?account=)', () => {
    const { selections } = renderJourney();
    fireEvent.click(screen.getByRole('button', { name: /Globex/ }));
    assert.deepEqual(selections, ['globex']);
  });

  it('la empresa de la URL sale marcada como elegida', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    const row = screen.getByRole('list', { name: 'Empresas del pipeline' }).querySelector('[data-selected]');
    assert.ok(row?.textContent?.includes('Globex'));
  });
});

describe('Pipeline · volver al resumen en escritorio', () => {
  it('«Resumen del pipeline» va fijo arriba del panel y está resaltado sin empresa elegida', () => {
    renderJourney();
    const entry = screen.getByRole('button', { name: /Resumen del pipeline/ });
    assert.ok(entry.closest('[data-slot="list-item"]')?.hasAttribute('data-selected'));
    assert.ok(within(entry).getByText('4 empresas · 2 requieren atención'));
    // Solo existe en escritorio: en móvil se llega al resumen con «Volver».
    assert.match(screen.getByRole('list', { name: 'Resumen' }).className, /\bhidden\b.*lg:flex/);
  });

  it('con una empresa elegida deja de estar resaltado y pulsarlo deselecciona', () => {
    const { selections } = renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    const entry = screen.getByRole('button', { name: /Resumen del pipeline/ });
    assert.equal(entry.closest('[data-slot="list-item"]')?.hasAttribute('data-selected'), false);
    fireEvent.click(entry);
    assert.deepEqual(selections, [null]);
  });

  it('pulsar la empresa ya elegida también deselecciona; otra empresa la elige', () => {
    const { selections } = renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    fireEvent.click(screen.getByRole('button', { name: /Globex/ }));
    fireEvent.click(screen.getByRole('button', { name: /Umbrella/ }));
    assert.deepEqual(selections, [null, 'umbrella']);
  });
});

describe('Pipeline · resumen sin empresa elegida', () => {
  it('enseña las 8 etapas del proceso, en orden: con su conteo, o apagadas y con el motivo si no hay ninguna', () => {
    renderJourney();
    const summary = within(screen.getByRole('region', { name: 'Resumen del pipeline' }));
    const cards = within(summary.getByRole('list', { name: 'Empresas por etapa' })).getAllByRole('listitem');
    assert.deepEqual(
      cards.map((card) => card.textContent),
      [
        '1. Prospección0Etapa de entrada, ya superada',
        '2. Enriquecimiento1empresa en esta etapa',
        '3. Inteligencia2empresas en esta etapa',
        '4. Preparación1empresa en esta etapa',
        '5. Reunión0Próximamente',
        '6. Cotización0Próximamente',
        '7. Venta interna0Próximamente',
        '8. Cierre0Próximamente',
      ],
    );
    // Las vacías se marcan como tales (salen apagadas); las que tienen empresas, no.
    assert.deepEqual(
      cards.map((card) => card.getAttribute('data-empty')),
      ['true', null, null, null, 'true', 'true', 'true', 'true'],
    );
    // El reparto solo dibuja las etapas con empresas.
    assert.ok(summary.getByRole('img', { name: /Enriquecimiento de contactos: 1, Inteligencia de cuenta: 2, Preparación y contacto: 1/ }));
  });

  it('«Archivadas» es un total aparte y las etapas futuras se explican en una línea', () => {
    renderJourney();
    const summary = within(screen.getByRole('region', { name: 'Resumen del pipeline' }));
    assert.equal(summary.queryByText('Archivadas', { selector: 'p' }), null);
    assert.ok(summary.getByText(/fuera del pipeline, no cuentan en las etapas/));
    assert.ok(summary.getByText('Las etapas de Reunión a Cierre se activarán cuando existan sus agentes.'));
  });

  it('dice cuántas requieren atención y cada motivo filtra la lista', () => {
    renderJourney();
    const strip = within(screen.getByRole('group', { name: 'Empresas que requieren atención' }));
    assert.ok(strip.getByText('2 empresas requieren atención'));
    const noOwner = strip.getByRole('button', { name: /Sin responsable/ });
    assert.equal(noOwner.getAttribute('aria-pressed'), 'false');
    fireEvent.click(noOwner);
    assert.deepEqual(listNames(), ['Initech']);
    assert.equal(strip.getByRole('button', { name: /Sin responsable/ }).getAttribute('aria-pressed'), 'true');
    // Se ve como chip activo y se quita igual que un filtro de etapa.
    const chips = within(screen.getByRole('group', { name: 'Filtros activos' }));
    assert.ok(chips.getByText('Señal: Sin responsable'));
    fireEvent.click(chips.getByRole('button', { name: 'Eliminar Señal: Sin responsable' }));
    assert.equal(listNames().length, 4);
    assert.equal(screen.queryByRole('group', { name: 'Filtros activos' }), null);
  });

  it('el filtro por señal convive con el de etapa', async () => {
    renderJourney();
    fireEvent.click(within(screen.getByRole('group', { name: 'Empresas que requieren atención' })).getByRole('button', { name: /Sin movimiento/ }));
    // «Sin movimiento» es el umbral de 7 días del grupo de inactividad.
    assert.ok(within(screen.getByRole('group', { name: 'Filtros activos' })).getByText('Inactividad: 7+ días'));
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Inteligencia' }));
    assert.ok(screen.queryByRole('list', { name: 'Empresas del pipeline' }) === null);
    assert.equal(screen.getAllByRole('button', { name: /^Eliminar / }).length, 2);
    assert.ok(screen.getByText('Ninguna empresa coincide'));
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    assert.equal(listNames().length, 4);
  });

  it('sin empresas: un único vacío que lleva a los prospectos', () => {
    renderJourney({ overview: buildEmptyOverview() });
    assert.ok(screen.getByText('Todavía no hay empresas en el pipeline'));
    assert.equal(screen.getByRole('link', { name: /Ir a prospectos/ }).getAttribute('href'), '/accounts?tab=prospectos');
    assert.ok(screen.queryByRole('list', { name: 'Empresas del pipeline' }) === null);
  });
});

describe('Pipeline · recorrido de una empresa', () => {
  const stageCards = () => Array.from(document.querySelectorAll('section[data-stage]')) as HTMLElement[];
  const expandAll = () => fireEvent.click(screen.getByRole('button', { name: 'Expandir todas' }));

  it('muestra las 8 tarjetas de etapa, en orden, con su estado', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    assert.deepEqual(
      stageCards().map((card) => [card.getAttribute('data-stage'), card.getAttribute('data-state')]),
      [
        ['prospeccion', 'complete'],
        ['enriquecimiento', 'complete'],
        ['inteligencia', 'current'],
        ['preparacion', 'upcoming'],
        ['reunion', 'upcoming'],
        ['cotizacion', 'upcoming'],
        ['venta_interna', 'upcoming'],
        ['cierre', 'upcoming'],
      ],
    );
  });

  it('la pista marca la etapa actual y todas sus etapas llevan a su tarjeta', async () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    const track = screen.getByRole('list', { name: 'Etapas del proceso de venta' });
    const steps = Array.from(track.querySelectorAll('li'));
    assert.equal(steps.length, 8);
    const current = track.querySelector('[aria-current="step"]');
    assert.ok(current?.textContent?.includes('Inteligencia'));
    assert.deepEqual(
      steps.map((step) => step.getAttribute('data-status')),
      ['complete', 'complete', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'],
    );
    // Las pendientes también se pueden pulsar: la pista navega, no avanza un flujo.
    assert.equal(within(track).getAllByRole('button').filter((button) => (button as HTMLButtonElement).disabled).length, 0);

    const scrolled: string[] = [];
    const target = document.getElementById('etapa-cotizacion') as HTMLElement;
    target.scrollIntoView = () => scrolled.push(target.id);
    assert.equal(target.getAttribute('data-open'), 'false');
    fireEvent.click(within(track).getByRole('button', { name: /Cotización/ }));
    // Pulsar la etapa en la pista la abre y lleva la vista hasta ella.
    await waitFor(() => assert.deepEqual(scrolled, ['etapa-cotizacion']));
    assert.equal(target.getAttribute('data-open'), 'true');
  });

  it('una etapa actual con señal crítica sale en error en la pista', () => {
    renderJourney({ selectedAccountId: 'acme', journey: buildManualJourney() });
    const track = screen.getByRole('list', { name: 'Etapas del proceso de venta' });
    assert.equal(track.querySelectorAll('li')[1].getAttribute('data-status'), 'error');
  });

  it('la cabecera dice país, industria, responsable y etapa, sin botones (las acciones van en la barra)', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Globex' }));
    assert.ok(screen.getByText('Responsable: Ana Pérez'));
    assert.ok(screen.getByText('Inteligencia · Lista para investigar'));
    const header = screen.getByRole('heading', { level: 2, name: 'Globex' }).closest('.rounded-2xl') as HTMLElement;
    assert.equal(header.querySelectorAll('button, a').length, 0);
    assert.ok(screen.queryByRole('link', { name: /Ver empresa/ }) === null);
    assert.ok(screen.queryByRole('button', { name: /Cambiar etapa/ }) === null);
  });

  const openBody = (index: number) => stageCards()[index].querySelector('[id$="-detalle"]') as HTMLElement;
  const dialog = () => screen.findByRole('dialog');

  it('prospección abierta enseña SOLO lo esencial: una fila de 4 datos clave y «Ver más»', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    expandAll();
    const body = openBody(0);

    const summary = within(body).getByLabelText('Datos clave de la prospección');
    assert.deepEqual(
      Array.from(summary.querySelectorAll('dt'), (dt) => dt.textContent),
      ['Origen', 'Encaje ICP', 'Aprobado por', 'HubSpot'],
    );
    // Todos los pares de la fila llevan icono: quedan alineados.
    assert.equal(summary.querySelectorAll('svg').length, 4);
    assert.ok(within(summary).getByText('Agente 1 · Apollo'));
    assert.ok(within(summary).getByText('82%'));
    assert.ok(within(summary).getByText(/^Ana Pérez · /));
    assert.equal(within(summary).getByText('Sincronizada').getAttribute('data-status'), 'active');

    // Nada más: ni grupos con título, ni datos repetidos, ni el detalle (va en el drawer).
    assert.equal(body.querySelectorAll('dl').length, 1);
    assert.equal(body.querySelectorAll('h4').length, 0);
    assert.ok(within(body).queryByText(/RFC GLO010101AAA/) === null);
    assert.ok(within(body).queryByText(/US\$/) === null);
    assert.ok(within(body).queryByRole('link') === null);
    assert.ok(within(body).getByRole('button', { name: 'Ver más de Prospección' }));
  });

  it('«Ver más» de prospección abre el drawer con el detalle real, en secciones', async () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    expandAll();
    fireEvent.click(screen.getByRole('button', { name: 'Ver más de Prospección' }));

    const drawer = await dialog();
    assert.ok(within(drawer).getByText('1. Prospección · Globex'));
    assert.deepEqual(
      Array.from(drawer.querySelectorAll('section h3'), (heading) => heading.textContent),
      ['Origen', 'Encaje y clasificación', 'Aprobación', 'Hoy'],
    );
    // Dentro de una sección ningún par lleva icono: etiquetas y valores en la misma columna.
    assert.equal(drawer.querySelectorAll('section dl svg').length, 0);

    const view = within(drawer);
    assert.ok(view.getByText('Apollo'));
    assert.equal(view.getByRole('link', { name: 'Lote MX · Tecnología' }).getAttribute('href'), '/prospect-batches/batch-1');
    assert.match(view.getByText(/US\$ 0\.12/).parentElement?.textContent ?? '', /^US\$ 0\.12 \(estimado\)$/);
    assert.ok(view.getByText('82%'));
    assert.ok(view.getByText('70%'));
    assert.ok(view.getByText(/RFC GLO010101AAA/));
    // Un dato que falta es la raya apagada del sistema, con nombre para lector de pantalla.
    assert.ok(view.getByText('Sin clasificación').classList.contains('sr-only'));
    assert.ok(view.getByText('Se creó la empresa en HubSpot'));
    assert.ok(view.getByText('Ficha n.º hs-9'));
    // Pie: a la ficha de la empresa y al lote.
    assert.equal(view.getByRole('link', { name: /Ver empresa/ }).getAttribute('href'), '/accounts/globex');
    assert.equal(view.getByRole('link', { name: 'Ver lote' }).getAttribute('href'), '/prospect-batches/batch-1');
  });

  it('abrir y cerrar el drawer avisa a la pantalla (bloquea la barra) y devuelve el foco a «Ver más»', async () => {
    const changes: boolean[] = [];
    renderJourney({
      selectedAccountId: 'globex',
      journey: buildJourney(),
      onStageDetailOpenChange: (open) => changes.push(open),
    });
    expandAll();
    const more = screen.getByRole('button', { name: 'Ver más de Prospección' });
    more.focus();
    fireEvent.click(more);
    const drawer = await dialog();
    assert.deepEqual(changes, [true]);

    fireEvent.click(within(drawer).getByRole('button', { name: /Cerrar/ }));
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
    assert.deepEqual(changes, [true, false]);
    await waitFor(() => assert.ok(document.activeElement === more));
  });

  it('una empresa creada a mano lo dice, sin inventar origen (en el acordeón y en el drawer)', async () => {
    renderJourney({ selectedAccountId: 'acme', journey: buildManualJourney() });
    expandAll();
    const body = openBody(0);
    assert.ok(within(body).getByText(/Creada a mano por Ana Pérez el /));
    assert.ok(within(body).queryByText('Encaje ICP') === null);
    assert.ok(within(stageCards()[0]).getByText('Sin sincronizar con HubSpot'));

    fireEvent.click(within(body).getByRole('button', { name: 'Ver más de Prospección' }));
    const drawer = await dialog();
    assert.ok(within(drawer).getByText(/Creada a mano por Ana Pérez el /));
    assert.deepEqual(
      Array.from(drawer.querySelectorAll('section h3'), (heading) => heading.textContent),
      ['Origen', 'Hoy'],
    );
    assert.ok(within(drawer).getByText('Aún no está en HubSpot'));
    assert.ok(within(drawer).queryByRole('link', { name: 'Ver lote' }) === null);
  });

  it('sin prospecto enlazado y sin ser manual, dice que no hay rastro del origen', async () => {
    renderJourney({ selectedAccountId: 'acme', journey: buildManualJourney({ source: 'imported' }) });
    expandAll();
    assert.ok(within(openBody(0)).getByText(/No hay rastro del origen: llegó por «Importada»/));

    fireEvent.click(screen.getByRole('button', { name: 'Ver más de Prospección' }));
    assert.ok(within(await dialog()).getByText('No hay rastro del origen'));
  });

  it('enriquecimiento abierto: las 4 cifras, la última búsqueda en una línea y, al pie, «Buscar más contactos con IA» + «Ver más»', () => {
    let opened = 0;
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney(), onSearchContacts: () => (opened += 1) });
    expandAll();
    const body = openBody(1);

    const figures = within(body).getByLabelText('Cifras de contactos');
    assert.deepEqual(
      Array.from(figures.querySelectorAll('div > dt'), (dt) => [dt.textContent, dt.nextElementSibling?.textContent]),
      [['Contactos', '2'], ['Decisores', '1'], ['Con teléfono', '1'], ['En HubSpot', '1']],
    );
    assert.match(
      body.querySelector('[data-slot="stage-last-run"]')?.textContent ?? '',
      /^Última búsqueda: Completado · Apollo · .* · 2 aprobados$/,
    );
    // Sin listas de búsquedas ni de decisores aquí: van en el drawer.
    assert.ok(within(body).queryByRole('list', { name: 'Decisores de la empresa' }) === null);
    assert.ok(within(body).queryByText('Luisa Gómez') === null);
    assert.equal(body.querySelectorAll('[data-slot="timeline-item"]').length, 0);

    const buttons = within(body).getAllByRole('button');
    assert.deepEqual(buttons.map((button) => button.textContent), ['Buscar más contactos con IA', 'Ver más']);
    // El accionador de IA secundario: el primario es el agente de la barra.
    assert.match(buttons[0].className, /su-ai-border/);
    fireEvent.click(buttons[0]);
    assert.equal(opened, 1);
  });

  it('sin buscador o con la empresa archivada, el acordeón de enriquecimiento no ofrece buscar más', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    expandAll();
    assert.deepEqual(within(openBody(1)).getAllByRole('button').map((button) => button.textContent), ['Ver más']);
    cleanup();

    renderJourney({
      selectedAccountId: 'globex',
      journey: buildJourney({ pipeline_status: 'archived', archived_at: '2026-09-20T10:00:00Z' }),
      onSearchContacts: () => {},
    });
    expandAll();
    assert.deepEqual(within(openBody(1)).getAllByRole('button').map((button) => button.textContent), ['Ver más']);
  });

  it('«Ver más» de enriquecimiento abre el drawer con las búsquedas, los decisores y el botón de IA al pie', async () => {
    let opened = 0;
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney(), onSearchContacts: () => (opened += 1) });
    expandAll();
    fireEvent.click(screen.getByRole('button', { name: 'Ver más de Enriquecimiento de contactos' }));

    const drawer = await dialog();
    const view = within(drawer);
    assert.ok(view.getByText('2. Enriquecimiento de contactos · Globex'));
    // El mismo historial de búsquedas que la pestaña «Agentes» de la empresa.
    assert.ok(view.getByText('Runs de enriquecimiento de contactos'));
    assert.ok(view.getByText('Completado'));
    const decisionMakers = within(view.getByRole('list', { name: 'Decisores de la empresa' }));
    assert.ok(decisionMakers.getByText('Luisa Gómez'));
    assert.ok(decisionMakers.getByText('Con teléfono'));
    assert.ok(decisionMakers.queryByText('Mario Ruiz') === null);
    assert.equal(view.getByRole('link', { name: /Ver todos los contactos/ }).getAttribute('href'), '/accounts/globex?tab=contactos');

    fireEvent.click(view.getByRole('button', { name: 'Buscar más contactos con IA' }));
    assert.equal(opened, 1);
    // Un solo drawer a la vez: el de la etapa se cierra al abrir el buscador.
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
  });

  it('las etapas «Próximamente» dicen en una frase qué hará el agente, sin «Ver más» ni datos simulados', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    expandAll();
    const planned = stageCards().slice(2);
    assert.equal(planned.length, 6);
    planned.forEach((card, index) => {
      assert.match(card.textContent ?? '', /Próximamente/);
      const body = openBody(index + 2);
      assert.equal(body.querySelectorAll('p').length, 1);
      assert.equal(within(body).queryAllByRole('button').length, 0);
      assert.equal(body.querySelectorAll('dl').length, 0);
    });
    assert.ok(within(openBody(2)).getByText(/Armará el brief de la empresa/));
    assert.ok(screen.queryByText('Lo que ya tiene SellUp para esta etapa') === null);
    // Nada de reuniones, cotizaciones ni cierres simulados.
    assert.ok(screen.queryByText(/Samu conectado/) === null);
    assert.ok(within(planned[3]).queryByText(/US\$/) === null);
  });

  it('investigación en curso dice quién la marcó', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney({ pipeline_status: 'research_in_progress' }) });
    const card = within(stageCards()[2]);
    assert.ok(card.getByText('Investigación en curso'));
    assert.ok(card.getByText(/Marcada por Ana Pérez/));
  });

  it('el historial une cambios de estado traducidos, la aprobación y las búsquedas, de lo más reciente a lo más antiguo', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    const history = within(screen.getByRole('region', { name: 'Historial' }));
    const titles = Array.from(
      screen.getByRole('region', { name: 'Historial' }).querySelectorAll('[data-slot="timeline-item"] .font-medium'),
      (node) => node.textContent,
    );
    assert.deepEqual(titles, ['Estado cambiado', 'Búsqueda de contactos (Agente 2A)', 'Prospecto aprobado']);
    assert.ok(history.getByText('De «Nueva» a «Lista para investigar» · Por Ana Pérez'));
  });

  it('una empresa fuera de alcance o inexistente se dice, sin recorrido', () => {
    renderJourney({ selectedAccountId: 'otra', journey: null });
    assert.ok(screen.getByText('No encontramos esa empresa'));
    assert.equal(stageCards().length, 0);
  });

  it('mientras llega otra empresa pinta el esqueleto con la forma del recorrido', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney(), pendingAccountId: 'acme' });
    assert.ok(screen.getByRole('status', { name: 'Cargando el recorrido de la empresa' }));
    assert.equal(stageCards().length, 0);
  });
});

describe('Pipeline · etapa disponible sin empezar: invitación a activarla', () => {
  const stage = (id: string) => document.getElementById(`etapa-${id}`) as HTMLElement;

  it('sin contactos ni búsquedas, enriquecimiento no es un acordeón: es un contenedor que invita', () => {
    renderJourney({
      selectedAccountId: 'nova',
      journey: buildProspectOnlyJourney({ id: 'nova', name: 'Nova Energía' }),
      onSearchContacts: () => {},
    });

    const invitation = stage('enriquecimiento');
    assert.ok(invitation.hasAttribute('data-invitation'));
    assert.equal(invitation.getAttribute('data-stage'), 'enriquecimiento');
    assert.equal(invitation.getAttribute('data-state'), 'current');
    // Sin botón de plegar ni flecha.
    assert.ok(invitation.querySelector('[aria-expanded]') === null);
    assert.ok(invitation.getAttribute('data-open') === null);
    assert.ok(within(invitation).getByRole('heading', { level: 3, name: '2. Enriquecimiento de contactos' }));
    assert.ok(within(invitation).getByText('Agente 2A'));
    assert.ok(within(invitation).getByText('Aún no se han buscado los contactos de Nova Energía.'));
    // Una fila con la anatomía de un acordeón plegado: sin icono grande ni bloque centrado.
    assert.equal(within(invitation).getAllByRole('heading').length, 1);
    assert.ok(invitation.querySelector('svg.size-7, [class*="rounded-full bg-surface-muted p-4"]') === null);
    assert.match((invitation.firstElementChild as HTMLElement).className, /\bp-5\b/);
    // Los avisos de la etapa siguen a la vista.
    assert.ok(within(within(invitation).getByRole('list', { name: /Avisos de/ })).getByText('Sin contactos'));
    // Nada de métricas ni listas vacías.
    assert.ok(within(invitation).queryByText('Búsquedas del Agente 2A') === null);
    assert.match(invitation.closest('.rounded-2xl')?.className ?? '', /border-dashed/);
  });

  it('su botón es el accionador de IA secundario y abre el buscador una vez', () => {
    let opened = 0;
    renderJourney({
      selectedAccountId: 'nova',
      journey: buildProspectOnlyJourney({ id: 'nova', name: 'Nova Energía' }),
      onSearchContacts: () => (opened += 1),
    });

    const buttons = within(stage('enriquecimiento')).getAllByRole('button');
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].textContent, 'Buscar contactos con IA');
    assert.match(buttons[0].className, /su-ai-border/);
    fireEvent.click(buttons[0]);
    assert.equal(opened, 1);
  });

  it('las demás etapas siguen siendo acordeones y «Expandir todas» no cuenta la invitación', () => {
    renderJourney({ selectedAccountId: 'nova', journey: buildProspectOnlyJourney({ id: 'nova', name: 'Nova Energía' }) });

    assert.equal(document.querySelectorAll('section[data-stage]').length, 8);
    assert.equal(document.querySelectorAll('section[data-stage] [aria-expanded]').length, 7);
    fireEvent.click(screen.getByRole('button', { name: 'Expandir todas' }));
    assert.equal(document.querySelectorAll('section[data-stage][data-open="true"]').length, 7);
    assert.ok(screen.getByRole('button', { name: 'Contraer todas' }));
    assert.ok(stage('enriquecimiento').hasAttribute('data-invitation'));
  });

  it('la pista sigue llevando hasta la etapa-invitación', async () => {
    renderJourney({ selectedAccountId: 'nova', journey: buildProspectOnlyJourney({ id: 'nova', name: 'Nova Energía' }) });

    const scrolled: string[] = [];
    const target = stage('enriquecimiento');
    target.scrollIntoView = () => scrolled.push(target.id);
    const track = screen.getByRole('list', { name: 'Etapas del proceso de venta' });
    fireEvent.click(within(track).getByRole('button', { name: /Enriquecimiento/ }));
    await waitFor(() => assert.deepEqual(scrolled, ['etapa-enriquecimiento']));
  });

  it('sin buscador o con la empresa archivada, la invitación se muestra sin botón', () => {
    renderJourney({ selectedAccountId: 'nova', journey: buildProspectOnlyJourney({ id: 'nova', name: 'Nova Energía' }) });
    assert.equal(within(stage('enriquecimiento')).queryAllByRole('button').length, 0);
    cleanup();

    renderJourney({
      selectedAccountId: 'nova',
      journey: buildProspectOnlyJourney({ id: 'nova', name: 'Nova Energía', pipeline_status: 'archived', archived_at: '2026-09-20T10:00:00Z' }),
      onSearchContacts: () => {},
    });
    assert.equal(within(stage('enriquecimiento')).queryAllByRole('button').length, 0);
    assert.ok(within(stage('enriquecimiento')).getByText(/la empresa está archivada/));
  });

  it('en cuanto hay contactos o alguna búsqueda vuelve a ser el acordeón normal', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney(), onSearchContacts: () => {} });

    const accordion = stage('enriquecimiento');
    assert.equal(accordion.hasAttribute('data-invitation'), false);
    assert.ok(accordion.querySelector('[aria-expanded]'));
    assert.ok(screen.queryByText(/Aún no se han buscado los contactos/) === null);
  });

  it('las etapas «Próximamente» nunca son invitación: siguen siendo acordeones apagados', () => {
    renderJourney({ selectedAccountId: 'nova', journey: buildProspectOnlyJourney({ id: 'nova', name: 'Nova Energía' }) });
    for (const id of ['inteligencia', 'preparacion', 'reunion', 'cotizacion', 'venta_interna', 'cierre', 'prospeccion']) {
      assert.equal(stage(id).hasAttribute('data-invitation'), false, id);
    }
  });
});

describe('Pipeline · pantalla estrecha: lista → recorrido → volver', () => {
  const list = () => document.querySelector('[data-slot="pipeline-list"]') as HTMLElement;
  const detail = () => document.querySelector('[data-slot="pipeline-detail"]') as HTMLElement;

  it('sin empresa elegida se ve la lista; el recorrido espera', () => {
    renderJourney();
    assert.equal(list().hasAttribute('data-collapsed-on-mobile'), false);
    assert.equal(detail().getAttribute('data-collapsed-on-mobile'), 'true');
    assert.match(detail().className, /\bhidden\b.*lg:flex/);
    assert.ok(screen.queryByRole('button', { name: 'Volver' }) === null);
  });

  it('con empresa elegida la lista cede el sitio y «Volver» regresa a ella', () => {
    const { selections } = renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    assert.equal(list().getAttribute('data-collapsed-on-mobile'), 'true');
    assert.match(list().className, /\bhidden\b.*lg:flex/);
    assert.equal(detail().hasAttribute('data-collapsed-on-mobile'), false);

    const back = screen.getByRole('button', { name: 'Volver' });
    assert.match(back.parentElement?.className ?? '', /lg:hidden/);
    fireEvent.click(back);
    assert.deepEqual(selections, [null]);
  });
});

describe('Pipeline · cada etapa es un acordeón', () => {
  const card = (id: string) => document.getElementById(`etapa-${id}`) as HTMLElement;
  const header = (id: string) => within(card(id)).getAllByRole('button')[0] as HTMLButtonElement;

  it('de entrada solo está abierta la etapa actual; las demás muestran su cabecera y su descripción', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });

    assert.equal(card('inteligencia').getAttribute('data-open'), 'true');
    for (const id of ['prospeccion', 'enriquecimiento', 'preparacion', 'reunion', 'cotizacion', 'venta_interna', 'cierre']) {
      assert.equal(card(id).getAttribute('data-open'), 'false', id);
      assert.equal(header(id).getAttribute('aria-expanded'), 'false', id);
    }
    // Plegada sigue diciendo qué pasa en la etapa y quién es su agente.
    assert.ok(within(card('cotizacion')).getByText(/Propuesta económica por reglas/));
    assert.ok(within(card('cotizacion')).queryByText(/Generará la propuesta económica/) === null);
  });

  it('el título es un h3 que envuelve al botón de la cabecera', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });

    const heading = screen.getByRole('heading', { level: 3, name: /6\. Cotización/ });
    assert.ok(heading.querySelector('button'));
  });

  it('pulsar la cabecera abre y cierra la etapa', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });

    fireEvent.click(header('cotizacion'));
    assert.equal(header('cotizacion').getAttribute('aria-expanded'), 'true');
    assert.ok(within(card('cotizacion')).getByText(/Generará la propuesta económica/));

    fireEvent.click(header('cotizacion'));
    assert.equal(header('cotizacion').getAttribute('aria-expanded'), 'false');
    assert.equal(within(card('cotizacion')).queryByText('Lo que ya tiene SellUp para esta etapa'), null);
  });

  it('abrir una etapa no cierra las demás', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });

    fireEvent.click(header('prospeccion'));
    assert.equal(card('prospeccion').getAttribute('data-open'), 'true');
    assert.equal(card('inteligencia').getAttribute('data-open'), 'true');
  });

  it('«Expandir todas» y «Contraer todas» abren y cierran todo, y el rótulo sigue al estado', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });

    fireEvent.click(screen.getByRole('button', { name: 'Expandir todas' }));
    assert.equal(document.querySelectorAll('section[data-stage][data-open="true"]').length, 8);

    fireEvent.click(screen.getByRole('button', { name: 'Contraer todas' }));
    assert.equal(document.querySelectorAll('section[data-stage][data-open="true"]').length, 0);
    assert.ok(screen.getByRole('button', { name: 'Expandir todas' }));
  });

  it('los avisos de la etapa se ven aunque esté plegada', () => {
    renderJourney({ selectedAccountId: 'acme', journey: buildManualJourney() });

    // Prospección arranca plegada (la etapa actual, enriquecimiento, aquí es una invitación).
    const prospecting = card('prospeccion');
    assert.equal(prospecting.getAttribute('data-open'), 'false');
    assert.ok(within(within(prospecting).getByRole('list', { name: /Avisos de/ })).getByText('Sin sincronizar con HubSpot'));
    fireEvent.click(header('prospeccion'));
    assert.equal(prospecting.getAttribute('data-open'), 'true');
    assert.ok(within(prospecting).getByRole('list', { name: /Avisos de/ }));
  });

  it('una empresa archivada no tiene etapa actual: todas arrancan plegadas', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney({ pipeline_status: 'archived' }) });

    assert.equal(document.querySelectorAll('section[data-stage][data-open="true"]').length, 0);
  });
});

describe('Pipeline · scroll: la página y el panel de empresas, nada más', () => {
  it('el panel de empresas va pegado con su propio alto máximo y el recorrido NO tiene scroll propio', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });

    const list = document.querySelector('[data-slot="pipeline-list"]') as HTMLElement;
    assert.match(list.className, /lg:sticky/);
    assert.match(list.className, /lg:max-h-\[calc\(100dvh-/);

    const grid = list.parentElement as HTMLElement;
    assert.doesNotMatch(grid.className, /lg:min-h-0|lg:grid-rows/);

    const detail = document.querySelector('[data-slot="pipeline-detail"]') as HTMLElement;
    assert.doesNotMatch(detail.className, /overflow-y-auto|overflow-auto|lg:min-h-0/);
  });

  it('en la lista, el resumen, el buscador y los filtros quedan fijos y solo las empresas se desplazan', () => {
    renderJourney();

    const scroller = screen.getByRole('list', { name: 'Empresas del pipeline' }).parentElement as HTMLElement;
    assert.match(scroller.className, /lg:overflow-y-auto/);
    assert.match(scroller.className, /lg:flex-1/);
    const fixed = screen.getByRole('searchbox', { name: 'Buscar empresa por nombre o dominio' }).closest('.shrink-0') as HTMLElement;
    assert.ok(fixed, 'la cabecera del panel no se encoge ni se desplaza');
    assert.ok(fixed.contains(screen.getByRole('button', { name: /Resumen del pipeline/ })));
    assert.ok(fixed.contains(screen.getByRole('button', { name: /^Filtros/ })));
    assert.equal(fixed.contains(scroller), false);
    assert.doesNotMatch(fixed.className, /overflow-y-auto/);
  });
});
