'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChatPanel } from '@/components/chat';
import { AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT } from '@/components/prospect-batches/agent-runs-tray/agent-runs-tray';
import { CONTACT_SEARCH_REVIEW_HREF } from '@/modules/contact-enrichment/contact-search-runs-client';
import { TooltipIconButton } from '@/components/ui/tooltip-icon-button';
import { ContactEnrichmentWizard } from './contact-enrichment-wizard';
import { ContactEnrichmentHubSpotIdBatch } from './contact-enrichment-hubspot-id-batch';
import { ContactEnrichmentLinkedinSearch } from './contact-enrichment-linkedin-search';
import { SearchModeBrandIcon } from './search-mode-brand-icon';
import { getContactEnrichmentPanelFlagsAction } from '@/modules/contact-enrichment/panel-flags-actions';
import type {
  ContactEnrichmentChatWizardHandle,
  ContactEnrichmentInitialCompany,
  ManualContactContext,
} from './contact-enrichment-wizard';

export type { ContactEnrichmentInitialCompany, ManualContactContext };

/** Nombre (tooltip y aria-label) del botón de HubSpot de la cabecera: lote de Company IDs. */
export const HUBSPOT_ID_BATCH_BUTTON_LABEL = 'Buscar por lote de HubSpot IDs';

/** Nombre (tooltip y aria-label) del botón de LinkedIn de la cabecera (LinkedIn o correo). */
export const LINKEDIN_SEARCH_BUTTON_LABEL = 'Buscar contacto por LinkedIn o correo';

/**
 * Los modos del panel. «Por empresa» (`single`) es el de siempre; los otros dos se activan con
 * los botones de la cabecera y se apagan volviendo a pulsarlos o con «Nueva conversación».
 */
export type EnrichmentPanelMode = 'single' | 'hubspot_id_batch' | 'linkedin';

/** Lo que dice la caja de texto en cada modo. */
export const SEARCH_MODE_PLACEHOLDER: Record<EnrichmentPanelMode, string> = {
  single: 'Nombre o dominio de la empresa',
  hubspot_id_batch: 'Company IDs separados por coma',
  linkedin: 'Pega el LinkedIn o el correo de la persona',
};

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
  // D1 + F1 — los botones de HubSpot y LinkedIn cambian el modo del panel; volver a pulsar el
  // activo regresa a «Por empresa».
  const [mode, setMode] = React.useState<EnrichmentPanelMode>('single');
  // Cambiar la clave remonta el asistente: estado, texto, IDs y URL vuelven a cero.
  const [conversationKey, setConversationKey] = React.useState(0);
  const linkedinSearchEnabled = useLinkedinSearchFlag(open);
  const isBatch = mode === 'hubspot_id_batch';
  const isLinkedin = mode === 'linkedin';
  const router = useRouter();

  const backToCompanyMode = React.useCallback(() => {
    setBusy(false);
    setMode('single');
    setConversationKey((key) => key + 1);
  }, []);

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

  // F1 — «Nueva conversación» abre SIEMPRE en «Por empresa» con la caja vacía. Si hay un lote
  // en curso, el primer clic lo cancela y deja a la vista su reporte «Cancelado»; el siguiente
  // abre la conversación nueva.
  const startNewConversation = () => {
    if (wizardRef.current?.cancelInProgress?.()) return;
    if (mode === 'single') {
      wizardRef.current?.reset();
      return;
    }
    backToCompanyMode();
  };

  const toggleMode = (target: Exclude<EnrichmentPanelMode, 'single'>) => {
    setBusy(false);
    setMode((current) => (current === target ? 'single' : target));
  };

  const singleSubtitle = preloadedCompany?.name
    ? `Enriquecer contactos · ${preloadedCompany.name}`
    : 'Enriquecer contactos';
  const subtitle = isBatch ? HUBSPOT_ID_BATCH_BUTTON_LABEL : isLinkedin ? LINKEDIN_SEARCH_BUTTON_LABEL : singleSubtitle;

  return (
    <ChatPanel
      onBack={onBack}
      open={open}
      onOpenChange={(next) => {
        // Al cerrar el panel se vuelve al asistente normal para la próxima vez.
        if (!next) setMode('single');
        onOpenChange(next);
      }}
      subtitle={subtitle}
      headerActions={
        <>
          <TooltipIconButton
            icon={<SearchModeBrandIcon brand="hubspot" />}
            label={HUBSPOT_ID_BATCH_BUTTON_LABEL}
            variant={isBatch ? 'secondary' : 'ghost'}
            aria-pressed={isBatch}
            disabled={busy}
            onClick={() => toggleMode('hubspot_id_batch')}
            data-testid="chat-panel-hubspot-id-batch"
          />
          {linkedinSearchEnabled && (
            <TooltipIconButton
              icon={<SearchModeBrandIcon brand="linkedin" />}
              label={LINKEDIN_SEARCH_BUTTON_LABEL}
              variant={isLinkedin ? 'secondary' : 'ghost'}
              aria-pressed={isLinkedin}
              disabled={busy}
              onClick={() => toggleMode('linkedin')}
              data-testid="chat-panel-linkedin-search"
            />
          )}
        </>
      }
      onMinimize={minimize}
      onNewConversation={startNewConversation}
      // El lote se puede cancelar desde «Nueva conversación»; el resto espera a que termine.
      newConversationDisabled={busy && !isBatch}
    >
      {isBatch ? (
        <ContactEnrichmentHubSpotIdBatch
          key={`batch-${conversationKey}`}
          ref={wizardRef}
          layout="panel"
          onBusyChange={setBusy}
          placeholder={SEARCH_MODE_PLACEHOLDER.hubspot_id_batch}
        />
      ) : isLinkedin ? (
        <ContactEnrichmentLinkedinSearch
          key={`linkedin-${conversationKey}`}
          ref={wizardRef}
          layout="panel"
          onBusyChange={setBusy}
          placeholder={SEARCH_MODE_PLACEHOLDER.linkedin}
        />
      ) : (
        <ContactEnrichmentWizard
          key={`${preloadedCompany?.sellupAccountId ?? (open ? 'open' : 'closed')}-${conversationKey}`}
          ref={wizardRef}
          layout="panel"
          onBusyChange={setBusy}
          initialCompany={preloadedCompany ?? undefined}
          onCreateManualContact={onCreateManualContact}
          onFoundContacts={showFoundContacts}
          placeholder={SEARCH_MODE_PLACEHOLDER.single}
        />
      )}
    </ChatPanel>
  );
}

/**
 * La bandera de LinkedIn viene del servidor. Se pide al abrir el panel; mientras no llega (o si
 * falla) el botón no se muestra: apagado es el valor seguro.
 */
function useLinkedinSearchFlag(open: boolean): boolean {
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    getContactEnrichmentPanelFlagsAction()
      .then((flags) => {
        if (alive) setEnabled(flags.linkedinSearchEnabled === true);
      })
      .catch(() => {
        if (alive) setEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);
  return enabled;
}
