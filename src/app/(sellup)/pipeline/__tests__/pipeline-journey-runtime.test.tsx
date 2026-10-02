/**
 * Pipeline · vista «Recorrido» — contrato RUNTIME: la lista con su buscador,
 * sus filtros y su selección; el resumen sin empresa elegida; el recorrido con
 * las ocho tarjetas y la pista; «Cambiar etapa» pide confirmación y escribe UNA
 * vez; y en pantalla estrecha, lista → recorrido → volver.
 */

import '../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildEmptyOverview, buildJourney, buildManualJourney, buildOverview } from './pipeline-fixtures';
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

  it('los chips filtran por etapa actual y llevan su contador', () => {
    renderJourney();
    const chips = screen.getByRole('radiogroup', { name: 'Filtrar por etapa actual' });
    const labels = Array.from(chips.querySelectorAll('[role="radio"]'), (chip) => chip.textContent);
    assert.deepEqual(labels, ['Todas4', 'Enriquecimiento1', 'Inteligencia2', 'Preparación1']);
    fireEvent.click(within(chips).getByRole('radio', { name: /Inteligencia/ }));
    assert.deepEqual(listNames(), ['Initech', 'Globex']);
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

describe('Pipeline · resumen sin empresa elegida', () => {
  it('cuenta las empresas por etapa y las archivadas', () => {
    renderJourney();
    const summary = within(screen.getByRole('region', { name: 'Resumen del pipeline' }));
    assert.ok(summary.getByText('Buscando sus contactos'));
    assert.ok(summary.getByText('Por investigar o en curso'));
    assert.ok(summary.getByText('Listas para contacto'));
    assert.ok(summary.getByText('Fuera del tablero'));
    assert.ok(summary.getByRole('img', { name: /Enriquecimiento de contactos: 1, Inteligencia de cuenta: 2, Preparación y contacto: 1/ }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro' }));
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

  it('la pista marca la etapa actual y todas sus etapas llevan a su tarjeta', () => {
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
    fireEvent.click(within(track).getByRole('button', { name: /Cotización/ }));
    assert.deepEqual(scrolled, ['etapa-cotizacion']);
  });

  it('una etapa actual con señal crítica sale en error en la pista', () => {
    renderJourney({ selectedAccountId: 'acme', journey: buildManualJourney() });
    const track = screen.getByRole('list', { name: 'Etapas del proceso de venta' });
    assert.equal(track.querySelectorAll('li')[1].getAttribute('data-status'), 'error');
  });

  it('la cabecera dice país, industria, responsable, etapa y enlaza a la ficha', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Globex' }));
    assert.ok(screen.getByText('Responsable: Ana Pérez'));
    assert.ok(screen.getByText('Inteligencia · Lista para investigar'));
    assert.equal(screen.getByRole('link', { name: /Ver empresa/ }).getAttribute('href'), '/accounts/globex');
  });

  it('prospección cuenta el origen real: proveedor, lote enlazado, encaje, aprobación, HubSpot y costo', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    const card = within(stageCards()[0]);
    // El agente de la etapa (badge) y el origen de la cuenta, con su proveedor.
    assert.equal(card.getAllByText('Agente 1').length, 2);
    assert.ok(card.getByText(/· Apollo/));
    assert.equal(card.getByRole('link', { name: 'Lote MX · Tecnología' }).getAttribute('href'), '/prospect-batches/batch-1');
    assert.ok(card.getByText('Encaje 82% · confianza 70%'));
    assert.ok(card.getByText(/RFC GLO010101AAA/));
    assert.ok(card.getByText(/^Ana Pérez · /));
    assert.ok(card.getByText('Se creó la empresa en HubSpot'));
    assert.ok(card.getByText(/US\$ 0\.1200 \(estimado\)/));
  });

  it('una empresa creada a mano lo dice, sin inventar origen', () => {
    renderJourney({ selectedAccountId: 'acme', journey: buildManualJourney() });
    const card = within(stageCards()[0]);
    assert.ok(card.getByText(/Creada a mano por Ana Pérez el /));
    assert.ok(card.queryByText('Encaje ICP') === null);
    assert.ok(card.getByText('Sin sincronizar con HubSpot'));
  });

  it('enriquecimiento: cifras reales de contactos, las búsquedas del agente y los decisores', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney(), onSearchContacts: () => {} });
    const card = within(stageCards()[1]);
    assert.ok(card.getByText('Agente 2A'));
    for (const [title, value] of [['Contactos', '2'], ['Decisores', '1'], ['Con teléfono', '1'], ['En HubSpot', '1']]) {
      const metric = card.getAllByText(title).find((node) => node.tagName === 'P') as HTMLElement;
      assert.ok(metric.closest('.rounded-2xl')?.textContent?.includes(value), title);
    }
    assert.ok(card.getByText('Completado · Apollo'));
    assert.ok(card.getByText(/4 encontrados · 2 aprobados · US\$ 0\.5000/));
    const decisionMakers = within(card.getByRole('list', { name: 'Decisores de la empresa' }));
    assert.ok(decisionMakers.getByText('Luisa Gómez'));
    assert.ok(decisionMakers.getByText('Con teléfono'));
    assert.ok(decisionMakers.queryByText('Mario Ruiz') === null);
    assert.equal(card.getByRole('link', { name: 'Ver todos' }).getAttribute('href'), '/accounts/globex?tab=contactos');
  });

  it('«Buscar contactos con IA» abre el buscador del Agente 2A', () => {
    let opened = 0;
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney(), onSearchContacts: () => (opened += 1) });
    fireEvent.click(screen.getByRole('button', { name: /Buscar contactos con IA/ }));
    assert.equal(opened, 1);
  });

  it('las seis etapas previstas dicen qué hará el agente y solo enseñan datos que SellUp ya tiene', () => {
    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    const planned = stageCards().slice(2);
    assert.equal(planned.length, 6);
    for (const card of planned) {
      assert.match(card.textContent ?? '', /Previsto · (MVP|Fase 2|Fase 3)/);
      assert.ok(within(card).getByText('Lo que ya tiene SellUp para esta etapa'));
    }
    const intelligence = within(planned[0]);
    assert.ok(intelligence.getByText(/Armará el brief de la empresa/));
    assert.ok(intelligence.getByText('México'));
    assert.ok(intelligence.getByText('201-500 empleados'));
    assert.ok(intelligence.getByText('globex.mx'));
    assert.ok(intelligence.getByText('linkedin.com/company/globex'));
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

describe('Pipeline · cambiar de etapa', () => {
  type Call = [string, string];

  async function openMenuAndPick(label: string) {
    fireEvent.click(screen.getByRole('button', { name: /Cambiar etapa/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: label }));
  }

  it('pide confirmación y llama UNA vez con el estado elegido', async () => {
    const calls: Call[] = [];
    renderJourney({
      selectedAccountId: 'globex',
      journey: buildJourney(),
      onChangeStage: async (id, status) => {
        calls.push([id, status]);
        return { success: true };
      },
    });

    await openMenuAndPick('Lista para contacto');
    const dialog = await screen.findByRole('alertdialog');
    assert.ok(within(dialog).getByText('¿Mover a «Lista para contacto»?'));
    assert.deepEqual(calls, [], 'elegir en el menú no escribe');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Mover' }));
    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null));
    assert.deepEqual(calls, [['globex', 'ready_for_outreach']]);
  });

  it('cancelar no escribe', async () => {
    const calls: Call[] = [];
    renderJourney({
      selectedAccountId: 'globex',
      journey: buildJourney(),
      onChangeStage: async (id, status) => {
        calls.push([id, status]);
        return { success: true };
      },
    });
    await openMenuAndPick('Nueva');
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => assert.ok(screen.queryByRole('alertdialog') === null));
    assert.deepEqual(calls, []);
  });

  it('si falla, el motivo se ve en el diálogo y no se cierra', async () => {
    renderJourney({
      selectedAccountId: 'globex',
      journey: buildJourney(),
      onChangeStage: async () => ({ success: false, error: 'Cuenta no encontrada' }),
    });
    await openMenuAndPick('Nueva');
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mover' }));
    assert.ok(await within(dialog).findByText('Cuenta no encontrada'));
  });

  it('el estado en el que ya está no se puede elegir; sin acción o archivada, no se ofrece', async () => {
    const { unmount } = renderJourney({
      selectedAccountId: 'globex',
      journey: buildJourney(),
      onChangeStage: async () => ({ success: true }),
    });
    fireEvent.click(screen.getByRole('button', { name: /Cambiar etapa/ }));
    const currentItem = await screen.findByRole('menuitem', { name: 'Lista para investigar' });
    assert.ok(currentItem.hasAttribute('data-disabled') || currentItem.getAttribute('aria-disabled') === 'true');
    unmount();

    renderJourney({ selectedAccountId: 'globex', journey: buildJourney() });
    assert.ok(screen.queryByRole('button', { name: /Cambiar etapa/ }) === null);
    cleanup();

    renderJourney({
      selectedAccountId: 'globex',
      journey: buildJourney({ pipeline_status: 'archived', archived_at: '2026-09-20T10:00:00Z' }),
      onChangeStage: async () => ({ success: true }),
    });
    assert.ok(screen.queryByRole('button', { name: /Cambiar etapa/ }) === null);
    assert.ok(screen.getAllByText('Archivada').length > 0);
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
    assert.match(list().className, /\bhidden\b.*lg:block/);
    assert.equal(detail().hasAttribute('data-collapsed-on-mobile'), false);

    const back = screen.getByRole('button', { name: 'Volver' });
    assert.match(back.parentElement?.className ?? '', /lg:hidden/);
    fireEvent.click(back);
    assert.deepEqual(selections, [null]);
  });
});
