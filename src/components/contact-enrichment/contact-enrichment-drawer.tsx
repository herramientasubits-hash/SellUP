'use client';

import * as React from 'react';
import { UserSearch } from 'lucide-react';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { ContactEnrichmentWizard } from './contact-enrichment-wizard';
import type { ContactEnrichmentInitialCompany, ManualContactContext } from './contact-enrichment-wizard';

export type { ContactEnrichmentInitialCompany, ManualContactContext };

interface ContactEnrichmentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preloadedCompany?: ContactEnrichmentInitialCompany | null;
  onCreateManualContact?: (ctx: ManualContactContext) => void;
}

export function ContactEnrichmentDrawer({
  open,
  onOpenChange,
  preloadedCompany,
  onCreateManualContact,
}: ContactEnrichmentDrawerProps) {
  return (
    <DrawerShell
      open={open}
      onOpenChange={onOpenChange}
      title="Enriquecer contactos"
      description="Prepara un run de enriquecimiento de contactos para esta empresa."
      icon={<UserSearch className="h-4 w-4 text-su-brand" />}
      size="xl"
    >
      <ContactEnrichmentWizard
        key={preloadedCompany?.sellupAccountId ?? (open ? 'open' : 'closed')}
        initialCompany={preloadedCompany ?? undefined}
        onCreateManualContact={onCreateManualContact}
      />
    </DrawerShell>
  );
}
