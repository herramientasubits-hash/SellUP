'use client';

import * as React from 'react';
import { AIButton } from '@/components/ai/ai-button';
import { CreateContactDrawer } from '@/components/contacts/create-contact-drawer';
import { ContactEnrichmentDrawer } from './contact-enrichment-drawer';
import type { ManualContactContext } from './contact-enrichment-drawer';

interface ContactsEnrichmentCTAProps {
  /**
   * Modo controlado: quien lo monta decide cuándo está abierto el buscador (la
   * barra de acciones de la pantalla) y aquí no se pinta el botón.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ContactsEnrichmentCTA({ open: controlledOpen, onOpenChange }: ContactsEnrichmentCTAProps = {}) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const enrichmentOpen = isControlled ? controlledOpen : internalOpen;
  const setEnrichmentOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [createContactOpen, setCreateContactOpen] = React.useState(false);
  const [manualCtx, setManualCtx] = React.useState<ManualContactContext | null>(null);

  function handleCreateManualContact(ctx: ManualContactContext) {
    setEnrichmentOpen(false);
    setManualCtx(ctx);
    setCreateContactOpen(true);
  }

  function handleCreateContactClose(open: boolean) {
    setCreateContactOpen(open);
    if (!open) setManualCtx(null);
  }

  return (
    <>
      {!isControlled && (
        <AIButton size="sm" onClick={() => setEnrichmentOpen(true)}>
          Buscar contactos con IA
        </AIButton>
      )}
      <ContactEnrichmentDrawer
        open={enrichmentOpen}
        onOpenChange={setEnrichmentOpen}
        onCreateManualContact={handleCreateManualContact}
      />
      <CreateContactDrawer
        open={createContactOpen}
        onOpenChange={handleCreateContactClose}
        accountId={manualCtx?.accountId}
        accountLabel={
          manualCtx?.companyName
            ? manualCtx.companyDomain
              ? `${manualCtx.companyName} · ${manualCtx.companyDomain}`
              : manualCtx.companyName
            : undefined
        }
        metadata={
          manualCtx
            ? {
                created_from: 'contact_enrichment_empty_state',
                contact_enrichment_run_id: manualCtx.runId,
                company_name: manualCtx.companyName,
                company_domain: manualCtx.companyDomain,
                apollo_result_empty: true,
              }
            : undefined
        }
      />
    </>
  );
}
