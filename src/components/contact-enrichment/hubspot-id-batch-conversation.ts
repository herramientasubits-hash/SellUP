// Agente 2A — La conversación del lote por IDs de HubSpot (puro, sin React ni red).
//
// Bryan 04-11: el lote sigue el MISMO flujo que una empresa sola. Por eso la conversación vive
// fuera del panel, como las búsquedas: minimizar o cerrar el panel ya no corta el lote (antes
// #765 lo cortaba porque las búsquedas corrían dentro del panel y nadie las veía); cada empresa
// sale en el Centro de procesos y al final hay un solo aviso. Al terminar, la caja sigue activa
// para pegar más IDs en la misma conversación.

import type { AgentChatMessage, AgentChatRole, AgentChatTone } from '@/components/agent-chat';
import { contactCountLines } from '@/modules/contact-enrichment/contact-search-summary';
import {
  HUBSPOT_ID_BATCH_MAX_IDS,
  parseHubSpotIdBatchInput,
  runHubSpotIdBatch,
  summarizeHubSpotIdBatch,
  type HubSpotIdBatchItemResult,
} from '@/modules/contact-enrichment/hubspot-id-batch-core';

// ── Copy ──────────────────────────────────────────────────────────────────────

export const HUBSPOT_ID_BATCH_GREETING =
  'Hola, en este apartado puedes ingresar el HubSpot ID de tus empresas a enriquecer, separados por coma (,) o uno por fila, y se buscarán automáticamente: como mínimo 1 empresa y como máximo 10 empresas.\n\nEjemplo:\n65498491,65498497,984654';

export const HUBSPOT_ID_BATCH_NOT_FOUND_TITLE = 'Empresas no encontradas en HubSpot';

/** Bryan 04-11: terminado el lote, la conversación sigue. */
export const HUBSPOT_ID_BATCH_NEXT_HINT = 'Puedes pegar más IDs abajo y los busco.';

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function buildParseErrorMessage(raw: string): string | null {
  const parsed = parseHubSpotIdBatchInput(raw);
  if (parsed.ok) return null;
  if (parsed.reason === 'empty') {
    return 'No encontré ningún HubSpot ID. Escríbelos separados por coma o uno por fila, por ejemplo: 65498491,65498497,984654';
  }
  if (parsed.reason === 'invalid') {
    return `Estos valores no son HubSpot IDs válidos (solo números): ${parsed.invalid.join(', ')}. Corrígelos y vuelve a enviar la lista.`;
  }
  return `Enviaste ${parsed.count} IDs distintos. El máximo es ${HUBSPOT_ID_BATCH_MAX_IDS} empresas por búsqueda: divide la lista y vuelve a intentarlo.`;
}

export function buildBatchStartMessage(ids: string[], duplicatesRemoved: number): string {
  const base = `Voy a buscar contactos para ${plural(ids.length, 'empresa', 'empresas')}, una por una. Cada una sale en el Centro de procesos.`;
  return duplicatesRemoved > 0
    ? `${base} Quité ${plural(duplicatesRemoved, 'ID repetido', 'IDs repetidos')}.`
    : base;
}

export function buildBatchDoneMessage(results: readonly HubSpotIdBatchItemResult[]): {
  content: string;
  tone?: AgentChatTone;
} {
  const summary = summarizeHubSpotIdBatch(results);
  if (summary.processed.length === 0) {
    return {
      content: `${
        summary.errors.length > 0
          ? 'Terminé, pero no pude procesar ninguna empresa. Revisa el detalle abajo.'
          : 'Terminé. Ninguno de los IDs existe en HubSpot ni en SellUp, así que no se buscó nada ni se gastaron créditos.'
      }\n\n${HUBSPOT_ID_BATCH_NEXT_HINT}`,
      tone: 'warning',
    };
  }
  if (summary.routingDisabled) {
    return {
      content:
        `La búsqueda automática de contactos no está activada en este entorno: las empresas se prepararon, pero no se buscaron contactos.\n\n${HUBSPOT_ID_BATCH_NEXT_HINT}`,
      tone: 'warning',
    };
  }
  const lines = contactCountLines(summary.counts).map((line) => `• ${line}`).join('\n');
  return {
    content: `Terminé. Procesé ${plural(summary.processed.length, 'empresa', 'empresas')}:\n\n${lines}\n\n${HUBSPOT_ID_BATCH_NEXT_HINT}`,
  };
}

export const HUBSPOT_ID_BATCH_CANCELLING_MESSAGE =
  'Cancelando: no voy a iniciar las empresas que faltan. La empresa que está en curso termina y su resultado queda en el reporte.';

export const HUBSPOT_ID_BATCH_CANCELLED_TITLE = 'Empresas sin iniciar (no se gastaron créditos)';

export function buildBatchCancelledMessage(
  results: readonly HubSpotIdBatchItemResult[],
  notStartedIds: readonly string[],
): { content: string; tone: AgentChatTone } {
  const summary = summarizeHubSpotIdBatch(results);
  const parts = [
    `Lote cancelado. Procesé ${plural(results.length, 'empresa', 'empresas')} y no inicié ${plural(
      notStartedIds.length,
      'empresa',
      'empresas',
    )}.`,
  ];
  const forReview = summary.counts.foundForReview + summary.counts.previousPending;
  if (forReview > 0) {
    parts.push(`Los ${plural(forReview, 'contacto por aprobar', 'contactos por aprobar')} siguen en «Por revisar».`);
  }
  parts.push(HUBSPOT_ID_BATCH_NEXT_HINT);
  return { content: parts.join(' '), tone: 'warning' };
}

