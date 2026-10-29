'use client';

// FEEDBACK 29-10 — «Verificar ahora»: vuelve a correr la revisión de duplicados (SellUp +
// HubSpot, de sólo lectura) de un prospecto que quedó sin verificar, y deja el veredicto real
// en la ficha. Sin esto, «SellUp aún no verificó duplicidad» no tenía salida.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from '@/icons';
import { Button } from '@/components/ui/button';
import { recheckProspectDuplicatesAction } from '@/modules/prospect-review/recheck-duplicates-actions';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';

interface CandidateDuplicateRecheckButtonProps {
  candidate: ProspectCandidateWithReviewer;
  onCandidateUpdated?: (updated: ProspectCandidateWithReviewer) => void;
}

export function CandidateDuplicateRecheckButton({
  candidate,
  onCandidateUpdated,
}: CandidateDuplicateRecheckButtonProps) {
  const router = useRouter();
  const [checking, setChecking] = React.useState(false);

  async function handleRecheck() {
    setChecking(true);
    try {
      const result = await recheckProspectDuplicatesAction(candidate.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      onCandidateUpdated?.({
        ...candidate,
        duplicate_status: result.duplicateStatus as ProspectCandidateWithReviewer['duplicate_status'],
        matched_account_id: result.matchedAccountId,
        matched_hubspot_company_id: result.matchedHubSpotCompanyId,
      });
      router.refresh();
    } catch {
      toast.error('No se pudo verificar. Intenta de nuevo en unos minutos.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="xs" onClick={handleRecheck} disabled={checking}>
      {checking ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCw aria-hidden="true" />
      )}
      {checking ? 'Verificando en SellUp y HubSpot…' : 'Verificar ahora'}
    </Button>
  );
}
