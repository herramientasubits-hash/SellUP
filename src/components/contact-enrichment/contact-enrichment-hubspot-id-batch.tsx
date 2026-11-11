'use client';

// Agente 2A — Búsqueda por lotes con ID de HubSpot (backlog D1)
//
// Segundo modo del panel «Buscar contactos con IA». Se entra con el botón de
// HubSpot de la cabecera («Buscar por lote de HubSpot IDs»). El usuario pega de 1 a 10 Company IDs
// separados por coma o uno por fila y el panel busca empresa por empresa.
//
// Bryan 04-11 — el MISMO flujo que una empresa sola: cada empresa se prepara en el servidor
// (resolver + request) y se busca por la ruta de «Buscar contactos con IA», así que corre en
// segundo plano, sale en el Centro de procesos, aprueba los contactos de HubSpot completos y
// trae las mismas cifras. La conversación vive fuera del panel: minimizar o cerrar ya no corta
// el lote. Al terminar hay un solo aviso y la caja sigue activa para pegar más IDs.
//
// F1 — «Nueva conversación» con el lote en curso lo CANCELA: no se inicia ninguna
// empresa más (cero créditos en ellas), la que está en curso termina y el reporte queda
// como «Cancelado» con lo procesado.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from '@/icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableShell } from '@/components/data-display';
import { AgentChatTimeline, useProgressiveReveal } from '@/components/agent-chat';
import { ChatComposer } from '@/components/chat';
import { prepareHubSpotIdBatchItemAction } from '@/modules/contact-enrichment/hubspot-id-batch-actions';
import {
  buildHubSpotIdBatchNotice,
  processHubSpotIdBatchItem,
  summarizeHubSpotIdBatch,
  type HubSpotIdBatchItemResult,
} from '@/modules/contact-enrichment/hubspot-id-batch-core';
import {
  CONTACT_SEARCH_REVIEW_HREF,
  getContactSearchRunsStore,
  newContactSearchRunId,
  showContactSearchNotice,
} from '@/modules/contact-enrichment/contact-search-runs-client';
import {
  HUBSPOT_ID_BATCH_CANCELLED_TITLE,
  HUBSPOT_ID_BATCH_NOT_FOUND_TITLE,
  createHubSpotIdBatchConversation,
  isHubSpotIdBatchComposerUnlocked,
  type HubSpotIdBatchConversation,
  type HubSpotIdBatchConversationState,
} from './hubspot-id-batch-conversation';
import type { ContactEnrichmentChatWizardHandle } from './contact-enrichment-chat-wizard';

export {
  HUBSPOT_ID_BATCH_CANCELLED_TITLE,
  HUBSPOT_ID_BATCH_CANCELLING_MESSAGE,
  HUBSPOT_ID_BATCH_GREETING,
  HUBSPOT_ID_BATCH_NOT_FOUND_TITLE,
  buildBatchCancelledMessage,
  buildBatchDoneMessage,
  buildBatchStartMessage,
  buildParseErrorMessage,
} from './hubspot-id-batch-conversation';

// ── La conversación del navegador (una sola, fuera del panel) ─────────────────

/** Una empresa: preparar en el servidor y buscar por la ruta, como una empresa sola. */
async function runBatchItem(hubspotCompanyId: string): Promise<HubSpotIdBatchItemResult> {
  return processHubSpotIdBatchItem(hubspotCompanyId, {
    prepare: (id) => prepareHubSpotIdBatchItemAction(id),
    async search(prepared) {
      const store = getContactSearchRunsStore();
      if (!store) return { ok: false, message: 'La búsqueda sólo corre en el navegador.' };
      const response = await store.startRun({
        id: newContactSearchRunId(),
        requestId: prepared.requestId,
        accountId: prepared.accountId,
        companyName: prepared.name,
        // Sale en el Centro de procesos; el aviso es uno solo, al final del lote.
        quiet: true,
      });
      return response.ok ? { ok: true, result: response.result } : { ok: false, message: response.message };
    },
  });
}

let conversation: HubSpotIdBatchConversation | null = null;

