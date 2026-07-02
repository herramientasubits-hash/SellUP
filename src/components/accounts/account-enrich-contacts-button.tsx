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
  /**
   * When provided, clicking the button calls this callback instead of opening
   * an internal ContactEnrichmentDrawer. Use this when the button is rendered
   * inside a drawer/sheet that must close before the enrichment drawer opens,
   * so that two side panels never appear simultaneously.
   */
  onRequestOpen?: (company: ContactEnrichmentInitialCompany) => void;
}

export function AccountEnrichContactsButton({
  preloadedCompany,
  disabled,
  onRequestOpen,
}: AccountEnrichContactsButtonProps) {
  const [open, setOpen] = React.useState(false);

  if (disabled) return null;

  const handleClick = () => {
    if (onRequestOpen) {
      onRequestOpen(preloadedCompany);
    } else {
      setOpen(true);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={handleClick}
        className="gap-1.5"
      >
        <UserSearch className="h-3.5 w-3.5" />
        Enriquecer contactos
      </Button>

      {!onRequestOpen && (
        <ContactEnrichmentDrawer
          open={open}
          onOpenChange={setOpen}
          preloadedCompany={preloadedCompany}
        />
      )}
    </>
  );
}
