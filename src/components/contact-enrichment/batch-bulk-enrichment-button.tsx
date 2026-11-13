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

export interface BatchBulkEnrichment {
  /** Carga las empresas aprobadas de la búsqueda y abre la búsqueda masiva de contactos. */
  start: (batchId: string) => Promise<void>;
  loading: boolean;
  /** El panel de la búsqueda masiva; se monta una vez junto a quien lo abre. */
  drawer: React.ReactNode;
}

/**
 * «Buscar contactos de las aprobadas» como lógica suelta: la usan el botón de la
 * búsqueda y el menú de tres puntos de Empresas › Búsquedas (en la tabla, un botón
 * con el texto completo se cortaba).
 */
export function useBatchBulkEnrichment(): BatchBulkEnrichment {
  const [loading, setLoading] = React.useState(false);
  const [target, setTarget] = React.useState<{ batchId: string; accounts: BatchConvertedAccount[] } | null>(null);
  const [open, setOpen] = React.useState(false);

  const start = React.useCallback(
    async (batchId: string) => {
      if (loading) return;
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
        setTarget({ batchId, accounts: result.accounts });
        setOpen(true);
      } finally {
        setLoading(false);
      }
    },
    [loading],
  );

  const drawer =
    target && target.accounts.length > 0 ? (
      <BulkContactEnrichmentDrawer
        key={target.batchId}
        open={open}
        onOpenChange={setOpen}
        selectedAccounts={target.accounts}
        origin={{ kind: 'prospect_batch', batchId: target.batchId }}
      />
    ) : null;

  return { start, loading, drawer };
}

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
  const { start, loading, drawer } = useBatchBulkEnrichment();
  const empty = convertedCount <= 0;

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        onClick={() => {
          if (!empty) void start(batchId);
        }}
        disabled={empty || loading}
        title={empty ? BATCH_ENRICH_EMPTY_HINT : undefined}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Users aria-hidden="true" />}
        {BATCH_ENRICH_LABEL}
      </Button>
      {drawer}
    </>
  );
}
