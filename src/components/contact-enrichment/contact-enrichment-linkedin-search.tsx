'use client';

// Agente 2A — Modo «Buscar contacto por LinkedIn o correo» del panel del agente.
// F1 abre el modo, F2 lo llena; AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE suma el correo y el
// candidato inmediato.
//
// Detrás de CONTACT_ENRICHMENT_LINKEDIN_SEARCH_ENABLED (apagada por defecto). Flujo:
//   1. el usuario pega el enlace del perfil o el correo; el chat NO lo repite (dato personal);
//   2. el servidor detecta qué es, mira si ya existe (SellUp; con correo también HubSpot),
//      enriquece si hace falta (Apollo y, si no, Lusha), resuelve la empresa (HubSpot primero,
//      luego SellUp; sólo coincidencia única) y CREA el candidato en «Por revisar»;
//   3. el chat muestra lo encontrado y «Revisar ahora», que abre la ficha del candidato en
//      «Por revisar»: revelar teléfono, confirmar o reasignar la empresa, aprobar o rechazar.
//      Si el usuario no decide, el candidato ya está en «Por revisar».

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RotateCcw, UserSearch } from '@/icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AgentChatTimeline, useProgressiveReveal } from '@/components/agent-chat';
import type { AgentChatMessage, AgentChatRole, AgentChatTone } from '@/components/agent-chat';
import { ChatComposer } from '@/components/chat';
import { ChatCardView } from '@/components/chat/chat-card-view';
import type { ChatCardRow } from '@/components/chat/types';
import { CONTACT_SEARCH_REVIEW_HREF } from '@/modules/contact-enrichment/contact-search-runs-client';
import {
  CANDIDATE_REVIEW_OPEN_EVENT,
  candidateReviewHref,
} from '@/modules/contact-enrichment/candidate-review-link';
import { detectContactSearchInput } from '@/modules/contact-enrichment/contact-search-input';
import {
  searchContactQuickAction,
  type ContactQuickSearchResult,
} from '@/modules/contact-enrichment/linkedin-contact-search-actions';
import type { LinkedinSearchPreview } from '@/modules/contact-enrichment/linkedin-contact-search-core';
import type { ContactEnrichmentChatWizardHandle } from './contact-enrichment-chat-wizard';

// ── Copy ──────────────────────────────────────────────────────────────────────

export const LINKEDIN_SEARCH_GREETING =
  'Pega el enlace del perfil de LinkedIn (linkedin.com/in/nombre-apellido) o el correo de la persona que buscas. Antes de gastar créditos reviso si ya la tenemos.';

/** Lo que muestra el chat en lugar de lo pegado. */
export const LINKEDIN_USER_MESSAGE = 'Perfil de LinkedIn enviado.';
export const EMAIL_USER_MESSAGE = 'Correo enviado.';
const OTHER_USER_MESSAGE = 'Búsqueda enviada.';

export const LINKEDIN_SEARCHING_LABEL = 'Buscando a la persona…';

const CREDITS_SPENT_NOTE = 'La consulta al proveedor quedó registrada en el uso.';

export const REVIEW_NOW_LABEL = 'Revisar ahora';
export const OPEN_CANDIDATE_LABEL = 'Abrir candidato';

function sourceLabel(provider: LinkedinSearchPreview['provider']): string {
  if (provider === 'hubspot') return 'HubSpot';
  return provider === 'apollo' ? 'Apollo' : 'Lusha';
}

export function userMessageFor(raw: string): string {
  const input = detectContactSearchInput(raw);
  if (input.kind === 'email') return EMAIL_USER_MESSAGE;
  if (input.kind === 'linkedin') return LINKEDIN_USER_MESSAGE;
  return OTHER_USER_MESSAGE;
}

type CreatedResult = Extract<ContactQuickSearchResult, { status: 'created' }>;

export function buildLinkedinPreviewRows(
  preview: LinkedinSearchPreview,
  options: { entryMode?: CreatedResult['entryMode']; company?: CreatedResult['company'] | undefined } = {},
): ChatCardRow[] {
  const rows: ChatCardRow[] = [
    { key: 'name', label: 'Nombre', value: preview.fullName },
    { key: 'title', label: 'Cargo', value: preview.title ?? '—' },
  ];
  if (preview.provider !== 'hubspot') {
    rows.push({
      key: 'company',
      label: `Empresa actual según ${sourceLabel(preview.provider)}`,
      value: preview.providerCompanyName ?? preview.providerCompanyDomain ?? '—',
    });
  }
  if (options.company !== undefined) {
    rows.push({
      key: 'assigned-company',
      label: 'Empresa asignada',
      value: options.company?.name ?? 'Sin empresa asociada',
      hint: options.company ? null : 'Asígnala al revisar: sin empresa no se puede aprobar.',
    });
  }
  rows.push({ key: 'email', label: 'Correo', value: preview.email ?? 'No encontrado' });
  if (options.entryMode === 'email_single') {
    rows.push({ key: 'linkedin', label: 'LinkedIn', value: preview.hasLinkedin ? 'Encontrado' : 'No encontrado' });
  }
  rows.push({
    key: 'phone',
    label: 'Teléfono',
    value: preview.hasPhone ? 'Registrado en HubSpot' : 'Se revela desde la ficha del candidato',
  });
  return rows;
}

