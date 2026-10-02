'use client';

import * as React from 'react';
import { UserSearch } from "@/icons";
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
  /**
   * Peso del botón. `outline` (por defecto) cuando acompaña a otras acciones;
   * `default` cuando es LA acción del panel en el que vive.
   */
  variant?: 'outline' | 'default';
  /** Texto del botón. Por defecto, «Enriquecer contactos». */
  label?: string;
}

export function AccountEnrichContactsButton({
  preloadedCompany,
  disabled,
  onRequestOpen,
  variant = 'outline',
  label = 'Enriquecer contactos',
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
      <Button type="button" size="sm" variant={variant} onClick={handleClick}>
        <UserSearch aria-hidden="true" />
        {label}
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
