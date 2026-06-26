'use client';

import * as React from 'react';
import { AIButton } from '@/components/ai/ai-button';
import { ContactEnrichmentDrawer } from './contact-enrichment-drawer';

export function ContactsEnrichmentCTA() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <AIButton size="sm" onClick={() => setOpen(true)}>
        Buscar contactos con IA
      </AIButton>
      <ContactEnrichmentDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}
