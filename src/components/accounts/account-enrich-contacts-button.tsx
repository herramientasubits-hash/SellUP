'use client';

import * as React from 'react';
import { UserSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContactEnrichmentDrawer } from '@/components/contact-enrichment/contact-enrichment-drawer';
import type { ContactEnrichmentInitialCompany } from '@/components/contact-enrichment/contact-enrichment-drawer';

interface AccountEnrichContactsButtonProps {
  preloadedCompany: ContactEnrichmentInitialCompany;
  /** When true, the button is hidden (e.g. archived accounts). */
  disabled?: boolean;
}

export function AccountEnrichContactsButton({
  preloadedCompany,
  disabled,
}: AccountEnrichContactsButtonProps) {
  const [open, setOpen] = React.useState(false);

  if (disabled) return null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <UserSearch className="h-3.5 w-3.5" />
        Enriquecer contactos
      </Button>

      <ContactEnrichmentDrawer
        open={open}
        onOpenChange={setOpen}
        preloadedCompany={preloadedCompany}
      />
    </>
  );
}
