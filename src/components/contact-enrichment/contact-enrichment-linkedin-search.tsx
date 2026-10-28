'use client';

// Agente 2A — Modo «Buscar contacto por LinkedIn» del panel del agente (F1 abre el modo, F2 lo llena).
//
// Detrás de CONTACT_ENRICHMENT_LINKEDIN_SEARCH_ENABLED (apagada por defecto). Flujo:
//   1. el usuario pega el enlace del perfil; el chat NO repite la URL (dato personal);
//   2. el servidor valida, mira si ya existe en SellUp (por LinkedIn), enriquece (Apollo y, si
//      no trae datos, Lusha) y compara el email encontrado contra SellUp y HubSpot;
//   3. vista previa: nombre, cargo, empresa según el proveedor y datos encontrados; el teléfono
//      sigue el flujo de reveal existente;
//   4. «Asociar a una empresa» (obligatorio) y el candidato queda en «Por revisar».

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Building2, RotateCcw } from '@/icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AgentChatTimeline, useProgressiveReveal } from '@/components/agent-chat';
import type { AgentChatMessage, AgentChatRole, AgentChatTone } from '@/components/agent-chat';
import { ChatComposer } from '@/components/chat';
import { ChatCardView } from '@/components/chat/chat-card-view';
import type { ChatCardRow } from '@/components/chat/types';
import { CONTACT_SEARCH_REVIEW_HREF } from '@/modules/contact-enrichment/contact-search-runs-client';
import { searchContactByLinkedinAction } from '@/modules/contact-enrichment/linkedin-contact-search-actions';
import type {
  LinkedinSearchPreview,
  LinkedinSearchResult,
} from '@/modules/contact-enrichment/linkedin-contact-search-core';
import type { ContactEnrichmentChatWizardHandle } from './contact-enrichment-chat-wizard';
import { LinkedinCandidateCompanyDialog } from './linkedin-candidate-company-dialog';

// ── Copy ──────────────────────────────────────────────────────────────────────

export const LINKEDIN_SEARCH_GREETING =
  'Pega el enlace del perfil de LinkedIn de la persona que buscas (por ejemplo, linkedin.com/in/nombre-apellido). Antes de gastar créditos reviso si ya está en SellUp.';

/** Lo que muestra el chat en lugar de la URL pegada. */
export const LINKEDIN_USER_MESSAGE = 'Perfil de LinkedIn enviado.';

export const LINKEDIN_SEARCHING_LABEL = 'Buscando el perfil…';

export const LINKEDIN_FOUND_MESSAGE =
  'Encontré este perfil. Asócialo a una empresa para dejarlo en «Por revisar». No creé el contacto final.';

const CREDITS_SPENT_NOTE = 'La consulta al proveedor quedó registrada en el uso.';

function providerLabel(provider: LinkedinSearchPreview['provider']): string {
  return provider === 'apollo' ? 'Apollo' : 'Lusha';
}

export function buildLinkedinPreviewRows(preview: LinkedinSearchPreview): ChatCardRow[] {
  const rows: ChatCardRow[] = [
    { key: 'name', label: 'Nombre', value: preview.fullName },
    { key: 'title', label: 'Cargo', value: preview.title ?? '—' },
    {
      key: 'company',
      label: `Empresa actual según ${providerLabel(preview.provider)}`,
      value: preview.providerCompanyName ?? preview.providerCompanyDomain ?? '—',
    },
    { key: 'email', label: 'Correo', value: preview.email ?? 'No encontrado' },
    {
      key: 'phone',
      label: 'Teléfono',
      value: 'Se revela desde la ficha del candidato',
    },
  ];
  return rows;
}

/** Mensaje del asistente para cada desenlace que no es una vista previa. */
export function linkedinResultMessage(result: Exclude<LinkedinSearchResult, { status: 'found' }>): {
  content: string;
  tone: AgentChatTone;
} {
  switch (result.status) {
    case 'disabled':
      return { content: 'La búsqueda por LinkedIn no está activada en este entorno.', tone: 'warning' };
    case 'invalid_url':
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
        content: result.creditsSpent ? `${result.message} No se creó nada. ${CREDITS_SPENT_NOTE}` : `${result.message} No se creó nada.`,
        tone: 'warning',
      };
    case 'provider_error':
      return { content: result.message, tone: 'error' };
  }
}