// ── Estado ────────────────────────────────────────────────────────────────────

export type HubSpotIdBatchStep = 'await_ids' | 'running' | 'cancelling' | 'done' | 'cancelled';

export type HubSpotIdBatchProgress = { current: number; total: number; id: string } | null;

export interface HubSpotIdBatchConversationState {
  messages: AgentChatMessage[];
  step: HubSpotIdBatchStep;
  progress: HubSpotIdBatchProgress;
  /** Las empresas del ÚLTIMO lote (las de antes quedan en sus mensajes). */
  results: HubSpotIdBatchItemResult[];
  notStartedIds: string[];
}

export interface HubSpotIdBatchConversationDeps {
  /** Una empresa de principio a fin (preparar + buscar), una a la vez. */
  runItem: (hubspotCompanyId: string) => Promise<HubSpotIdBatchItemResult>;
  /** Al terminar (o cancelarse) un lote: el aviso único. */
  onBatchSettled?: (results: readonly HubSpotIdBatchItemResult[], cancelled: boolean) => void;
}

export interface HubSpotIdBatchConversation {
  getSnapshot(): HubSpotIdBatchConversationState;
  subscribe(listener: () => void): () => void;
  /** Lo que se escribió en la caja. Se ignora mientras corre un lote. */
  send(raw: string): Promise<void>;
  /** «Nueva conversación» con el lote en curso: no inicia las que faltan. true si canceló. */
  cancel(): boolean;
  /** Conversación nueva (corta lo que esté en curso sin avisar). */
  reset(): void;
  isRunning(): boolean;
}

/** ¿Se puede escribir? Al empezar y también después de un lote (terminado o cancelado). */
export function isHubSpotIdBatchComposerUnlocked(step: HubSpotIdBatchStep): boolean {
  return step === 'await_ids' || step === 'done' || step === 'cancelled';
}

export function createHubSpotIdBatchConversation(deps: HubSpotIdBatchConversationDeps): HubSpotIdBatchConversation {
  let seq = 0;
  const message = (role: AgentChatRole, content: string, tone?: AgentChatTone): AgentChatMessage => {
    seq += 1;
    return { id: `hsb-${seq}`, role, content, tone };
  };
  const initial = (): HubSpotIdBatchConversationState => ({
    messages: [message('assistant', HUBSPOT_ID_BATCH_GREETING)],
    step: 'await_ids',
    progress: null,
    results: [],
    notStartedIds: [],
  });

  let state = initial();
  let generation = 0;
  let cancelRequested = false;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<HubSpotIdBatchConversationState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const append = (...added: AgentChatMessage[]) => set({ messages: [...state.messages, ...added] });

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isRunning: () => state.step === 'running' || state.step === 'cancelling',

    async send(raw) {
      if (!isHubSpotIdBatchComposerUnlocked(state.step)) return;
      const text = (raw ?? '').trim();
      if (!text) return;
      const userMessage = message('user', text);
      const parsed = parseHubSpotIdBatchInput(raw);
      if (!parsed.ok) {
        append(userMessage, message('assistant', buildParseErrorMessage(raw) ?? '', 'warning'));
        return;
      }

      generation += 1;
      const mine = generation;
      cancelRequested = false;
      set({
        messages: [...state.messages, userMessage, message('assistant', buildBatchStartMessage(parsed.ids, parsed.duplicatesRemoved))],
        step: 'running',
        progress: null,
        results: [],
        notStartedIds: [],
      });

      const outcome = await runHubSpotIdBatch(parsed.ids, {
        runItem: deps.runItem,
        // Sólo «Nueva conversación» corta: minimizar o cerrar el panel ya no (Bryan 04-11).
        isCancelled: () => cancelRequested || generation !== mine,
        onItemStart: ({ index, total, hubspotCompanyId }) => {
          if (generation === mine) set({ progress: { current: index + 1, total, id: hubspotCompanyId } });
        },
        onItemDone: (partial) => {
          if (generation === mine) set({ results: [...partial] });
        },
      });

      if (generation !== mine) return;
      if (outcome.cancelled) {
        const cancelled = buildBatchCancelledMessage(outcome.results, outcome.notStartedIds);
        set({
          progress: null,
          notStartedIds: outcome.notStartedIds,
          messages: [...state.messages, message('assistant', cancelled.content, cancelled.tone)],
          step: 'cancelled',
        });
      } else {
        const done = buildBatchDoneMessage(outcome.results);
        set({ progress: null, messages: [...state.messages, message('assistant', done.content, done.tone)], step: 'done' });
      }
      try {
        deps.onBatchSettled?.(outcome.results, outcome.cancelled);
      } catch {
        // El aviso es cosmético: no cambia cómo terminó el lote.
      }
    },

    cancel() {
      if (state.step !== 'running') return false;
      cancelRequested = true;
      set({ step: 'cancelling', messages: [...state.messages, message('assistant', HUBSPOT_ID_BATCH_CANCELLING_MESSAGE, 'warning')] });
      return true;
    },

    reset() {
      generation += 1;
      cancelRequested = false;
      state = initial();
      for (const listener of listeners) listener();
    },
  };
}
