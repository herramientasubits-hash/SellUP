'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChatPanel } from '@/components/chat';
import { AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT } from '@/components/prospect-batches/agent-runs-tray/agent-runs-tray';
import { CONTACT_SEARCH_REVIEW_HREF } from '@/modules/contact-enrichment/contact-search-runs-client';
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
  /** «Volver» a «¿Qué quieres hacer?» de Rumbo (sólo cuando se abrió desde ahí). */
  onBack?: () => void;
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
  onBack,
}: ContactEnrichmentDrawerProps) {
  const wizardRef = React.useRef<ContactEnrichmentChatWizardHandle>(null);
  const [busy, setBusy] = React.useState(false);
  // D1 — el botón «ID» cambia el panel al modo «Búsqueda por lotes con ID de
  // HubSpot»; volver a pulsarlo regresa al asistente de una empresa.
  const [mode, setMode] = React.useState<EnrichmentPanelMode>('single');
  const isBatch = mode === 'hubspot_id_batch';
  const router = useRouter();
  // Minimizar: el panel se cierra y la búsqueda sigue en el Centro de procesos.
  const minimize = () => {
    setMode('single');
    onOpenChange(false);
    window.dispatchEvent(new window.CustomEvent(AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT));
  };
  // Dueña 20-10: al terminar con contactos, «Por revisar» con lo encontrado (como con empresas).
  const showFoundContacts = () => {
    onOpenChange(false);
    router.push(CONTACT_SEARCH_REVIEW_HREF);
    router.refresh();
  };

  const singleSubtitle = preloadedCompany?.name
    ? `Enriquecer contactos · ${preloadedCompany.name}`
    : 'Enriquecer contactos';

  return (
    <ChatPanel
      onBack={onBack}
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
      onMinimize={minimize}
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
          onFoundContacts={showFoundContacts}
        />
      )}
    </ChatPanel>
  );
}
