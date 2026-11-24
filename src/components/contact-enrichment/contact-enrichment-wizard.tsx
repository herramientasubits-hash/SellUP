'use client';

// Agente 2A — Contact Enrichment Wizard (Hito 17A.2B)
// Conversational wizard, tipo Agente 1. La lógica/visual vive en
// `contact-enrichment-chat-wizard.tsx` y las primitivas compartidas en
// `@/components/agent-chat`. Este archivo preserva el contrato público
// (export `ContactEnrichmentWizard` + tipo `ContactEnrichmentInitialCompany`)
// consumido por el drawer y la página fallback.

import type * as React from 'react';
import {
  ContactEnrichmentChatWizard,
  type ContactEnrichmentChatWizardHandle,
} from './contact-enrichment-chat-wizard';
import type { ContactEnrichmentInitialCompany, ManualContactContext } from './contact-enrichment-chat-types';

export type { ContactEnrichmentChatWizardHandle, ContactEnrichmentInitialCompany, ManualContactContext };

interface ContactEnrichmentWizardProps {
  initialCompany?: ContactEnrichmentInitialCompany;
  onCreateManualContact?: (ctx: ManualContactContext) => void;
  /** `panel` dentro del panel del agente; `page` (por defecto) en la pantalla suelta. */
  layout?: 'panel' | 'page';
  ref?: React.Ref<ContactEnrichmentChatWizardHandle>;
  onBusyChange?: (busy: boolean) => void;
  placeholder?: string;
  /** Las otras formas de buscar, bajo la conversación (Bryan 17-11). */
  modeOptions?: React.ReactNode;
  /** «Buscarlas como lote» cuando se pegan varios HubSpot IDs (Bryan 17-11). */
  onSearchAsBatch?: (raw: string) => void;
  /** «Buscar a esta persona» cuando se pega un perfil de LinkedIn de persona (dueña 24-11). */
  onSearchAsPerson?: (raw: string) => void;
}

export function ContactEnrichmentWizard({
  initialCompany,
  onCreateManualContact,
  layout,
  ref,
  onBusyChange,
  placeholder,
  modeOptions,
  onSearchAsBatch,
  onSearchAsPerson,
}: ContactEnrichmentWizardProps = {}) {
  return (
    <ContactEnrichmentChatWizard
      ref={ref}
      layout={layout}
      onBusyChange={onBusyChange}
      initialCompany={initialCompany}
      onCreateManualContact={onCreateManualContact}
      placeholder={placeholder}
      modeOptions={modeOptions}
      onSearchAsBatch={onSearchAsBatch}
      onSearchAsPerson={onSearchAsPerson}
    />
  );
}
