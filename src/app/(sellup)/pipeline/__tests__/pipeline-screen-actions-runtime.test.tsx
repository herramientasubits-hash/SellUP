/**
 * Pipeline · acciones de pantalla — contrato RUNTIME: con una empresa elegida la
 * pantalla declara el agente de IA, «Cambiar etapa» (primaria, con sus estados)
 * y «Ver empresa», igual que Empresas y Contactos: en la barra flotante o, con
 * la preferencia «En la pantalla», en la cabecera. Sin empresa no hay barra. El
 * cambio de etapa pide confirmación y escribe UNA vez.
 */
import {
  ACTIONS_PLACEMENT_KEY,
  resetRailPreferences,
  setCompactViewport,
  visibleActionLabels,
} from '../../../../components/action-rail/__tests__/rail-test-dom';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildJourney, buildProspectOnlyJourney } from './pipeline-fixtures';
import { chooseMoveWithoutAction, findMoveDialog, moveOption, movePrimary } from './stage-move-helpers';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];
let ListActionRailProvider: (typeof import('@/components/action-rail'))['ListActionRailProvider'];
let TooltipProvider: (typeof import('@/components/ui/tooltip'))['TooltipProvider'];
let PipelineScreenActions: (typeof import('../pipeline-screen-actions'))['PipelineScreenActions'];
let PipelineRailGap: (typeof import('../pipeline-screen-actions'))['PipelineRailGap'];
let usePipelineRailAtBottom: (typeof import('../pipeline-screen-actions'))['usePipelineRailAtBottom'];
let ARCHIVED_AGENT_REASON: string;

type Props = React.ComponentProps<(typeof import('../pipeline-screen-actions'))['PipelineScreenActions']>;
type Call = [string, string, string];

const h = React.createElement;

before(async () => {
  ({ render, screen, within, fireEvent, waitFor, cleanup, act } = await import('@testing-library/react'));
  ({ ListActionRailProvider } = await import('@/components/action-rail'));
  ({ TooltipProvider } = await import('@/components/ui/tooltip'));
  ({ PipelineScreenActions, PipelineRailGap, usePipelineRailAtBottom, ARCHIVED_AGENT_REASON } = await import(
    '../pipeline-screen-actions'
  ));
});

beforeEach(() => {
  setCompactViewport(false);
});

afterEach(() => {
  cleanup();
  resetRailPreferences();
});

function Gap({ hasActions }: { hasActions: boolean }) {
  return h(PipelineRailGap, { visible: usePipelineRailAtBottom(hasActions) });
}

function renderActions(props: Partial<Props> = {}) {
  const calls: Call[] = [];
  const log = { search: 0, viewed: [] as string[] };
  const journey = props.journey === undefined ? buildJourney() : props.journey;
  const utils = render(
    h(
      TooltipProvider,
      null,
      h(ListActionRailProvider, {
        label: 'Acciones del pipeline',
        gender: 'f' as const,
        children: h(
          React.Fragment,
          null,
          h(PipelineScreenActions, {
            onChangeStage: async (id: string, status: string, context: { kind: string }) => {
              calls.push([id, status, context.kind]);
              return { success: true as const };
            },
            onSearchContacts: () => (log.search += 1),
            onViewAccount: (id: string) => log.viewed.push(id),
            ...props,
            journey,
          }),
          h(Gap, { hasActions: journey !== null }),
        ),
      }),
    ),
  );
  return { ...utils, calls, log };
}

const toolbar = () => screen.queryByRole('toolbar');
const railLabels = () =>
  visibleActionLabels(Array.from((toolbar() as HTMLElement).querySelectorAll<HTMLElement>('button')));
const railButton = (label: string) =>
  Array.from((toolbar() as HTMLElement).querySelectorAll<HTMLElement>('button')).find(
    (button) => button.getAttribute('aria-label') === label,
  ) as HTMLElement;
const gap = () => document.querySelector('[data-slot="pipeline-rail-gap"]');

function setInline() {
  act(() => {
    window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, 'inline');
    window.dispatchEvent(new window.Event('sellup-actions-placement-change'));
  });
}

