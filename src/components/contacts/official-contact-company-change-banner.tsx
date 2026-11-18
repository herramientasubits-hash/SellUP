'use client';

/**
 * Aviso en la ficha de un contacto ARCHIVADO por un cambio de empresa
 * (AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE, Bryan 18-11): a dónde se fue, qué pasó con el
 * candidato en la empresa nueva y «Desarchivar».
 */

import * as React from 'react';
import { toast } from 'sonner';
import { RotateCcw } from '@/icons';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { readContactCompanyChange } from '@/modules/contact-enrichment/contact-company-change-core';
import { restoreCompanyChangeContactAction } from '@/modules/contact-enrichment/contact-company-change-actions';

const OUTCOME_COPY = {
  pending_review: 'La persona está en «Por revisar» en la empresa nueva.',
  approved: 'El candidato se aprobó en la empresa nueva.',
  rejected: 'El candidato en la empresa nueva se rechazó. HubSpot conserva los datos nuevos.',
} as const;

export function OfficialContactCompanyChangeBanner({
  contact,
  onRestored,
}: {
  contact: { id: string; archived_at: string | null; metadata: Record<string, unknown> | null };
  onRestored: () => void;
}) {
  const [restoring, setRestoring] = React.useState(false);
  const block = contact.archived_at ? readContactCompanyChange(contact.metadata) : null;
  if (!block) return null;

  const restore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const result = await restoreCompanyChangeContactAction({ contactId: contact.id });
      if (result.ok) {
        toast.success(result.message);
        onRestored();
      } else {
        toast.error(result.message);
      }
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Alert variant="info" data-testid="company-change-archived-banner">
      <AlertTitle>
        Archivado por cambio de empresa{block.new_company_name ? `: ahora en ${block.new_company_name}` : ''}
      </AlertTitle>
      <AlertDescription>
        <p>{OUTCOME_COPY[block.outcome]}</p>
        <div className="mt-2">
          <Button type="button" size="xs" variant="outline" className="gap-1.5" disabled={restoring} onClick={() => void restore()}>
            <RotateCcw className="h-3.5 w-3.5" />
            {restoring ? 'Desarchivando…' : 'Desarchivar'}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