// ── Estado ────────────────────────────────────────────────────────────────────

type Step = 'await_url' | 'searching' | 'retry' | 'preview' | 'created';

let messageSeq = 0;
function message(role: AgentChatRole, content: string, tone?: AgentChatTone): AgentChatMessage {
  messageSeq += 1;
  return { id: `li-${messageSeq}`, role, content, tone };
}

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
  const [step, setStep] = React.useState<Step>('await_url');
  const [composerText, setComposerText] = React.useState('');
  const [preview, setPreview] = React.useState<{ data: LinkedinSearchPreview; token: string; hubspotUnavailable: boolean } | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogKey, setDialogKey] = React.useState(0);
  // La URL para «Reintentar»: vive sólo en memoria, nunca en el hilo.
  const lastUrlRef = React.useRef<string | null>(null);
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

  const composerUnlocked = step === 'await_url' || step === 'retry';

  React.useEffect(() => {
    if (!composerUnlocked) return;
    const id = setTimeout(() => composerInputRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [composerUnlocked]);

  async function runSearch(url: string) {
    lastUrlRef.current = url;
    setStep('searching');
    let result: LinkedinSearchResult;
    try {
      result = await searchContactByLinkedinAction(url);
    } catch {
      result = { status: 'provider_error', message: 'No pudimos completar la búsqueda. Intenta de nuevo.' };
    }
    if (!aliveRef.current) return;
    if (result.status === 'found') {
      lastUrlRef.current = null;
      setPreview({ data: result.preview, token: result.token, hubspotUnavailable: result.hubspotCheck === 'unavailable' });
      setMessages((prev) => [...prev, message('assistant', LINKEDIN_FOUND_MESSAGE)]);
      setStep('preview');
      return;
    }
    const reply = linkedinResultMessage(result);
    setMessages((prev) => [...prev, message('assistant', reply.content, reply.tone)]);
    if (result.status === 'provider_error') {
      setStep('retry');
      return;
    }
    lastUrlRef.current = null;
    setStep('await_url');
  }

  async function handleSend() {
    if (!composerUnlocked) return;
    const url = composerText.trim();
    if (!url) return;
    setComposerText('');
    setMessages((prev) => [...prev, message('user', LINKEDIN_USER_MESSAGE)]);
    await runSearch(url);
  }

  async function handleRetry() {
    const url = lastUrlRef.current;
    if (!url || searching) return;
    setMessages((prev) => [...prev, message('user', 'Reintentar')]);
    await runSearch(url);
  }

  function handleCreated(text: string) {
    setMessages((prev) => [...prev, message('assistant', text)]);
    setStep('created');
  }

  const isPanel = layout === 'panel';

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

          {preview && (step === 'preview' || step === 'created') && !isRevealing && (
            <div className="space-y-3">
              <ChatCardView
                data-testid="linkedin-preview"
                card={{ kind: 'rows', title: `Datos encontrados en ${providerLabel(preview.data.provider)}`, rows: buildLinkedinPreviewRows(preview.data) }}
              />
              {preview.hubspotUnavailable && (
                <p className="text-xs text-muted-foreground">
                  HubSpot no respondió al revisar el correo. Al aprobar, la sincronización vuelve a buscarlo y no lo
                  duplica.
                </p>
              )}
              {step === 'preview' ? (
                <Button
                  className="w-full"
                  onClick={() => {
                    setDialogKey((key) => key + 1);
                    setDialogOpen(true);
                  }}
                  data-testid="linkedin-associate-company"
                >
                  <Building2 className="h-4 w-4" aria-hidden />
                  Asociar a una empresa
                </Button>
              ) : (
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
            composerUnlocked
              ? placeholder
              : searching
                ? LINKEDIN_SEARCHING_LABEL
                : 'Usa «Nueva conversación» para buscar otro perfil'
          }
          disabled={!composerUnlocked}
          maxLength={500}
          inputRef={composerInputRef}
        />
      </div>

      {preview && dialogOpen && (
        <LinkedinCandidateCompanyDialog
          key={dialogKey}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          preview={preview.data}
          token={preview.token}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