describe('Pipeline · barra de acciones con una empresa elegida', () => {
  it('la barra trae «Ver empresa», «Cambiar etapa» y el agente «Buscar contactos con IA»', () => {
    renderActions();

    assert.equal((toolbar() as HTMLElement).getAttribute('aria-label'), 'Acciones del pipeline');
    assert.deepEqual(railLabels(), ['Ver empresa', 'Cambiar etapa', 'Buscar contactos con IA']);
    assert.equal(document.querySelector('[data-slot="rail-agent"]')?.getAttribute('aria-label'), 'Buscar contactos con IA');
  });

  it('el agente abre el buscador de contactos y «Ver empresa» lleva a su ficha', () => {
    const { log } = renderActions();

    fireEvent.click(railButton('Buscar contactos con IA'));
    fireEvent.click(railButton('Ver empresa'));
    assert.equal(log.search, 1);
    assert.deepEqual(log.viewed, ['globex']);
  });

  it('se deja el hueco al final del recorrido para que la barra no tape el historial', () => {
    renderActions();
    assert.ok(gap());
  });

  it('con un panel abierto (el buscador de contactos) la barra se recoge', () => {
    renderActions({ isBlocked: true });
    assert.equal(document.querySelector('[data-slot="action-rail"]')?.getAttribute('data-state'), 'blocked');
    assert.ok(screen.queryByRole('button', { name: 'Cambiar etapa' }) === null);
  });
});

describe('Pipeline · sin empresa elegida no hay barra', () => {
  it('ni barra, ni fila de botones vacía, ni hueco reservado', () => {
    renderActions({ journey: null });

    assert.ok(toolbar() === null);
    assert.ok(document.querySelector('[data-slot="screen-header-actions"]') === null);
    assert.ok(gap() === null);
  });

  it('tampoco con las acciones «En la pantalla»', () => {
    renderActions({ journey: null });
    setInline();

    assert.ok(toolbar() === null);
    assert.ok(document.querySelector('[data-slot="screen-header-actions"]') === null);
  });
});

