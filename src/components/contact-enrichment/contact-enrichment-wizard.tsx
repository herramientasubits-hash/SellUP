'use client';

// Agente 2A — Contact Enrichment Wizard (Hito 17A.2B)
// Conversational wizard, tipo Agente 1. La lógica/visual vive en
// `contact-enrichment-chat-wizard.tsx` y las primitivas compartidas en
// `@/components/agent-chat`. Este archivo preserva el contrato público
// (export `ContactEnrichmentWizard` + tipo `ContactEnrichmentInitialCompany`)
// consumido por el drawer y la página fallback.

import { ContactEnrichmentChatWizard } from './contact-enrichment-chat-wizard';
import type { ContactEnrichmentInitialCompany } from './contact-enrichment-chat-types';

export type { ContactEnrichmentInitialCompany };

interface ContactEnrichmentWizardProps {
  initialCompany?: ContactEnrichmentInitialCompany;
}

export function ContactEnrichmentWizard({ initialCompany }: ContactEnrichmentWizardProps = {}) {
  return <ContactEnrichmentChatWizard initialCompany={initialCompany} />;
}
