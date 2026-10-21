/**
 * AGENT3-FIRST-CALL-2 — el Agente 3 en el Pipeline, contrato RUNTIME:
 *
 *   · investigar y preparar son UNA etapa, «Primer contacto» (dueña 21-10);
 *   · apagado, sigue «Próximamente»;
 *   · encendido y sin nada hecho, es una invitación con «Preparar primera llamada»;
 *   · con investigación y paquetes, es una tarjeta con su resumen y su enlace a la empresa;
 *   · «Mover de etapa» ofrece la IA (el Agente 3) en investigar y preparar;
 *   · la barra de acciones ofrece «Preparar primera llamada» sólo con el agente presente.
 */

import {
  resetRailPreferences,
  setCompactViewport,
  visibleActionLabels,
} from '../../../../components/action-rail/__tests__/rail-test-dom';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import type { JourneyFirstCall } from '@/modules/pipeline/types';
import { applyFirstCallToJourney } from '@/modules/pipeline/journey-first-call';
import { buildJourney } from './pipeline-fixtures';
import { findMoveDialog, moveOption } from './stage-move-helpers';

const refreshes: number[] = [];
mock.module('next/navigation', {
  namedExports: { useRouter: () => ({ refresh: () => refreshes.push(1), push: () => {}, replace: () => {} }) },
});
mock.module('sonner', {
  namedExports: { toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} } },
});
mock.module('@/modules/speech/actions', {
  namedExports: {
    getFirstCallState: async () => ({ enabled: true, brief: null, packs: [] }),
    getFirstCallProgress: async () => null,
    getFirstCallEnabled: async () => true,
    markFirstCallPackUsed: async () => ({ success: true }),
    discardFirstCallPack: async () => ({ success: true }),
    saveFirstCallScriptEdit: async () => ({ success: true }),
  },
});

let rtl: typeof import('@testing-library/react');
let PipelineStageCards: (typeof import('../pipeline-stage-cards'))['PipelineStageCards'];
let StageMoveDialog: (typeof import('../pipeline-stage-move'))['StageMoveDialog'];
let PipelineScreenActions: (typeof import('../pipeline-screen-actions'))['PipelineScreenActions'];
let ListActionRailProvider: (typeof import('@/components/action-rail'))['ListActionRailProvider'];
let TooltipProvider: (typeof import('@/components/ui/tooltip'))['TooltipProvider'];

const h = React.createElement;

before(async () => {
  rtl = await import('@testing-library/react');
  ({ PipelineStageCards } = await import('../pipeline-stage-cards'));
  ({ StageMoveDialog } = await import('../pipeline-stage-move'));
  ({ PipelineScreenActions } = await import('../pipeline-screen-actions'));
  ({ ListActionRailProvider } = await import('@/components/action-rail'));
  ({ TooltipProvider } = await import('@/components/ui/tooltip'));
});

beforeEach(() => {
  refreshes.length = 0;
  setCompactViewport(false);
});

afterEach(() => {
  rtl.cleanup();
  resetRailPreferences();
});

const CONTACTS = [{ id: 'c1', name: 'María Pérez', title: 'Gerente de Talento' }];

const EMPTY: JourneyFirstCall = { freshBrief: false, brief: null, packs: [], contacts: CONTACTS };
const DONE: JourneyFirstCall = {
  freshBrief: true,
  brief: {
    status: 'sufficient',
    summary: 'Cadena de tiendas en expansión.',
    completedAt: '2026-10-10T10:01:00Z',
    factsCount: 7,
    sourcesCount: 5,
    topics: [
      { label: 'Qué le está pasando ahora', count: 2 },
      { label: 'Talento y formación', count: 3 },
    ],
    hypotheses: [{ text: 'Podría necesitar planes de formación para el personal nuevo.', productName: 'Planes de Formación' }],
    gapsCount: 2,
    expiresAt: '2026-11-09T10:01:00Z',
  },
  packs: [
    { id: 'p2', contactId: 'c1', targetName: 'María Pérez', targetTitle: 'Gerente de Talento', channel: 'whatsapp', status: 'used', createdAt: '2026-10-12T09:00:00Z', usedAt: '2026-10-13T09:00:00Z', productNames: ['Evaluaciones 360'] },
    { id: 'p1', contactId: null, targetName: null, targetTitle: null, channel: 'call', status: 'needs_review', createdAt: '2026-10-11T09:00:00Z', usedAt: null, productNames: [] },
  ],
  contacts: CONTACTS,
};

const stage = (id: string) => document.getElementById(`etapa-${id}`) as HTMLElement;

