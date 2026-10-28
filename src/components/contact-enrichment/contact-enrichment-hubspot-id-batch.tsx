'use client';

// Agente 2A — Búsqueda por lotes con ID de HubSpot (backlog D1)
//
// Segundo modo del panel «Buscar contactos con IA». Se entra con el botón de
// HubSpot de la cabecera («Buscar por lote de HubSpot IDs»). El usuario pega de 1 a 10 Company IDs separados por coma; el
// panel busca empresa por empresa (una llamada al servidor por ID, en orden) y al
// terminar enseña el reporte: una tabla con lo que se encontró, los IDs que no
// existen en HubSpot ni en SellUp y la opción de enriquecer otras empresas.
//
// F1 — «Nueva conversación» con el lote en curso lo CANCELA: no se inicia ninguna
// empresa más (cero créditos en ellas), la que está en curso termina (una server
// action no se puede abortar) y el reporte queda como «Cancelado» con lo procesado.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RotateCcw } from '@/icons';
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
import type { AgentChatMessage, AgentChatRole, AgentChatTone } from '@/components/agent-chat';
import { ChatComposer } from '@/components/chat';
import { runHubSpotIdBatchItemAction } from '@/modules/contact-enrichment/hubspot-id-batch-actions';
import {
  HUBSPOT_ID_BATCH_MAX_IDS,
  parseHubSpotIdBatchInput,
  runHubSpotIdBatch,
  summarizeHubSpotIdBatch,
  type HubSpotIdBatchItemResult,
} from '@/modules/contact-enrichment/hubspot-id-batch-core';
import type { ContactEnrichmentChatWizardHandle } from './contact-enrichment-chat-wizard';

// ── Copy ──────────────────────────────────────────────────────────────────────

export const HUBSPOT_ID_BATCH_GREETING =
  'Hola, en este apartado puedes ingresar el HubSpot ID de tus empresas a enriquecer, separados por coma (,), de la siguiente manera, y se buscarán automáticamente: como mínimo 1 empresa y como máximo 10 empresas.\n\nEjemplo:\n65498491,65498497,984654';

export const HUBSPOT_ID_BATCH_NOT_FOUND_TITLE = 'Empresas no encontradas en HubSpot';

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function buildParseErrorMessage(raw: string): string | null {
  const parsed = parseHubSpotIdBatchInput(raw);
  if (parsed.ok) return null;
  if (parsed.reason === 'empty') {
    return 'No encontré ningún HubSpot ID. Escríbelos separados por coma, por ejemplo: 65498491,65498497,984654';
  }
  if (parsed.reason === 'invalid') {
    return `Estos valores no son HubSpot IDs válidos (solo números): ${parsed.invalid.join(', ')}. Corrígelos y vuelve a enviar la lista.`;
  }
  return `Enviaste ${parsed.count} IDs distintos. El máximo es ${HUBSPOT_ID_BATCH_MAX_IDS} empresas por búsqueda: divide la lista y vuelve a intentarlo.`;
}

export function buildBatchStartMessage(ids: string[], duplicatesRemoved: number): string {
  const base = `Voy a buscar contactos para ${plural(ids.length, 'empresa', 'empresas')}, una por una.`;
  return duplicatesRemoved > 0
    ? `${base} Quité ${plural(duplicatesRemoved, 'ID repetido', 'IDs repetidos')}.`
    : base;
}

export function buildBatchDoneMessage(results: HubSpotIdBatchItemResult[]): {
  content: string;
  tone?: AgentChatTone;
} {
  const summary = summarizeHubSpotIdBatch(results);
  if (summary.processed.length === 0) {
    return {
      content:
        summary.errors.length > 0
          ? 'Terminé, pero no pude procesar ninguna empresa. Revisa el detalle abajo.'
          : 'Terminé. Ninguno de los IDs existe en HubSpot ni en SellUp, así que no se buscó nada ni se gastaron créditos.',
      tone: 'warning',
    };
  }
  if (summary.routingDisabled) {
    return {
      content:
        'La búsqueda automática de contactos no está activada en este entorno: las empresas se prepararon, pero no se buscaron contactos.',
      tone: 'warning',
    };
  }
  const parts = [
    `Terminé. Procesé ${plural(summary.processed.length, 'empresa', 'empresas')} y encontré ${plural(
      summary.totalContactsFound,
      'contacto nuevo',
      'contactos nuevos',
    )} para revisar.`,
  ];
  if (summary.totalPreviousPending > 0) {
    parts.push(
      `Además ya tenías ${plural(summary.totalPreviousPending, 'contacto pendiente', 'contactos pendientes')} de búsquedas anteriores.`,
    );
  }
  parts.push('No creé contactos finales: requieren tu aprobación.');
  return { content: parts.join(' ') };
}

