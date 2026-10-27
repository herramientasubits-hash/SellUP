'use client';

// Agente 2A — Modo «Buscar contacto por LinkedIn» del panel del agente (F1: sólo el modo).
//
// F1 deja el modo visible (detrás de CONTACT_ENRICHMENT_LINKEDIN_SEARCH_ENABLED, apagada por
// defecto) con su saludo y su caja. La búsqueda en sí llega con F2
// (feat/agent2a-linkedin-contact-search): aquí no se llama a ningún proveedor.

import * as React from 'react';
import { cn } from '@/lib/utils';
import { AgentChatTimeline } from '@/components/agent-chat';
import type { AgentChatMessage } from '@/components/agent-chat';
import { ChatComposer } from '@/components/chat';
import type { ContactEnrichmentChatWizardHandle } from './contact-enrichment-chat-wizard';

export const LINKEDIN_SEARCH_GREETING =
  'Pega el enlace del perfil de LinkedIn de la persona que buscas (por ejemplo, linkedin.com/in/nombre-apellido).';

export const LINKEDIN_SEARCH_COMING_SOON =
  'La búsqueda por LinkedIn todavía no está disponible en este entorno.';

interface ContactEnrichmentLinkedinSearchProps {
  layout?: 'panel' | 'page';
  ref?: React.Ref<ContactEnrichmentChatWizardHandle>;
  onBusyChange?: (busy: boolean) => void;
  placeholder: string;
}

const MESSAGES: AgentChatMessage[] = [
  { id: 'li-greeting', role: 'assistant', content: LINKEDIN_SEARCH_GREETING },
  { id: 'li-soon', role: 'assistant', content: LINKEDIN_SEARCH_COMING_SOON, tone: 'warning' },
];

export function ContactEnrichmentLinkedinSearch({
  layout = 'panel',
  ref,
  placeholder,
}: ContactEnrichmentLinkedinSearchProps) {
  // El panel remonta este componente para una conversación nueva: no hay estado que limpiar.
  React.useImperativeHandle(ref, () => ({ reset: () => {} }));
  const isPanel = layout === 'panel';

  return (
    <div
      className={cn('flex flex-col', isPanel ? 'h-full min-h-0 flex-1' : 'mx-auto min-h-full w-full max-w-2xl')}
      data-testid="linkedin-contact-search"
    >
      <div className={cn(isPanel && 'min-h-0 flex-1 overflow-y-auto px-4 py-5')}>
        <div className="flex flex-col gap-4 pb-4">
          <AgentChatTimeline messages={MESSAGES} visibleCount={MESSAGES.length} isTyping={false} />
        </div>
      </div>
      <div className={cn(isPanel ? 'shrink-0 px-4 pb-4 pt-2' : 'sticky bottom-0 mt-auto bg-background pb-2 pt-3')}>
        <ChatComposer compact value="" onChange={() => {}} onSend={() => {}} placeholder={placeholder} disabled />
      </div>
    </div>
  );
}
