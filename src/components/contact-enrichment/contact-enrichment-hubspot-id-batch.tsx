'use client';

// Agente 2A — Búsqueda por lotes con ID de HubSpot (backlog D1)
//
// Segundo modo del panel «Buscar contactos con IA». Se entra con el botón «ID»
// de la cabecera. El usuario pega de 1 a 10 Company IDs separados por coma; el
// panel busca empresa por empresa (una llamada al servidor por ID, en orden) y al
// terminar enseña el reporte: una tabla con lo que se encontró, los IDs que no
// existen en HubSpot ni en SellUp y la opción de enriquecer otras empresas.

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
  HUBSPOT_ID_BATCH_COPY,
  HUBSPOT_ID_BATCH_MAX_IDS,
  parseHubSpotIdBatchInput,
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

// ── Estado ────────────────────────────────────────────────────────────────────

type BatchStep = 'await_ids' | 'running' | 'done';

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
  /** Avisa de si hay una búsqueda en curso, para no ofrecer «Nueva conversación» a medias. */
  onBusyChange?: (busy: boolean) => void;
}

export function ContactEnrichmentHubSpotIdBatch({
  layout = 'panel',
  ref,
  onBusyChange,
}: ContactEnrichmentHubSpotIdBatchProps) {
  const router = useRouter();
  const [messages, setMessages] = React.useState<AgentChatMessage[]>(initialMessages);
  const [step, setStep] = React.useState<BatchStep>('await_ids');
  const [composerText, setComposerText] = React.useState('');
  const [progress, setProgress] = React.useState<BatchProgress>(null);
  const [results, setResults] = React.useState<HubSpotIdBatchItemResult[]>([]);
  const composerInputRef = React.useRef<HTMLTextAreaElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // Si el usuario reinicia, una búsqueda vieja que siga resolviendo no escribe encima.
  const generationRef = React.useRef(0);

  const { visibleCount, isRevealing } = useProgressiveReveal(messages.length);
  const isRunning = step === 'running';
  const isTyping = isRevealing || isRunning;

  React.useEffect(() => {
    onBusyChange?.(isRunning);
  }, [isRunning, onBusyChange]);

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
    setMessages(initialMessages());
    setStep('await_ids');
    setComposerText('');
    setProgress(null);
    setResults([]);
  }

  React.useImperativeHandle(ref, () => ({ reset }));

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

    const collected: HubSpotIdBatchItemResult[] = [];
    for (const [index, id] of parsed.ids.entries()) {
      if (generationRef.current !== generation) return;
      setProgress({ current: index + 1, total: parsed.ids.length, id });
      let result: HubSpotIdBatchItemResult;
      try {
        result = await runHubSpotIdBatchItemAction(id);
      } catch {
        // Una invocación cortada no tumba el lote: la empresa queda como error y se sigue.
        result = {
          hubspotCompanyId: id,
          status: 'error',
          name: null,
          country: null,
          accountId: null,
          contactsFound: 0,
          previousPendingContacts: 0,
          routingDisabled: false,
          errorMessage: HUBSPOT_ID_BATCH_COPY.unexpected,
        };
      }
      collected.push(result);
      if (generationRef.current !== generation) return;
      setResults([...collected]);
    }

    if (generationRef.current !== generation) return;
    const done = buildBatchDoneMessage(collected);
    setMessages((prev) => [...prev, message('assistant', done.content, done.tone)]);
    setProgress(null);
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

          {step === 'done' && !isRevealing && (
            <div className="space-y-3">
              {summary.processed.length > 0 && <HubSpotIdBatchReportTable rows={summary.processed} />}

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
                <Button className="flex-1" onClick={reset} data-testid="hubspot-id-batch-restart">
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Enriquecer otras empresas
                </Button>
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
              ? 'Pega los HubSpot ID separados por coma…'
              : isRunning
                ? 'Buscando empresas…'
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

export function HubSpotIdBatchReportTable({ rows }: { rows: HubSpotIdBatchItemResult[] }) {
  return (
    <TableShell
      data-testid="hubspot-id-batch-report"
      title={
        <>
          Reporte de la ejecución
          <Badge variant="neutral">{rows.length}</Badge>
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