/** La etapa actual llega abierta; las demás, plegadas: se abre sólo si hace falta. */
function open(card: HTMLElement) {
  const toggle = card.querySelector('[aria-expanded]') as HTMLElement;
  if (toggle.getAttribute('aria-expanded') !== 'true') rtl.fireEvent.click(toggle);
}

function renderCards(firstCall: JourneyFirstCall | null) {
  const journey = applyFirstCallToJourney(buildJourney(), firstCall);
  rtl.render(h(PipelineStageCards, { journey }));
  return journey;
}

describe('Pipeline · etapas del Agente 3 en el recorrido', () => {
  it('apagado, siguen «Próximamente» y no ofrecen nada', () => {
    renderCards(null);
    assert.equal(stage('inteligencia'), null, 'ya no hay etapa «Inteligencia» aparte');
    assert.equal(stage('preparacion'), null, 'ya no hay etapa «Preparación» aparte');
    assert.ok(!stage('primer_contacto').hasAttribute('data-invitation'));
    assert.ok(rtl.within(stage('primer_contacto')).getByText('Próximamente'));
    assert.equal(rtl.screen.queryByRole('button', { name: 'Preparar primer contacto con Rumbo IA' }), null);
  });

  it('encendido y sin nada hecho, «Primer contacto» invita UNA vez con el botón del agente', () => {
    renderCards(EMPTY);
    const card = stage('primer_contacto');
    assert.ok(card.hasAttribute('data-invitation'));
    assert.ok(card.querySelector('[aria-expanded]') === null, 'una invitación no se pliega');
    assert.ok(rtl.within(card).getByText('Agente 3'));
    assert.equal(rtl.screen.getAllByRole('button', { name: 'Preparar primer contacto con Rumbo IA' }).length, 1);
    assert.ok(rtl.within(card).getByText(/Aún no se ha preparado el primer contacto con Globex\. El agente investiga la empresa/));
  });

  it('con la investigación hecha, la etapa resume qué encontró, sus hipótesis y lleva a «Primer contacto»', () => {
    renderCards(DONE);
    const research = stage('primer_contacto');
    assert.ok(!research.hasAttribute('data-invitation'));
    open(research);
    assert.ok(rtl.within(research).getByText('Suficiente para contactar'));
    assert.ok(rtl.within(research).getByText('Cadena de tiendas en expansión.'));
    const found = rtl.within(research).getByRole('region', { name: 'Qué encontró' });
    assert.match(found.textContent ?? '', /Talento y formación · 3/);
    const hypotheses = rtl.within(research).getByRole('region', { name: 'Hipótesis para UBITS' });
    assert.ok(rtl.within(hypotheses).getByText('Planes de Formación'));
    assert.ok(rtl.within(research).getByText(/2 preguntas quedaron sin respuesta/));
    const link = rtl.within(research).getByRole('link', { name: 'Abrir la investigación' });
    assert.equal(link.getAttribute('href'), '/accounts/globex?tab=primer-contacto');
    assert.equal(rtl.within(research).queryByRole('button', { name: /Ver más/ }), null, 'no abre el drawer de detalle');
  });

  it('con preparaciones, la MISMA etapa las agrupa por decisor y canal, dice lo que falta y lleva a «Primer contacto»', () => {
    renderCards(DONE);
    const prep = stage('primer_contacto');
    open(prep);
    const list = rtl.within(prep).getByRole('list', { name: 'Preparaciones por decisor' });
    assert.equal(list.children.length, 2, 'María y «sin decisor»');
    const maria = rtl.within(prep).getByRole('list', { name: 'Canales de María Pérez' });
    assert.ok(rtl.within(maria).getByText('WhatsApp: Usada'));
    assert.ok(rtl.within(maria).getByText('Llamada: falta'));
    assert.ok(rtl.within(list).getByText('Evaluaciones 360'));
    const none = rtl.within(prep).getByRole('list', { name: 'Canales de Sin decisor' });
    assert.ok(rtl.within(none).getByText('Llamada: Revisar'));
    assert.ok(rtl.within(prep).getByText(/Falta preparar a 1 decisor/));
    assert.equal(rtl.within(prep).getByRole('link', { name: 'Ver las preparaciones' }).getAttribute('href'), '/accounts/globex?tab=primer-contacto');
    assert.ok(rtl.within(prep).getByRole('button', { name: 'Preparar lo que falta' }));
    assert.ok(rtl.within(prep).getByRole('button', { name: 'Preparar otro' }));
  });

  it('una empresa archivada no ofrece preparar el primer contacto', () => {
    const journey = applyFirstCallToJourney(buildJourney({ pipeline_status: 'archived' }), EMPTY);
    rtl.render(h(PipelineStageCards, { journey }));
    assert.equal(rtl.screen.queryByRole('button', { name: 'Preparar primer contacto con Rumbo IA' }), null);
    assert.ok(rtl.within(stage('primer_contacto')).getByText(/la empresa está archivada/));
  });
});

