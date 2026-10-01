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
}

export function ContactEnrichmentWizard({
  initialCompany,
  onCreateManualContact,
  layout,
  ref,
  onBusyChange,
}: ContactEnrichmentWizardProps = {}) {
  return (
    <ContactEnrichmentChatWizard
      ref={ref}
      layout={layout}
      onBusyChange={onBusyChange}
      initialCompany={initialCompany}
      onCreateManualContact={onCreateManualContact}
    />
  );
}
