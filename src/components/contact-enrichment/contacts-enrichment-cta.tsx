'use client';

import * as React from 'react';
import { UserSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContactEnrichmentDrawer } from './contact-enrichment-drawer';

export function ContactsEnrichmentCTA() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserSearch className="mr-2 h-4 w-4" />
        Buscar contactos con IA
      </Button>
      <ContactEnrichmentDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}