function getHubSpotIdBatchConversation(): HubSpotIdBatchConversation {
  if (conversation === null) {
    conversation = createHubSpotIdBatchConversation({
      runItem: runBatchItem,
      onBatchSettled: (results, cancelled) => showContactSearchNotice(buildHubSpotIdBatchNotice(results, cancelled)),
    });
  }
  return conversation;
}

/** Sólo para pruebas: empieza cada caso sin la conversación del anterior. */
export function resetHubSpotIdBatchConversationForTests(): void {
  conversation?.reset();
  conversation = null;
}

function useHubSpotIdBatchConversation(): [HubSpotIdBatchConversationState, HubSpotIdBatchConversation] {
  const store = getHubSpotIdBatchConversation();
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return [state, store];
}

// ── Componente ────────────────────────────────────────────────────────────────

interface ContactEnrichmentHubSpotIdBatchProps {
  layout?: 'panel' | 'page';
  ref?: React.Ref<ContactEnrichmentChatWizardHandle>;
  /** Avisa de si hay una búsqueda en curso (el panel bloquea el cambio de modo). */
  onBusyChange?: (busy: boolean) => void;
  /** Texto de la caja mientras espera los IDs. */
  placeholder?: string;
}

export const HUBSPOT_ID_BATCH_NEXT_PLACEHOLDER = 'Pega más Company IDs (con coma o uno por fila)';