/** El mensaje del asistente cuando el candidato quedó creado. */
export function quickSearchCreatedMessage(result: CreatedResult): string {
  const name = result.preview.fullName;
  const fromHubSpot = result.preview.provider === 'hubspot';
  const parts: string[] = [
    fromHubSpot
      ? `Encontré a ${name} en HubSpot (sin gastar créditos) y lo dejé en «Por revisar»`
      : `Encontré a ${name} y lo dejé en «Por revisar»`,
  ];
  parts[0] += result.company
    ? ` con ${result.company.name}.`
    : ' sin empresa: no hubo una coincidencia única en HubSpot ni en SellUp. Asígnala con «Reasignar empresa» antes de aprobar.';
  if (result.company && result.companyMismatch) {
    parts.push(
      `Ojo: según ${sourceLabel(result.preview.provider)} trabaja en otra empresa; puede haber cambiado de trabajo.`,
    );
  }
  parts.push(
    'Revísalo ahora para revelar el teléfono, confirmar la empresa y aprobarlo o rechazarlo. Si no, te espera en «Por revisar».',
  );
  return parts.join(' ');
}

/** Mensaje del asistente para cada desenlace que no es un candidato creado. */
export function linkedinResultMessage(result: Exclude<ContactQuickSearchResult, { status: 'created' }>): {
  content: string;
  tone: AgentChatTone;
} {
  switch (result.status) {
    case 'disabled':
      return { content: 'La búsqueda por LinkedIn o correo no está activada en este entorno.', tone: 'warning' };
    case 'invalid_input':
      return { content: `${result.message} No se gastaron créditos.`, tone: 'warning' };
    case 'already_known': {
      const who = [result.match.fullName, result.match.companyName].filter(Boolean).join(' · ');
      const where =
        result.where === 'hubspot_contact'
          ? 'en HubSpot'
          : result.where === 'sellup_pending_candidate'
            ? 'en «Por revisar»'
            : 'en SellUp';
      const parts = [result.message];
      if (who) parts.push(`Coincide ${where} con: ${who}.`);
      if (result.creditsSpent) parts.push(CREDITS_SPENT_NOTE);
      return { content: parts.join(' '), tone: 'default' };
    }
    case 'not_found':
      return {
        content: result.creditsSpent
          ? `${result.message} No se creó nada. ${CREDITS_SPENT_NOTE}`
          : `${result.message} No se creó nada.`,
        tone: 'warning',
      };
    case 'provider_error':
      return { content: result.message, tone: 'error' };
    case 'create_failed':
      return { content: result.message, tone: 'error' };
  }
}

// ── Estado ────────────────────────────────────────────────────────────────────

type Step = 'await_input' | 'searching' | 'retry';

let messageSeq = 0;
function message(role: AgentChatRole, content: string, tone?: AgentChatTone): AgentChatMessage {
  messageSeq += 1;
  return { id: `li-${messageSeq}`, role, content, tone };
}

/** Lo que el chat ofrece después de la última búsqueda. */
type LastOutcome =
  | { kind: 'created'; result: CreatedResult }
  | { kind: 'pending'; candidateId: string }
  | null;

interface ContactEnrichmentLinkedinSearchProps {
  layout?: 'panel' | 'page';
  ref?: React.Ref<ContactEnrichmentChatWizardHandle>;
  onBusyChange?: (busy: boolean) => void;
  placeholder: string;
}

