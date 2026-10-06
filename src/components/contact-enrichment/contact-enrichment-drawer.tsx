'use client';

import * as React from 'react';
import { ChatPanel } from '@/components/chat';
import { TooltipIconButton } from '@/components/ui/tooltip-icon-button';
import { ContactEnrichmentWizard } from './contact-enrichment-wizard';
import { ContactEnrichmentHubSpotIdBatch } from './contact-enrichment-hubspot-id-batch';
import type {
  ContactEnrichmentChatWizardHandle,
  ContactEnrichmentInitialCompany,
  ManualContactContext,
} from './contact-enrichment-wizard';

export type { ContactEnrichmentInitialCompany, ManualContactContext };

/** Nombre (tooltip) del botón «ID» de la cabecera. */
export const HUBSPOT_ID_BATCH_BUTTON_LABEL = 'Búsqueda por lotes con ID de HubSpot';

type EnrichmentPanelMode = 'single' | 'hubspot_id_batch';

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
  // D1 — el botón «ID» cambia el panel al modo «Búsqueda por lotes con ID de
  // HubSpot»; volver a pulsarlo regresa al asistente de una empresa.
  const [mode, setMode] = React.useState<EnrichmentPanelMode>('single');
  const isBatch = mode === 'hubspot_id_batch';

  const singleSubtitle = preloadedCompany?.name
    ? `Enriquecer contactos · ${preloadedCompany.name}`
    : 'Enriquecer contactos';

  return (
    <ChatPanel
      open={open}
      onOpenChange={(next) => {
        // Al cerrar el panel se vuelve al asistente normal para la próxima vez.
        if (!next) setMode('single');
        onOpenChange(next);
      }}
      subtitle={isBatch ? HUBSPOT_ID_BATCH_BUTTON_LABEL : singleSubtitle}
      headerActions={
        <TooltipIconButton
          icon={
            <span aria-hidden className="text-xs font-semibold leading-none">
              ID
            </span>
          }
          label={HUBSPOT_ID_BATCH_BUTTON_LABEL}
          variant={isBatch ? 'secondary' : 'ghost'}
          aria-pressed={isBatch}
          disabled={busy}
          onClick={() => {
            setBusy(false);
            setMode(isBatch ? 'single' : 'hubspot_id_batch');
          }}
          data-testid="chat-panel-hubspot-id-batch"
        />
      }
      onNewConversation={() => wizardRef.current?.reset()}
      newConversationDisabled={busy}
    >
      {isBatch ? (
        <ContactEnrichmentHubSpotIdBatch ref={wizardRef} layout="panel" onBusyChange={setBusy} />
      ) : (
        <ContactEnrichmentWizard
          key={preloadedCompany?.sellupAccountId ?? (open ? 'open' : 'closed')}
          ref={wizardRef}
          layout="panel"
          onBusyChange={setBusy}
          initialCompany={preloadedCompany ?? undefined}
          onCreateManualContact={onCreateManualContact}
        />
      )}
    </ChatPanel>
  );
}
