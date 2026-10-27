'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Loader2, Users } from '@/icons';
import { Button } from '@/components/ui/button';
import { BulkContactEnrichmentDrawer } from '@/components/contact-enrichment/bulk-contact-enrichment-drawer';
import {
  getBatchConvertedAccountsForBulkEnrichmentAction,
  type BatchConvertedAccount,
} from '@/modules/contact-enrichment/bulk-enrichment-sources';

export interface BatchBulkEnrichmentButtonProps {
  batchId: string;
  /** Empresas que la búsqueda ya creó. Sin ninguna, el botón explica por qué no está disponible. */
  convertedCount: number;
  size?: 'sm' | 'default';
  variant?: 'default' | 'outline';
}

export const BATCH_ENRICH_LABEL = 'Buscar contactos de las aprobadas';
export const BATCH_ENRICH_EMPTY_HINT = 'Aprueba empresas de esta búsqueda para buscar sus contactos.';

/**
 * «Buscar contactos de las aprobadas»: abre la búsqueda masiva de contactos con las
 * empresas que esta búsqueda ya creó, sin ir a marcarlas una por una en Empresas.
 * La búsqueda es la misma de siempre (elegibilidad, confirmación, revisión antes de
 * crear contactos).
 */
export function BatchBulkEnrichmentButton({
  batchId,
  convertedCount,
  size = 'sm',
  variant = 'outline',
}: BatchBulkEnrichmentButtonProps) {
  const [loading, setLoading] = React.useState(false);
  const [accounts, setAccounts] = React.useState<BatchConvertedAccount[]>([]);
  const [open, setOpen] = React.useState(false);
  const empty = convertedCount <= 0;

  async function handleClick() {
    if (empty || loading) return;
    setLoading(true);
    try {
      const result = await getBatchConvertedAccountsForBulkEnrichmentAction(batchId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      if (result.accounts.length === 0) {
        toast.info('Las empresas de esta búsqueda ya no están disponibles (archivadas o sin acceso).');
        return;
      }
      if (result.truncated) {
        toast.info(
          `Se buscan las primeras ${result.max} de ${result.total} empresas. El resto, desde Empresas o en otra tanda.`,
        );
      }
      setAccounts(result.accounts);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        onClick={handleClick}
        disabled={empty || loading}
        title={empty ? BATCH_ENRICH_EMPTY_HINT : undefined}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Users aria-hidden="true" />}
        {BATCH_ENRICH_LABEL}
      </Button>
      {accounts.length > 0 && (
        <BulkContactEnrichmentDrawer
          open={open}
          onOpenChange={setOpen}
          selectedAccounts={accounts}
          origin={{ kind: 'prospect_batch', batchId }}
        />
      )}
    </>
  );
}