export const HUBSPOT_ID_BATCH_CANCELLING_MESSAGE =
  'Cancelando: no voy a iniciar las empresas que faltan. La empresa que está en curso termina y su resultado queda en el reporte.';

export const HUBSPOT_ID_BATCH_CANCELLED_TITLE = 'Empresas sin iniciar (no se gastaron créditos)';

export function buildBatchCancelledMessage(
  results: HubSpotIdBatchItemResult[],
  notStartedIds: string[],
): { content: string; tone: AgentChatTone } {
  const summary = summarizeHubSpotIdBatch(results);
  const parts = [
    `Lote cancelado. Procesé ${plural(results.length, 'empresa', 'empresas')} y no inicié ${plural(
      notStartedIds.length,
      'empresa',
      'empresas',
    )}.`,
  ];
  if (summary.totalContactsFound > 0) {
    parts.push(
      `Los ${plural(summary.totalContactsFound, 'contacto encontrado', 'contactos encontrados')} siguen en «Por revisar».`,
    );
  }
  parts.push('Pulsa «Nueva conversación» para empezar de nuevo.');
  return { content: parts.join(' '), tone: 'warning' };
}

// ── Estado ────────────────────────────────────────────────────────────────────

type BatchStep = 'await_ids' | 'running' | 'cancelling' | 'done' | 'cancelled';

type BatchProgress = { current: number; total: number; id: string } | null;

let messageSeq = 0;
function message(role: AgentChatRole, content: string, tone?: AgentChatTone): AgentChatMessage {
  messageSeq += 1;
  return { id: `hsb-${messageSeq}`, role, content, tone };
}

