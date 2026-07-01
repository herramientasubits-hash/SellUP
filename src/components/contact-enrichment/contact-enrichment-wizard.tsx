'use client';

// Agente 2A — Contact Enrichment Wizard (Hito 17A.2B)
// Conversational wizard, tipo Agente 1. La lógica/visual vive en
// `contact-enrichment-chat-wizard.tsx` y las primitivas compartidas en
// `@/components/agent-chat`. Este archivo preserva el contrato público
// (export `ContactEnrichmentWizard` + tipo `ContactEnrichmentInitialCompany`)
// consumido por el drawer y la página fallback.

import { ContactEnrichmentChatWizard } from './contact-enrichment-chat-wizard';
import type { ContactEnrichmentInitialCompany, ManualContactContext } from './contact-enrichment-chat-types';

export type { ContactEnrichmentInitialCompany, ManualContactContext };

interface ContactEnrichmentWizardProps {
  initialCompany?: ContactEnrichmentInitialCompany;
  onCreateManualContact?: (ctx: ManualContactContext) => void;
}

export function ContactEnrichmentWizard({ initialCompany, onCreateManualContact }: ContactEnrichmentWizardProps = {}) {
  return (
    <ContactEnrichmentChatWizard
      initialCompany={initialCompany}
      onCreateManualContact={onCreateManualContact}
    />
  );
}
