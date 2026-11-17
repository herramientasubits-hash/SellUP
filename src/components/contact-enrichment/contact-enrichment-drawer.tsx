'use client';

import * as React from 'react';
import { ChatPanel } from '@/components/chat';
import { AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT } from '@/components/prospect-batches/agent-runs-tray/agent-runs-tray';
import { ContactEnrichmentWizard } from './contact-enrichment-wizard';
import { ContactEnrichmentHubSpotIdBatch, startHubSpotIdBatch } from './contact-enrichment-hubspot-id-batch';
import { ContactEnrichmentLinkedinSearch } from './contact-enrichment-linkedin-search';
import { SEARCH_MODE_LABEL, SearchModeOptions, type EnrichmentPanelMode } from './search-mode-options';
import { getContactEnrichmentPanelFlagsAction } from '@/modules/contact-enrichment/panel-flags-actions';
import type {
  ContactEnrichmentChatWizardHandle,
  ContactEnrichmentInitialCompany,
  ManualContactContext,
} from './contact-enrichment-wizard';

export type { ContactEnrichmentInitialCompany, ManualContactContext, EnrichmentPanelMode };

/** Lo que dice la caja de texto en cada modo. */
export const SEARCH_MODE_PLACEHOLDER: Record<EnrichmentPanelMode, string> = {
  single: 'Nombre o dominio de la empresa',
  hubspot_id_batch: 'Company IDs (con coma o uno por fila)',
  linkedin: 'Pega el LinkedIn, el correo o el ID de HubSpot del contacto',
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
 *
 * Bryan 17-11: las otras formas de buscar (lote de HubSpot IDs y un contacto por LinkedIn,
 * correo o ID) ya no son botones de la cabecera: son opciones bajo la conversación, como en el
 * Agente 1. Son opcionales: escribir una empresa sigue con Rumbo como siempre.
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
  const [mode, setMode] = React.useState<EnrichmentPanelMode>('single');
  // Cambiar la clave remonta el asistente: estado, texto, IDs y URL vuelven a cero.
  const [conversationKey, setConversationKey] = React.useState(0);
  const linkedinSearchEnabled = useLinkedinSearchFlag(open);
  const isBatch = mode === 'hubspot_id_batch';
  const isLinkedin = mode === 'linkedin';

  /** Elegir una opción empieza esa conversación limpia (Bryan 17-11). */
  const switchMode = React.useCallback((target: EnrichmentPanelMode) => {
    setBusy(false);
    setMode(target);
    setConversationKey((key) => key + 1);
  }, []);

  // Minimizar: el panel se cierra y la búsqueda sigue en el Centro de procesos.
  const minimize = () => {
    setMode('single');
    onOpenChange(false);
    window.dispatchEvent(new window.CustomEvent(AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT));
  };
  // Bryan 04-11: al terminar una búsqueda el panel ya no se cierra ni lleva a «Por revisar»
  // (antes, dueña 20-10): la conversación sigue con otra empresa. A «Por revisar» se va desde el
  // aviso o el Centro de procesos.

  // «Nueva conversación» abre SIEMPRE en «Por empresa» con la caja vacía y sus opciones. Si hay
  // un lote en curso, el primer clic lo cancela y deja a la vista su reporte «Cancelado»; el
  // siguiente abre la conversación nueva.
  const startNewConversation = () => {
    if (wizardRef.current?.cancelInProgress?.()) return;
    // El lote vive fuera del panel (sigue al minimizar): su reinicio limpia esa conversación.
    wizardRef.current?.reset();
    if (mode === 'single') return;
    switchMode('single');
  };

  /** Varios HubSpot IDs pegados en «Por empresa»: «Buscarlas como lote» los lleva al lote. */
  const searchAsBatch = React.useCallback(
    (raw: string) => {
      startHubSpotIdBatch(raw);
      switchMode('hubspot_id_batch');
    },
    [switchMode],
  );

  const modeOptions = (
    <SearchModeOptions current={mode} linkedinEnabled={linkedinSearchEnabled} onSelect={switchMode} />
  );

  const singleSubtitle = preloadedCompany?.name
    ? `Enriquecer contactos · ${preloadedCompany.name}`
    : 'Enriquecer contactos';
  const subtitle = mode === 'single' ? singleSubtitle : SEARCH_MODE_LABEL[mode];

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
          modeOptions={modeOptions}
        />
      ) : isLinkedin ? (
        <ContactEnrichmentLinkedinSearch
          key={`linkedin-${conversationKey}`}
          ref={wizardRef}
          layout="panel"
          onBusyChange={setBusy}
          placeholder={SEARCH_MODE_PLACEHOLDER.linkedin}
          modeOptions={modeOptions}
        />
      ) : (
        <ContactEnrichmentWizard
          key={`${preloadedCompany?.sellupAccountId ?? (open ? 'open' : 'closed')}-${conversationKey}`}
          ref={wizardRef}
          layout="panel"
          onBusyChange={setBusy}
          initialCompany={preloadedCompany ?? undefined}
          onCreateManualContact={onCreateManualContact}
          placeholder={SEARCH_MODE_PLACEHOLDER.single}
          modeOptions={modeOptions}
          onSearchAsBatch={searchAsBatch}
        />
      )}
    </ChatPanel>
  );
}

/**
 * La bandera de LinkedIn viene del servidor. Se pide al abrir el panel; mientras no llega (o si
 * falla) la opción no se muestra: apagado es el valor seguro.
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