function initialMessages(): AgentChatMessage[] {
  return [message('assistant', HUBSPOT_ID_BATCH_GREETING)];
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

export function ContactEnrichmentHubSpotIdBatch({
  layout = 'panel',
  ref,
  onBusyChange,
  placeholder = 'Company IDs separados por coma',
}: ContactEnrichmentHubSpotIdBatchProps) {
  const router = useRouter();
  const [messages, setMessages] = React.useState<AgentChatMessage[]>(initialMessages);
  const [step, setStep] = React.useState<BatchStep>('await_ids');
  const [composerText, setComposerText] = React.useState('');
  const [progress, setProgress] = React.useState<BatchProgress>(null);
  const [results, setResults] = React.useState<HubSpotIdBatchItemResult[]>([]);
  const [notStartedIds, setNotStartedIds] = React.useState<string[]>([]);
  // F1 — cancelación pedida desde «Nueva conversación». Se lee antes de iniciar cada empresa.
  const cancelRequestedRef = React.useRef(false);
  // El paso, legible desde el manejador imperativo de «Nueva conversación».
  const stepRef = React.useRef<BatchStep>('await_ids');
  React.useEffect(() => {
    stepRef.current = step;
  }, [step]);
  const composerInputRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // Si el usuario reinicia, una búsqueda vieja que siga resolviendo no escribe encima.
  const generationRef = React.useRef(0);

  const { visibleCount, isRevealing } = useProgressiveReveal(messages.length);
  const isRunning = step === 'running' || step === 'cancelling';
  const isTyping = isRevealing || isRunning;
  const isFinished = step === 'done' || step === 'cancelled';

  React.useEffect(() => {
    onBusyChange?.(isRunning);
  }, [isRunning, onBusyChange]);

  // AGENT2-RESOLVE-COMPANY-ROUTE-1 — al minimizar o cerrar el panel este componente se desmonta;
  // sin esto el bucle seguía lanzando, una tras otra, búsquedas completas que nadie veía y que
  // ocupaban la fila de acciones de la pestaña (todo lo demás esperaba detrás).
  React.useEffect(() => {
    const generations = generationRef;
    return () => {
      generations.current += 1;
    };
  }, []);

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

  const composerUnlocked = step === 'await_ids';

  React.useEffect(() => {
    if (!composerUnlocked) return;
    const id = setTimeout(() => composerInputRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [composerUnlocked]);

  function reset() {
    generationRef.current += 1;
    cancelRequestedRef.current = false;
    setMessages(initialMessages());
    setStep('await_ids');
    setComposerText('');
    setProgress(null);
    setResults([]);
    setNotStartedIds([]);
  }

  /** «Nueva conversación» con el lote en curso: cancelar en vez de reiniciar. */
  function cancelInProgress(): boolean {
    if (stepRef.current !== 'running') return false;
    cancelRequestedRef.current = true;
    stepRef.current = 'cancelling';
    setStep('cancelling');
    setMessages((prev) => [...prev, message('assistant', HUBSPOT_ID_BATCH_CANCELLING_MESSAGE, 'warning')]);
    return true;
  }

  React.useImperativeHandle(ref, () => ({ reset, cancelInProgress }));

  async function handleSend() {
    if (step !== 'await_ids') return;
    const raw = composerText;
    if (!raw.trim()) return;
    setComposerText('');

    const userMessage = message('user', raw.trim());
    const parsed = parseHubSpotIdBatchInput(raw);
    if (!parsed.ok) {
      const error = buildParseErrorMessage(raw) ?? '';
      setMessages((prev) => [...prev, userMessage, message('assistant', error, 'warning')]);
      return;
    }

    const generation = generationRef.current;
    setMessages((prev) => [
      ...prev,
      userMessage,
      message('assistant', buildBatchStartMessage(parsed.ids, parsed.duplicatesRemoved)),
    ]);
    setStep('running');
    setResults([]);

    cancelRequestedRef.current = false;
    setNotStartedIds([]);

    const outcome = await runHubSpotIdBatch(parsed.ids, {
      runItem: (id) => runHubSpotIdBatchItemAction(id),
      // Desmontar (minimizar/cerrar, #765) o reiniciar también corta: cambia la generación.
      isCancelled: () => cancelRequestedRef.current || generationRef.current !== generation,
      onItemStart: ({ index, total, hubspotCompanyId }) => {
        if (generationRef.current !== generation) return;
        setProgress({ current: index + 1, total, id: hubspotCompanyId });
      },
      onItemDone: (partial) => {
        if (generationRef.current !== generation) return;
        setResults([...partial]);
      },
    });

    if (generationRef.current !== generation) return;
    setProgress(null);
    if (outcome.cancelled) {
      const cancelled = buildBatchCancelledMessage(outcome.results, outcome.notStartedIds);
      setNotStartedIds(outcome.notStartedIds);
      setMessages((prev) => [...prev, message('assistant', cancelled.content, cancelled.tone)]);
      setStep('cancelled');
      return;
    }
    const done = buildBatchDoneMessage(outcome.results);
    setMessages((prev) => [...prev, message('assistant', done.content, done.tone)]);
    setStep('done');
  }

  const summary = summarizeHubSpotIdBatch(results);
  const isPanel = layout === 'panel';
  const typingLabel = progress
    ? `Buscando empresa ${progress.current} de ${progress.total} (ID ${progress.id})…`
    : 'Escribiendo…';

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

              <div className="flex flex-wrap gap-2">
                {summary.totalContactsFound + summary.totalPreviousPending > 0 && (
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => router.push('/contacts?tab=candidates')}
                  >
                    Revisar contactos
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Button>
                )}
                {step === 'done' && (
                  <Button className="flex-1" onClick={reset} data-testid="hubspot-id-batch-restart">
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    Enriquecer otras empresas
                  </Button>
                )}
              </div>
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
            composerUnlocked
              ? placeholder
              : step === 'cancelling'
                ? 'Cancelando…'
                : isRunning
                  ? 'Buscando empresas…'
                  : step === 'cancelled'
                    ? 'Usa «Nueva conversación» para una nueva búsqueda'
                    : 'Usa «Enriquecer otras empresas» para una nueva búsqueda'
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
            <TableHead className="text-right">Contactos encontrados</TableHead>
            <TableHead className="text-right">Contactos por revisar (ejecuciones anteriores)</TableHead>
            <TableHead>HubSpot ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.hubspotCompanyId}>
              <TableCell className="font-medium">{row.name ?? '—'}</TableCell>
              <TableCell>{row.country ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{row.contactsFound}</TableCell>
              <TableCell className="text-right tabular-nums">{row.previousPendingContacts}</TableCell>
              <TableCell className="tabular-nums text-muted-foreground">{row.hubspotCompanyId}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableShell>
  );
}