describe('Pipeline · cambiar de etapa desde la barra', () => {
  const openOptions = () => fireEvent.click(railButton('Cambiar etapa'));
  const option = (label: string) =>
    screen.findByText(label, { selector: '[data-slot="rail-create-option"] *, button *, button' });

  const rtl = () => ({ render, screen, within, fireEvent, waitFor, cleanup }) as unknown as typeof import('@testing-library/react');

  it('ofrece los otros estados (el actual no) y elegir uno NO escribe: abre el flujo «Mover de etapa»', async () => {
    const { calls } = renderActions();

    openOptions();
    assert.ok(await option('Lista para contacto'));
    assert.ok(screen.getByText('Nueva'));
    assert.ok(screen.getByText('Investigación en curso'));
    assert.ok(screen.queryByText('Lista para investigar') === null, 'el estado actual no es un destino');

    fireEvent.click(screen.getByText('Lista para contacto'));
    const dialog = await findMoveDialog(rtl());
    assert.ok(within(dialog).getByText('Mover Globex a «Lista para contacto»'));
    assert.deepEqual(calls, []);
  });

  it('al confirmar llama UNA vez con la empresa, el estado elegido y el contexto, y cierra', async () => {
    const { calls } = renderActions();

    openOptions();
    fireEvent.click(await option('Lista para contacto'));
    fireEvent.click(chooseMoveWithoutAction(rtl(), await findMoveDialog(rtl())));
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
    assert.deepEqual(calls, [['globex', 'ready_for_outreach', 'none']]);
  });

  it('volver a «Nueva» ofrece que lo haga la IA (la etapa de enriquecimiento ya tiene agente)', async () => {
    const { calls } = renderActions();

    openOptions();
    fireEvent.click(await option('Nueva'));
    const dialog = await findMoveDialog(rtl());
    const ai = moveOption(rtl(), dialog, 'Que lo haga la IA');
    assert.equal(ai.disabled, false);
    assert.match(ai.textContent ?? '', /Recomendada/);
    fireEvent.click(ai);
    assert.equal(movePrimary(dialog).textContent, 'Mover y abrir el agente');
    fireEvent.click(movePrimary(dialog));
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
    assert.deepEqual(calls, [['globex', 'new', 'ai']]);
  });

  it('cancelar no escribe', async () => {
    const { calls } = renderActions();

    openOptions();
    fireEvent.click(await option('Nueva'));
    fireEvent.click(within(await findMoveDialog(rtl())).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
    assert.deepEqual(calls, []);
  });

  it('si falla, el motivo se ve en el diálogo y no se cierra', async () => {
    renderActions({ onChangeStage: async () => ({ success: false, error: 'Cuenta no encontrada' }) });

    openOptions();
    fireEvent.click(await option('Nueva'));
    const dialog = await findMoveDialog(rtl());
    fireEvent.click(chooseMoveWithoutAction(rtl(), dialog));
    assert.ok(await within(dialog).findByText('Cuenta no encontrada'));
    assert.ok(screen.getByRole('dialog'));
  });

  it('sin acción de mover no se ofrece «Cambiar etapa»', () => {
    renderActions({ onChangeStage: undefined });
    assert.deepEqual(railLabels(), ['Ver empresa', 'Buscar contactos con IA']);
  });
});

describe('Pipeline · empresa archivada', () => {
  const archived = () =>
    buildProspectOnlyJourney({ id: 'vieja', name: 'Vieja S.A.', pipeline_status: 'archived', archived_at: '2026-09-20T10:00:00Z' });

  it('no se ofrece «Cambiar etapa» y el agente queda bloqueado con su motivo', () => {
    const { log } = renderActions({ journey: archived() });

    assert.deepEqual(railLabels(), ['Ver empresa', 'Buscar contactos con IA']);
    const agent = document.querySelector('[data-slot="rail-agent"]') as HTMLElement;
    assert.equal(agent.getAttribute('aria-disabled'), 'true');
    fireEvent.click(agent);
    assert.equal(log.search, 0);
    assert.match(ARCHIVED_AGENT_REASON, /archivada/);
  });
});

describe('Pipeline · acciones «En la pantalla»', () => {
  it('las mismas acciones salen como botones en la cabecera y la barra no se monta', () => {
    renderActions();
    setInline();

    assert.ok(toolbar() === null);
    const header = document.querySelector('[data-slot="screen-header-actions"]') as HTMLElement;
    assert.deepEqual(
      Array.from(header.querySelectorAll('button'), (button) => button.textContent),
      ['Ver empresa', 'Cambiar etapa', 'Buscar contactos con IA'],
    );
    assert.ok(gap() === null, 'sin barra no se reserva hueco');
  });

  it('el agente es el botón de IA y abre el buscador', () => {
    const { log } = renderActions();
    setInline();

    const agent = screen.getByRole('button', { name: 'Buscar contactos con IA' });
    assert.match(agent.className, /su-ai-gradient/);
    fireEvent.click(agent);
    assert.equal(log.search, 1);
  });

  it('«Cambiar etapa» despliega los estados y confirma antes de escribir una vez', async () => {
    const { calls } = renderActions();
    setInline();

    fireEvent.click(screen.getByRole('button', { name: /Cambiar etapa/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Investigación en curso' }));
    assert.deepEqual(calls, []);
    const rtlApi = { render, screen, within, fireEvent, waitFor, cleanup } as unknown as typeof import('@testing-library/react');
    fireEvent.click(chooseMoveWithoutAction(rtlApi, await findMoveDialog(rtlApi)));
    await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
    assert.deepEqual(calls, [['globex', 'research_in_progress', 'none']]);
  });

  it('archivada: el agente sale apagado', () => {
    renderActions({
      journey: buildProspectOnlyJourney({ id: 'vieja', name: 'Vieja S.A.', pipeline_status: 'archived', archived_at: '2026-09-20T10:00:00Z' }),
    });
    setInline();

    assert.equal((screen.getByRole('button', { name: 'Buscar contactos con IA' }) as HTMLButtonElement).disabled, true);
    assert.ok(screen.queryByRole('button', { name: /Cambiar etapa/ }) === null);
  });
});

describe('Pipeline · móvil', () => {
  it('la barra es el botón flotante del sistema y se reserva el hueco', () => {
    setCompactViewport(true);
    renderActions();

    assert.ok(toolbar() === null);
    assert.ok(screen.getByRole('button', { name: 'Abrir las acciones' }));
    assert.ok(gap());
  });
});