export function ContactEnrichmentLinkedinSearch({
  layout = 'panel',
  ref,
  onBusyChange,
  placeholder,
}: ContactEnrichmentLinkedinSearchProps) {
  const router = useRouter();
  const [messages, setMessages] = React.useState<AgentChatMessage[]>(() => [
    message('assistant', LINKEDIN_SEARCH_GREETING),
  ]);
  const [step, setStep] = React.useState<Step>('await_input');
  const [composerText, setComposerText] = React.useState('');
  const [outcome, setOutcome] = React.useState<LastOutcome>(null);
  // Lo pegado para «Reintentar»: vive sólo en memoria, nunca en el hilo.
  const lastInputRef = React.useRef<string | null>(null);
  const aliveRef = React.useRef(true);
  const composerInputRef = React.useRef<HTMLTextAreaElement>(null);

  const { visibleCount, isRevealing } = useProgressiveReveal(messages.length);
  const searching = step === 'searching';

  React.useEffect(() => {
    onBusyChange?.(searching);
  }, [searching, onBusyChange]);

  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // El panel remonta este componente para una conversación nueva.
  React.useImperativeHandle(ref, () => ({ reset: () => {} }));

  // Después de cualquier resultado se puede buscar a otra persona sin abrir otra conversación.
  const composerUnlocked = step === 'await_input' || step === 'retry';

  React.useEffect(() => {
    if (!composerUnlocked) return;
    const id = setTimeout(() => composerInputRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [composerUnlocked]);

  async function runSearch(raw: string) {
    lastInputRef.current = raw;
    setOutcome(null);
    setStep('searching');
    let result: ContactQuickSearchResult;
    try {
      result = await searchContactQuickAction(raw);
    } catch {
      result = { status: 'provider_error', message: 'No pudimos completar la búsqueda. Intenta de nuevo.' };
    }
    if (!aliveRef.current) return;
    if (result.status === 'created') {
      lastInputRef.current = null;
      setMessages((prev) => [...prev, message('assistant', quickSearchCreatedMessage(result))]);
      setOutcome({ kind: 'created', result });
      setStep('await_input');
      return;
    }
    const reply = linkedinResultMessage(result);
    setMessages((prev) => [...prev, message('assistant', reply.content, reply.tone)]);
    if (result.status === 'already_known' && result.candidateId) {
      setOutcome({ kind: 'pending', candidateId: result.candidateId });
    }
    if (result.status === 'provider_error') {
      setStep('retry');
      return;
    }
    lastInputRef.current = null;
    setStep('await_input');
  }

  async function handleSend() {
    if (!composerUnlocked) return;
    const raw = composerText.trim();
    if (!raw) return;
    setComposerText('');
    setMessages((prev) => [...prev, message('user', userMessageFor(raw))]);
    await runSearch(raw);
  }

  async function handleRetry() {
    const raw = lastInputRef.current;
    if (!raw || searching) return;
    setMessages((prev) => [...prev, message('user', 'Reintentar')]);
    await runSearch(raw);
  }

  /**
   * Abre la ficha en «Por revisar». Si la tabla ya está montada (el panel se abrió encima de
   * «Por revisar»), el evento la abre al instante; si no, la query la abre al llegar.
   */
  function openCandidate(candidateId: string) {
    window.dispatchEvent(new window.CustomEvent(CANDIDATE_REVIEW_OPEN_EVENT, { detail: { candidateId } }));
    router.push(candidateReviewHref(CONTACT_SEARCH_REVIEW_HREF, candidateId));
  }

  const isPanel = layout === 'panel';
  const created = outcome?.kind === 'created' ? outcome.result : null;

  return (
    <div
      className={cn('flex flex-col', isPanel ? 'h-full min-h-0 flex-1' : 'mx-auto min-h-full w-full max-w-2xl')}
      data-testid="linkedin-contact-search"
    >
      <div className={cn(isPanel && 'min-h-0 flex-1 overflow-y-auto px-4 py-5')}>
        <div className="flex flex-col gap-4 pb-4">
          <AgentChatTimeline
            messages={messages}
            visibleCount={visibleCount}
            isTyping={isRevealing || searching}
            typingLabel={searching ? LINKEDIN_SEARCHING_LABEL : 'Escribiendo…'}
          />

          {step === 'retry' && !isRevealing && (
            <Button variant="outline" onClick={handleRetry} data-testid="linkedin-search-retry">
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reintentar
            </Button>
          )}

          {created && !isRevealing && (
            <div className="space-y-3">
              <ChatCardView
                data-testid="linkedin-preview"
                card={{
                  kind: 'rows',
                  title: `Datos encontrados en ${sourceLabel(created.preview.provider)}`,
                  rows: buildLinkedinPreviewRows(created.preview, {
                    entryMode: created.entryMode,
                    company: created.company,
                  }),
                }}
              />
              {created.hubspotUnavailable && (
                <p className="text-xs text-muted-foreground">
                  HubSpot no respondió en algún paso. Al aprobar, la sincronización vuelve a buscar el correo y no
                  lo duplica; la empresa puedes confirmarla en la ficha.
                </p>
              )}
              <Button
                className="w-full"
                onClick={() => openCandidate(created.candidateId)}
                data-testid="linkedin-review-now"
              >
                <UserSearch className="h-4 w-4" aria-hidden />
                {REVIEW_NOW_LABEL}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => router.push(CONTACT_SEARCH_REVIEW_HREF)}>
                Ver «Por revisar»
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}

          {outcome?.kind === 'pending' && !isRevealing && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => openCandidate(outcome.candidateId)}
              data-testid="linkedin-open-candidate"
            >
              <UserSearch className="h-4 w-4" aria-hidden />
              {OPEN_CANDIDATE_LABEL}
            </Button>
          )}
        </div>
      </div>

      <div className={cn(isPanel ? 'shrink-0 px-4 pb-4 pt-2' : 'sticky bottom-0 mt-auto bg-background pb-2 pt-3')}>
        <ChatComposer
          compact
          value={composerUnlocked ? composerText : ''}
          onChange={setComposerText}
          onSend={handleSend}
          placeholder={composerUnlocked ? placeholder : LINKEDIN_SEARCHING_LABEL}
          disabled={!composerUnlocked}
          maxLength={500}
          inputRef={composerInputRef}
        />
      </div>
    </div>
  );
}