export function ContactEnrichmentHubSpotIdBatch({
  layout = 'panel',
  ref,
  onBusyChange,
  placeholder = 'Company IDs (con coma o uno por fila)',
}: ContactEnrichmentHubSpotIdBatchProps) {
  const router = useRouter();
  const [state, store] = useHubSpotIdBatchConversation();
  const { messages, step, progress, results, notStartedIds } = state;
  const [composerText, setComposerText] = React.useState('');
  const composerInputRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { visibleCount, isRevealing } = useProgressiveReveal(messages.length);
  const isRunning = step === 'running' || step === 'cancelling';
  const isTyping = isRevealing || isRunning;
  const isFinished = step === 'done' || step === 'cancelled';

  React.useEffect(() => {
    onBusyChange?.(isRunning);
  }, [isRunning, onBusyChange]);

  // Al cerrar o minimizar el panel, el lote en curso SIGUE (vuelve a verse al abrir el modo
  // por lotes). Si no había nada en curso, la próxima vez se empieza con la conversación limpia.
  React.useEffect(() => {
    return () => {
      if (!store.isRunning()) store.reset();
    };
  }, [store]);

  React.useEffect(() => {
    requestAnimationFrame(() => {
      const scrollEl =
        (scrollRef.current?.closest('.overflow-y-auto') as HTMLElement | null) ??
        (scrollRef.current?.parentElement as HTMLElement | null);
      if (scrollEl) {
        const prefersReduced =
          typeof window !== 'undefined' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: prefersReduced ? 'auto' : 'smooth' });
      }
    });
  }, [visibleCount, step, isTyping, progress]);

  const composerUnlocked = isHubSpotIdBatchComposerUnlocked(step);

  React.useEffect(() => {
    if (!composerUnlocked) return;
    const id = setTimeout(() => composerInputRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [composerUnlocked]);

  React.useImperativeHandle(ref, () => ({
    reset: () => {
      setComposerText('');
      store.reset();
    },
    cancelInProgress: () => store.cancel(),
  }));

  function handleSend() {
    if (!composerUnlocked) return;
    const raw = composerText;
    if (!raw.trim()) return;
    setComposerText('');
    void store.send(raw);
  }

  const summary = summarizeHubSpotIdBatch(results);
  const isPanel = layout === 'panel';
  const typingLabel = progress
    ? `Buscando empresa ${progress.current} de ${progress.total} (ID ${progress.id})…`
    : 'Escribiendo…';
  const forReview = summary.counts.foundForReview + summary.counts.previousPending;

  return (
    <div
      className={cn('flex flex-col', isPanel ? 'h-full min-h-0 flex-1' : 'mx-auto min-h-full w-full max-w-2xl')}
      data-testid="hubspot-id-batch"
    >
      <div className={cn(isPanel && 'min-h-0 flex-1 overflow-y-auto px-4 py-5')}>
        <div ref={scrollRef} className="flex flex-col gap-4 pb-4">
          <AgentChatTimeline
            messages={messages}
            visibleCount={visibleCount}
            isTyping={isTyping}
            typingLabel={typingLabel}
          />

          {isFinished && !isRevealing && (
            <div className="space-y-3">
              {summary.processed.length > 0 && (
                <HubSpotIdBatchReportTable rows={summary.processed} cancelled={step === 'cancelled'} />
              )}

              {step === 'cancelled' && notStartedIds.length > 0 && (
                <Alert data-testid="hubspot-id-batch-not-started">
                  <AlertTitle>{HUBSPOT_ID_BATCH_CANCELLED_TITLE}</AlertTitle>
                  <AlertDescription>
                    <p>{notStartedIds.join(', ')}</p>
                  </AlertDescription>
                </Alert>
              )}

              {summary.notFoundIds.length > 0 && (
                <Alert data-testid="hubspot-id-batch-not-found">
                  <AlertTitle>{HUBSPOT_ID_BATCH_NOT_FOUND_TITLE}</AlertTitle>
                  <AlertDescription>
                    <p>{summary.notFoundIds.join(', ')}</p>
                  </AlertDescription>
                </Alert>
              )}

              {summary.errors.length > 0 && (
                <Alert variant="destructive" data-testid="hubspot-id-batch-errors">
                  <AlertTitle>No se pudieron procesar</AlertTitle>
                  <AlertDescription>
                    <ul className="space-y-1">
                      {summary.errors.map((row) => (
                        <li key={row.hubspotCompanyId}>
                          {row.name ? `${row.name} (${row.hubspotCompanyId})` : row.hubspotCompanyId}:{' '}
                          {row.errorMessage}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {forReview > 0 && (
                <Button variant="outline" className="w-full" onClick={() => router.push(CONTACT_SEARCH_REVIEW_HREF)}>
                  Revisar contactos
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={cn(isPanel ? 'shrink-0 px-4 pb-4 pt-2' : 'sticky bottom-0 mt-auto bg-background pb-2 pt-3')}>
        <ChatComposer
          compact
          value={composerUnlocked ? composerText : ''}
          onChange={setComposerText}
          onSend={handleSend}
          placeholder={
            step === 'await_ids'
              ? placeholder
              : composerUnlocked
                ? HUBSPOT_ID_BATCH_NEXT_PLACEHOLDER
                : step === 'cancelling'
                  ? 'Cancelando…'
                  : 'Buscando empresas…'
          }
          disabled={!composerUnlocked}
          maxLength={400}
          inputRef={composerInputRef}
        />
      </div>
    </div>
  );
}

// ── Tabla del reporte ─────────────────────────────────────────────────────────

export function HubSpotIdBatchReportTable({
  rows,
  cancelled = false,
}: {
  rows: HubSpotIdBatchItemResult[];
  /** F1 — el lote se canceló: el reporte lo dice en el título. */
  cancelled?: boolean;
}) {
  return (
    <TableShell
      data-testid="hubspot-id-batch-report"
      title={
        <>
          Reporte de la ejecución
          <Badge variant="neutral">{rows.length}</Badge>
          {cancelled && (
            <Badge variant="warning" data-testid="hubspot-id-batch-cancelled-badge">
              Cancelado
            </Badge>
          )}
        </>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>País</TableHead>
            <TableHead className="text-right">Aprobados (nuevos)</TableHead>
            <TableHead className="text-right">Por aprobar (encontrados / anteriores)</TableHead>
            <TableHead>HubSpot ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.hubspotCompanyId}>
              <TableCell className="font-medium">{row.name ?? '—'}</TableCell>
              <TableCell>{row.country ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.approvedContacts} ({row.approvedNow})
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.contactsFound + row.previousPendingContacts} ({row.contactsFound} / {row.previousPendingContacts})
              </TableCell>
              <TableCell className="tabular-nums text-muted-foreground">{row.hubspotCompanyId}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableShell>
  );
}
