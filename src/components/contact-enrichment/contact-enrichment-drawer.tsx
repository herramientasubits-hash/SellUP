'use client';

import * as React from 'react';
import { ChatPanel } from '@/components/chat';
import { ContactEnrichmentWizard } from './contact-enrichment-wizard';
import type {
  ContactEnrichmentChatWizardHandle,
  ContactEnrichmentInitialCompany,
  ManualContactContext,
} from './contact-enrichment-wizard';

export type { ContactEnrichmentInitialCompany, ManualContactContext };

interface ContactEnrichmentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preloadedCompany?: ContactEnrichmentInitialCompany | null;
  onCreateManualContact?: (ctx: ManualContactContext) => void;
}

/**
 * El asistente de enriquecimiento de contactos. Conserva el nombre «Drawer» por
 * quien ya lo monta, pero vive en el panel del agente de Thema (`ChatPanel`): se
 * acopla al lado de la página y la estrecha, sin velo, así que la lista de
 * empresas o de contactos sigue a la vista mientras se conversa.
 */
export function ContactEnrichmentDrawer({
  open,
  onOpenChange,
  preloadedCompany,
  onCreateManualContact,
}: ContactEnrichmentDrawerProps) {
  const wizardRef = React.useRef<ContactEnrichmentChatWizardHandle>(null);
  const [busy, setBusy] = React.useState(false);

  return (
    <ChatPanel
      open={open}
      onOpenChange={onOpenChange}
      subtitle={
        preloadedCompany?.name ? `Enriquecer contactos · ${preloadedCompany.name}` : 'Enriquecer contactos'
      }
      onNewConversation={() => wizardRef.current?.reset()}
      newConversationDisabled={busy}
    >
      <ContactEnrichmentWizard
        key={preloadedCompany?.sellupAccountId ?? (open ? 'open' : 'closed')}
        ref={wizardRef}
        layout="panel"
        onBusyChange={setBusy}
        initialCompany={preloadedCompany ?? undefined}
        onCreateManualContact={onCreateManualContact}
      />
    </ChatPanel>
  );
}