describe('Pipeline · «Mover de etapa» ofrece el Agente 3', () => {
  async function renderDialog(props: Partial<React.ComponentProps<typeof StageMoveDialog>>) {
    rtl.render(
      h(StageMoveDialog, {
        accountName: 'Globex',
        toStatus: 'ready_for_research',
        onConfirm: async () => ({ success: true as const }),
        onCancel: () => {},
        canUseAi: true,
        canUploadContacts: true,
        ...props,
      }),
    );
    return findMoveDialog(rtl);
  }

  it('encendido, «Que lo haga la IA» queda disponible en investigar y en preparar', async () => {
    for (const toStatus of ['ready_for_research', 'research_in_progress', 'ready_for_outreach'] as const) {
      const dialog = await renderDialog({ toStatus, firstCallEnabled: true });
      const ai = moveOption(rtl, dialog, 'Que lo haga la IA');
      assert.equal(ai.disabled, false, toStatus);
      assert.match(ai.textContent ?? '', /Abre el agente 3 en el panel lateral/);
      rtl.cleanup();
    }
  });

  it('apagado, sigue diciendo que el agente llega pronto', async () => {
    const dialog = await renderDialog({ toStatus: 'ready_for_research', firstCallEnabled: false });
    const ai = moveOption(rtl, dialog, 'Que lo haga la IA');
    assert.equal(ai.disabled, true);
    assert.match(ai.textContent ?? '', /llega pronto/);
  });

  it('el Agente 3 no cambia la etapa de contactos: ahí sigue el agente 2A', async () => {
    const dialog = await renderDialog({ toStatus: 'new', firstCallEnabled: true });
    assert.match(moveOption(rtl, dialog, 'Que lo haga la IA').textContent ?? '', /agente 2A/);
  });

  it('si quien monta el diálogo no puede abrir agentes, lo dice también para el Agente 3', async () => {
    const dialog = await renderDialog({ toStatus: 'ready_for_research', firstCallEnabled: true, canUseAi: false });
    assert.equal(moveOption(rtl, dialog, 'Que lo haga la IA').disabled, true);
  });
});

describe('Pipeline · barra de acciones', () => {
  function renderActions(options: { agent3: JourneyFirstCall | null; archived?: boolean; onPrepare?: () => void }) {
    const base = buildJourney(options.archived ? { pipeline_status: 'archived' } : {});
    const journey = applyFirstCallToJourney(base, options.agent3);
    rtl.render(
      h(
        TooltipProvider,
        null,
        h(ListActionRailProvider, {
          label: 'Acciones del pipeline',
          gender: 'f' as const,
          children: h(PipelineScreenActions, {
            journey,
            onChangeStage: async () => ({ success: true as const }),
            onSearchContacts: () => {},
            onViewAccount: () => {},
            onPrepareFirstCall: options.onPrepare,
          }),
        }),
      ),
    );
  }
  const labels = () =>
    visibleActionLabels(Array.from((rtl.screen.getByRole('toolbar') as HTMLElement).querySelectorAll<HTMLElement>('button')));

  it('con el agente presente ofrece «Preparar primer contacto» y la abre', () => {
    let opened = 0;
    renderActions({ agent3: EMPTY, onPrepare: () => (opened += 1) });
    assert.ok(labels().includes('Preparar primer contacto con Rumbo IA'));
    const button = Array.from((rtl.screen.getByRole('toolbar') as HTMLElement).querySelectorAll<HTMLElement>('button')).find(
      (candidate) => candidate.getAttribute('aria-label') === 'Preparar primer contacto con Rumbo IA',
    ) as HTMLElement;
    rtl.fireEvent.click(button);
    assert.equal(opened, 1);
  });

  it('sin el agente en el recorrido, o con la empresa archivada, no se ofrece', () => {
    renderActions({ agent3: null, onPrepare: () => {} });
    assert.ok(!labels().includes('Preparar primer contacto con Rumbo IA'));
    rtl.cleanup();
    renderActions({ agent3: EMPTY, archived: true, onPrepare: () => {} });
    assert.ok(!labels().includes('Preparar primer contacto con Rumbo IA'));
  });
});
